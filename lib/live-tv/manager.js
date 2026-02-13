const fs = require("fs");
const path = require("path");
const { LIVE_TV_PLAYLIST_EXTENSIONS } = require("../config");
const { liveTvState } = require("../state");
const {
  normalizeLooseText,
  scoreLiveChannel,
  makeLiveChannelId,
  canonicalizeHttpUrl,
  parseLiveTvPlaylist
} = require("./parser");

function pickBestLiveChannel(a, b) {
  return scoreLiveChannel(b) > scoreLiveChannel(a) ? b : a;
}

function dedupeLiveChannels(items) {
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
    const key = `${normalizeLooseText(item.name)}|${item.category.id}`;
    if (!key.startsWith("|") && !byName.has(key)) {
      byName.set(key, item);
      continue;
    }
    if (!key.startsWith("|")) {
      byName.set(key, pickBestLiveChannel(byName.get(key), item));
      continue;
    }
    byName.set(`${item.id}|${item.category.id}`, item);
  }

  return [...byName.values()]
    .map((item) => ({ ...item, id: makeLiveChannelId(item) }))
    .sort((a, b) => {
      const categoryDiff = a.category.name.localeCompare(b.category.name);
      if (categoryDiff !== 0) return categoryDiff;
      return a.name.localeCompare(b.name);
    });
}

function getLiveTvSummary() {
  return {
    dir: liveTvState.dir,
    loadedAt: liveTvState.loadedAt,
    fileCount: liveTvState.files.length,
    categoryCount: liveTvState.categories.length,
    channelCount: liveTvState.channels.length
  };
}

function loadLiveTvFromDisk() {
  const dir = liveTvState.dir;
  if (!fs.existsSync(dir)) {
    liveTvState.loadedAt = new Date().toISOString();
    liveTvState.categories = [];
    liveTvState.channels = [];
    liveTvState.channelById = new Map();
    liveTvState.files = [];
    return { ...getLiveTvSummary(), exists: false };
  }

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => LIVE_TV_PLAYLIST_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .filter((name) => !/^master_/i.test(name))
    .filter((name) => !/^canal_/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const parsed = [];
  for (const fileName of entries) {
    const filePath = path.join(dir, fileName);
    try {
      parsed.push(...parseLiveTvPlaylist(filePath));
    } catch {
      // ignore malformed playlist file
    }
  }

  const channels = dedupeLiveChannels(parsed);
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

  liveTvState.loadedAt = new Date().toISOString();
  liveTvState.files = entries;
  liveTvState.channels = channels;
  liveTvState.categories = [...categoryMap.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });
  liveTvState.channelById = new Map(channels.map((item) => [item.id, item]));

  return { ...getLiveTvSummary(), exists: true };
}

module.exports = {
  dedupeLiveChannels,
  getLiveTvSummary,
  loadLiveTvFromDisk
};
