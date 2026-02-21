const fs = require("fs");
const path = require("path");
const { safeText } = require("../utils");
const { LIVE_TV_PLAYLIST_EXTENSIONS } = require("../config");
const { liveTvState, eventosState, marathonState, vodState } = require("../state");
const {
  normalizeLooseText,
  scoreLiveChannel,
  makeLiveChannelId,
  canonicalizeHttpUrl,
  parseLiveTvPlaylist
} = require("./parser");
const { getCacheDir } = require("./remote-sources");
const { classifyGroupTitle } = require("./classifier");
const { buildVodIndex } = require("./vod-index");
const LIVE_TV_MAX_NAME_VARIANTS = Math.max(
  1,
  Math.min(12, Number.parseInt(String(process.env.LIVE_TV_MAX_NAME_VARIANTS || "6"), 10) || 6)
);

function appendItems(target, items) {
  if (!Array.isArray(target) || !Array.isArray(items) || !items.length) return;
  for (const item of items) {
    target.push(item);
  }
}

function pickBestLiveChannel(a, b) {
  return scoreLiveChannel(b) > scoreLiveChannel(a) ? b : a;
}

function dedupeLiveChannels(items, options = {}) {
  const section = String(options?.section || "tv");
  const withStats = Boolean(options?.withStats);
  const byUrl = new Map();
  for (const item of items) {
    const key = canonicalizeHttpUrl(item.streamUrl).toLowerCase();
    if (!key) continue;
    if (!byUrl.has(key)) {
      byUrl.set(key, item);
      continue;
    }
    byUrl.set(key, pickBestLiveChannel(byUrl.get(key), item));
  }

  const byName = new Map();
  for (const item of byUrl.values()) {
    const normalizedName = normalizeLooseText(item.name);
    if (!normalizedName) {
      byName.set(`__unnamed__|${item.id}|${item.category.id}`, [item]);
      continue;
    }
    const key = `${normalizedName}|${item.category.id}`;
    if (!byName.has(key)) {
      byName.set(key, []);
    }
    byName.get(key).push(item);
  }

  const collapsedGroups = [];
  const kept = [];
  for (const [key, group] of byName.entries()) {
    const itemsInGroup = Array.isArray(group) ? [...group] : [];
    if (!itemsInGroup.length) continue;
    if (key.startsWith("__unnamed__|")) {
      kept.push(...itemsInGroup);
      continue;
    }

    itemsInGroup.sort((a, b) => {
      const scoreDiff = scoreLiveChannel(b) - scoreLiveChannel(a);
      if (scoreDiff !== 0) return scoreDiff;
      return safeText(a.name).localeCompare(safeText(b.name));
    });
    const limited = itemsInGroup.slice(0, LIVE_TV_MAX_NAME_VARIANTS);
    kept.push(...limited);
    if (itemsInGroup.length > limited.length) {
      collapsedGroups.push({
        name: safeText(itemsInGroup[0]?.name) || "Sin nombre",
        category: safeText(itemsInGroup[0]?.category?.name) || "Variado",
        total: itemsInGroup.length,
        kept: limited.length,
        dropped: itemsInGroup.length - limited.length
      });
    }
  }

  const output = kept
    .map((item) => ({ ...item, id: makeLiveChannelId(item) }))
    .sort((a, b) => {
      const categoryDiff = a.category.name.localeCompare(b.category.name);
      if (categoryDiff !== 0) return categoryDiff;
      return a.name.localeCompare(b.name);
    });

  const stats = {
    section,
    inputCount: items.length,
    afterUrlCount: byUrl.size,
    keptCount: output.length,
    droppedByUrlCount: Math.max(0, items.length - byUrl.size),
    droppedByNameCount: Math.max(0, byUrl.size - output.length),
    maxVariantsPerName: LIVE_TV_MAX_NAME_VARIANTS,
    topCollapsedGroups: collapsedGroups.sort((a, b) => b.dropped - a.dropped).slice(0, 10)
  };

  console.log(
    `[LIVE-TV-DEDUPE] section=${section} input=${stats.inputCount} afterUrl=${stats.afterUrlCount} kept=${stats.keptCount} droppedUrl=${stats.droppedByUrlCount} droppedName=${stats.droppedByNameCount} maxVariants=${stats.maxVariantsPerName}`
  );
  if (stats.topCollapsedGroups.length) {
    const preview = stats.topCollapsedGroups
      .slice(0, 3)
      .map((item) => `${item.name} (${item.category}) -${item.dropped}`)
      .join(" | ");
    console.log(`[LIVE-TV-DEDUPE] section=${section} topCollapsed=${preview}`);
  }

  if (withStats) {
    return { channels: output, stats };
  }
  return output;
}

function summarizeSection(channels) {
  const categoryMap = new Map();
  for (const channel of channels) {
    const key = channel.category.id;
    if (!categoryMap.has(key)) {
      categoryMap.set(key, {
        id: channel.category.id,
        name: channel.category.name,
        count: 0
      });
    }
    categoryMap.get(key).count += 1;
  }
  const categories = [...categoryMap.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });
  return {
    channels,
    categories,
    channelById: new Map(channels.map((item) => [item.id, item]))
  };
}

function getLiveTvSummary() {
  return {
    dir: liveTvState.dir,
    loadedAt: liveTvState.loadedAt,
    fileCount: liveTvState.files.length,
    categoryCount: liveTvState.categories.length,
    channelCount: liveTvState.channels.length,
    eventosCount: eventosState.channels.length,
    marathonCount: marathonState.channels.length,
    vodCount: vodState.totalCount,
    activeSource: liveTvState.activeSource || "local",
    diagnostics: liveTvState.diagnostics || null
  };
}

function readPlaylistsFromDir(dir) {
  if (!fs.existsSync(dir)) return { files: [], channels: [] };

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => LIVE_TV_PLAYLIST_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .filter((name) => !/^master_/i.test(name))
    .filter((name) => !/^canal_/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const channels = [];
  for (const fileName of entries) {
    const filePath = path.join(dir, fileName);
    try {
      const parsedChannels = parseLiveTvPlaylist(filePath);
      appendItems(channels, parsedChannels);
    } catch (error) {
      console.warn(
        `[LIVE-TV] archivo ignorado por error de parseo file=${fileName} reason=${safeText(error?.message) || "unknown"}`
      );
    }
  }
  return { files: entries, channels };
}

function resetSectionState(sectionState, loadedAt) {
  sectionState.loadedAt = loadedAt;
  sectionState.categories = [];
  sectionState.channels = [];
  sectionState.channelById = new Map();
}

function loadAllFromDisk() {
  const activeSource = liveTvState.activeSource || "local";
  const cacheDir = getCacheDir();

  const allParsed = [];
  const allFiles = [];

  if (activeSource === "local" || activeSource === "all") {
    const { files, channels } = readPlaylistsFromDir(liveTvState.dir);
    appendItems(allParsed, channels);
    appendItems(allFiles, files);
  }

  if (activeSource === "remote" || activeSource === "all") {
    const { files, channels } = readPlaylistsFromDir(cacheDir);
    appendItems(allParsed, channels);
    appendItems(allFiles, files);
  }

  if (!allFiles.length && activeSource === "local" && !fs.existsSync(liveTvState.dir)) {
    const loadedAt = new Date().toISOString();
    liveTvState.loadedAt = loadedAt;
    liveTvState.categories = [];
      liveTvState.channels = [];
      liveTvState.channelById = new Map();
      liveTvState.files = [];
      liveTvState.diagnostics = null;

    resetSectionState(eventosState, loadedAt);
    resetSectionState(marathonState, loadedAt);

    vodState.loadedAt = loadedAt;
    vodState.entries = [];
    vodState.byTitle = new Map();
    vodState.byEpisode = new Map();
    vodState.totalCount = 0;

    return { ...getLiveTvSummary(), exists: false };
  }

  const tvRaw = [];
  const eventosRaw = [];
  const marathonRaw = [];
  const vodRaw = [];
  const rawBySource = new Map();

  for (const channel of allParsed) {
    const bucket = classifyGroupTitle(channel.groupTitle);
    const sourceFile = safeText(channel?.sourceFile) || "desconocido";
    if (!rawBySource.has(sourceFile)) {
      rawBySource.set(sourceFile, { sourceFile, total: 0, tv: 0, eventos: 0, marathon247: 0, ondemand: 0 });
    }
    const sourceStats = rawBySource.get(sourceFile);
    sourceStats.total += 1;
    if (bucket === "eventos") {
      eventosRaw.push(channel);
      sourceStats.eventos += 1;
      continue;
    }
    if (bucket === "247") {
      marathonRaw.push(channel);
      sourceStats.marathon247 += 1;
      continue;
    }
    if (bucket === "ondemand") {
      vodRaw.push(channel);
      sourceStats.ondemand += 1;
      continue;
    }
    tvRaw.push(channel);
    sourceStats.tv += 1;
  }

  const tvDedupe = dedupeLiveChannels(tvRaw, { section: "tv", withStats: true });
  const eventosDedupe = dedupeLiveChannels(eventosRaw, { section: "eventos", withStats: true });
  const marathonDedupe = dedupeLiveChannels(marathonRaw, { section: "247", withStats: true });
  const tvSection = summarizeSection(tvDedupe.channels);
  const eventosSection = summarizeSection(eventosDedupe.channels);
  const marathonSection = summarizeSection(marathonDedupe.channels);
  const loadedAt = new Date().toISOString();

  liveTvState.loadedAt = loadedAt;
  liveTvState.files = allFiles;
  liveTvState.channels = tvSection.channels;
  liveTvState.categories = tvSection.categories;
  liveTvState.diagnostics = {
    loadedAt,
    activeSource,
    variantLimitPerName: LIVE_TV_MAX_NAME_VARIANTS,
    rawBuckets: {
      tv: tvRaw.length,
      eventos: eventosRaw.length,
      marathon247: marathonRaw.length,
      ondemand: vodRaw.length
    },
    rawBySource: [...rawBySource.values()].sort((a, b) => b.total - a.total),
    dedupe: {
      tv: tvDedupe.stats,
      eventos: eventosDedupe.stats,
      marathon247: marathonDedupe.stats
    }
  };

  eventosState.loadedAt = loadedAt;
  eventosState.channels = eventosSection.channels;
  eventosState.categories = eventosSection.categories;
  eventosState.channelById = eventosSection.channelById;

  marathonState.loadedAt = loadedAt;
  marathonState.channels = marathonSection.channels;
  marathonState.categories = marathonSection.categories;
  marathonState.channelById = marathonSection.channelById;

  // Mantener compatibilidad con el proxy de Live TV para Eventos y 24/7.
  liveTvState.channelById = new Map([
    ...tvSection.channelById.entries(),
    ...eventosSection.channelById.entries(),
    ...marathonSection.channelById.entries()
  ]);

  buildVodIndex(vodRaw);

  return { ...getLiveTvSummary(), exists: allFiles.length > 0 };
}

function loadLiveTvFromDisk() {
  return loadAllFromDisk();
}

module.exports = {
  dedupeLiveChannels,
  getLiveTvSummary,
  loadAllFromDisk,
  loadLiveTvFromDisk
};
