const state = {
  category: "movie",
  query: "",
  items: [],
  selectedItem: null,
  rankedCandidates: [],
  currentPlayIndex: -1,
  searchDebounce: null,
  sources: {
    catalog: [],
    stream: []
  }
};

const elements = {
  sourcesSummary: document.getElementById("sources-summary"),
  reloadSourcesBtn: document.getElementById("reload-sources-btn"),
  categoryTabs: [...document.querySelectorAll("#category-tabs .tab")],
  searchInput: document.getElementById("catalog-search-input"),
  searchBtn: document.getElementById("catalog-search-btn"),
  clearBtn: document.getElementById("catalog-clear-btn"),
  catalogSummary: document.getElementById("catalog-summary"),
  catalogGrid: document.getElementById("catalog-grid"),
  selectedItem: document.getElementById("selected-item"),
  itemIdInput: document.getElementById("item-id-input"),
  episodeFields: document.getElementById("episode-fields"),
  seasonInput: document.getElementById("season-input"),
  episodeInput: document.getElementById("episode-input"),
  findStreamsBtn: document.getElementById("find-streams-btn"),
  nextStreamBtn: document.getElementById("next-stream-btn"),
  rankingList: document.getElementById("ranking-list"),
  video: document.getElementById("video"),
  playbackStatus: document.getElementById("playback-status")
};

let torrentClient = null;
let activeTorrent = null;
let activeMonitor = null;

async function api(path, options) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setPlaybackStatus(message, warn = false) {
  elements.playbackStatus.textContent = message;
  elements.playbackStatus.classList.toggle("tag-warn", warn);
  elements.playbackStatus.classList.toggle("tag-ok", !warn);
}

function formatRating(rating) {
  const numeric = Number(rating);
  if (!Number.isFinite(numeric) || numeric <= 0) return "Sin rating";
  return `${numeric.toFixed(1)}/10`;
}

function formatSpeed(bytesPerSecond) {
  const value = Number(bytesPerSecond || 0);
  if (value <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let size = value;
  let unitIdx = 0;

  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx += 1;
  }

  return `${size.toFixed(1)} ${units[unitIdx]}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value <= 0) return "N/D";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIdx = 0;

  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx += 1;
  }

  return `${size.toFixed(2)} ${units[unitIdx]}`;
}

function parseInteger(value) {
  if (value === null || value === undefined) return 0;
  const numeric = Number(String(value).replace(/[^\d]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseNumberFromText(text, patterns) {
  if (!text) return 0;

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return parseInteger(match[1]);
    }
  }

  return 0;
}

function extractSeeders(stream) {
  const direct = parseInteger(
    stream.seeders ||
      stream.seeds ||
      stream.behaviorHints?.seeders ||
      stream.behaviorHints?.seeds ||
      0
  );
  if (direct > 0) return direct;

  const text = [stream.title, stream.name, stream.description].filter(Boolean).join(" ");
  return parseNumberFromText(text, [
    /seeders?\D+(\d+)/i,
    /seeds?\D+(\d+)/i,
    /(\d+)\s*seeders?/i,
    /(\d+)\s*seeds?/i,
    /semillas?\D+(\d+)/i
  ]);
}

function extractPeers(stream) {
  const direct = parseInteger(stream.peers || stream.behaviorHints?.peers || 0);
  if (direct > 0) return direct;

  const text = [stream.title, stream.name, stream.description].filter(Boolean).join(" ");
  return parseNumberFromText(text, [
    /peers?\D+(\d+)/i,
    /(\d+)\s*peers?/i,
    /leechers?\D+(\d+)/i
  ]);
}

function extractResolution(stream) {
  const text = [stream.title, stream.name, stream.description].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("2160") || text.includes("4k")) return 2160;
  if (text.includes("1440")) return 1440;
  if (text.includes("1080")) return 1080;
  if (text.includes("720")) return 720;
  if (text.includes("480")) return 480;
  return 0;
}

function extractVideoSizeBytes(stream) {
  const fromHint = Number(stream.behaviorHints?.videoSize || 0);
  if (Number.isFinite(fromHint) && fromHint > 0) return fromHint;

  const text = [stream.title, stream.name, stream.description].filter(Boolean).join(" ");
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(gb|mb|tb)/i);
  if (!match) return 0;

  const raw = Number(match[1].replace(",", "."));
  if (!Number.isFinite(raw) || raw <= 0) return 0;

  const unit = match[2].toLowerCase();
  if (unit === "mb") return raw * 1024 * 1024;
  if (unit === "gb") return raw * 1024 * 1024 * 1024;
  if (unit === "tb") return raw * 1024 * 1024 * 1024 * 1024;
  return 0;
}

function getTrackers(stream) {
  const trackers = [];
  if (Array.isArray(stream.sources)) {
    for (const source of stream.sources) {
      if (typeof source !== "string") continue;
      if (source.startsWith("tracker:")) {
        trackers.push(source.slice("tracker:".length));
      }
    }
  }
  return [...new Set(trackers)];
}

function buildMagnet(stream, displayName) {
  if (typeof stream.url === "string" && stream.url.startsWith("magnet:")) {
    return stream.url;
  }

  if (Array.isArray(stream.sources)) {
    const directMagnet = stream.sources.find(
      (entry) => typeof entry === "string" && entry.startsWith("magnet:")
    );
    if (directMagnet) return directMagnet;
  }

  const infoHash = String(stream.infoHash || "").trim();
  if (!infoHash) return null;

  const params = new URLSearchParams();
  params.set("xt", `urn:btih:${infoHash}`);
  if (displayName) {
    params.set("dn", displayName);
  }

  for (const tracker of getTrackers(stream)) {
    params.append("tr", tracker);
  }

  return `magnet:?${params.toString()}`;
}

function getDirectUrl(stream) {
  if (typeof stream.url !== "string") return null;
  const value = stream.url.trim();
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return null;
}

function calculateScore(stream) {
  const seeders = extractSeeders(stream);
  const peers = extractPeers(stream);
  const resolution = extractResolution(stream);
  const videoSizeBytes = extractVideoSizeBytes(stream);
  const sizeGb = videoSizeBytes > 0 ? videoSizeBytes / (1024 * 1024 * 1024) : 0;
  const trackers = getTrackers(stream).length;
  const hasTorrent = Boolean(stream.infoHash || (stream.url || "").startsWith("magnet:"));

  const score =
    seeders * 6 +
    peers * 2 +
    resolution / 120 +
    trackers * 1.5 +
    (hasTorrent ? 8 : 4) -
    sizeGb * 1.4;

  return {
    score,
    seeders,
    peers,
    resolution,
    videoSizeBytes,
    trackers
  };
}

function buildCandidate(stream, provider, streamIndex) {
  const displayName = stream.title || stream.name || `Stream ${streamIndex + 1}`;
  const magnet = buildMagnet(stream, displayName);
  const directUrl = getDirectUrl(stream);
  const metrics = calculateScore(stream);
  const fileIdx = Number.isFinite(Number(stream.fileIdx)) ? Number(stream.fileIdx) : null;

  if (!magnet && !directUrl) {
    return null;
  }

  return {
    providerId: provider.id,
    providerName: provider.name,
    providerBaseUrl: provider.baseUrl,
    displayName,
    magnet,
    directUrl,
    stream,
    fileIdx,
    ...metrics
  };
}

function setActiveCategory(category) {
  state.category = category;
  for (const tab of elements.categoryTabs) {
    tab.classList.toggle("is-active", tab.dataset.category === category);
  }
  updateEpisodeVisibility();
}

function getCurrentType() {
  const selectedType = String(state.selectedItem?.type || "").trim();
  if (selectedType) return selectedType;
  return state.category;
}

function updateEpisodeVisibility() {
  const currentType = getCurrentType();
  const visible = currentType === "series";
  elements.episodeFields.classList.toggle("hidden", !visible);
}

function updateActionButtons() {
  const hasItemId = Boolean(elements.itemIdInput.value.trim());
  elements.findStreamsBtn.disabled = !hasItemId;

  const hasCandidates = Array.isArray(state.rankedCandidates) && state.rankedCandidates.length > 0;
  const canNext = hasCandidates && state.currentPlayIndex < state.rankedCandidates.length - 1;
  elements.nextStreamBtn.disabled = !canNext;
}

function renderSourcesSummary() {
  const catalogActive = state.sources.catalog.filter((source) => source.active).length;
  const streamActive = state.sources.stream.filter((source) => source.active).length;
  elements.sourcesSummary.textContent = `Catalogos: ${catalogActive}/${state.sources.catalog.length} | Streams: ${streamActive}/${state.sources.stream.length}`;
}

function renderCatalogSummary(summaryText) {
  elements.catalogSummary.textContent = summaryText;
}

function selectItem(item) {
  state.selectedItem = {
    id: item.id,
    type: item.type,
    name: item.name
  };

  elements.itemIdInput.value = item.id || "";
  elements.selectedItem.textContent = `Seleccionado: ${item.name || "Sin titulo"} (${item.id || "sin id"})`;
  setActiveCategory(item.type || state.category);
  updateEpisodeVisibility();
  updateActionButtons();
}

function renderCatalogItems(items) {
  elements.catalogGrid.innerHTML = "";

  if (!Array.isArray(items) || !items.length) {
    elements.catalogGrid.innerHTML = '<div class="muted">No se encontraron resultados.</div>';
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "catalog-card";
    const poster = String(item.poster || item.background || "").trim();

    card.innerHTML = `
      ${poster ? `<img loading="lazy" src="${escapeHtml(poster)}" alt="${escapeHtml(item.name || "")}" />` : '<div class="card-placeholder">Sin imagen</div>'}
      <div class="catalog-card-content">
        <strong>${escapeHtml(item.name || "Sin titulo")}</strong>
        <div class="muted">${escapeHtml(item.year || "")} | ${escapeHtml(formatRating(item.rating))}</div>
        <div class="muted">Fuente: ${escapeHtml(item.source?.name || "N/D")}</div>
        <p>${escapeHtml(item.description || "Sin descripcion")}</p>
        <button type="button">Seleccionar</button>
      </div>
    `;

    card.querySelector("button").addEventListener("click", () => {
      selectItem(item);
    });

    elements.catalogGrid.appendChild(card);
  }
}

function renderRanking(candidates) {
  elements.rankingList.innerHTML = "";

  if (!candidates.length) {
    elements.rankingList.innerHTML = '<div class="muted">No se encontraron streams reproducibles.</div>';
    return;
  }

  candidates.forEach((candidate, index) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
      <div><strong>#${index + 1} ${escapeHtml(candidate.displayName)}</strong></div>
      <div class="muted">${escapeHtml(candidate.providerName)} - ${escapeHtml(candidate.providerBaseUrl)}</div>
      <div>
        <span class="score">Score ${candidate.score.toFixed(1)}</span> |
        seeders ${candidate.seeders} |
        peers ${candidate.peers} |
        ${candidate.resolution || "?"}p |
        size ${formatBytes(candidate.videoSizeBytes)}
      </div>
      <div class="muted">${candidate.magnet ? "torrent" : "url directa"}</div>
      <button type="button" data-play-index="${index}">Reproducir este</button>
    `;

    row.querySelector("button").addEventListener("click", async () => {
      const playedIndex = await playWithFallback(candidates, index);
      if (playedIndex >= 0) {
        state.currentPlayIndex = playedIndex;
      }
      updateActionButtons();
    });

    elements.rankingList.appendChild(row);
  });
}

function getTorrentClient() {
  if (!window.WebTorrent) {
    throw new Error("WebTorrent no se cargo en el navegador.");
  }
  if (!torrentClient || torrentClient.destroyed) {
    torrentClient = new window.WebTorrent();
  }
  return torrentClient;
}

function clearActivePlayback() {
  if (activeMonitor) {
    clearInterval(activeMonitor);
    activeMonitor = null;
  }

  if (activeTorrent) {
    try {
      activeTorrent.destroy();
    } catch {
      // no-op
    }
    activeTorrent = null;
  }

  elements.video.pause();
  elements.video.removeAttribute("src");
  elements.video.load();
}

function pickVideoFile(torrent, fileIdx) {
  if (Number.isInteger(fileIdx) && torrent.files[fileIdx]) {
    return torrent.files[fileIdx];
  }

  const videoExtensions = [".mp4", ".mkv", ".webm", ".avi", ".mov"];
  const playable = torrent.files.filter((file) =>
    videoExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
  );

  if (!playable.length) return null;
  return playable.sort((a, b) => b.length - a.length)[0];
}

function playDirectUrl(candidate) {
  clearActivePlayback();
  elements.video.src = candidate.directUrl;
  elements.video.play().catch(() => {});
  setPlaybackStatus(`Reproduciendo URL directa: ${candidate.displayName}`);
}

function playMagnet(candidate) {
  return new Promise((resolve, reject) => {
    let done = false;
    const client = getTorrentClient();
    clearActivePlayback();

    const torrent = client.add(candidate.magnet, {
      announce: getTrackers(candidate.stream)
    });
    activeTorrent = torrent;
    const startedAt = Date.now();

    const fail = (reason) => {
      if (done) return;
      done = true;
      clearInterval(activeMonitor);
      activeMonitor = null;
      try {
        torrent.destroy();
      } catch {
        // no-op
      }
      reject(new Error(reason));
    };

    const succeed = () => {
      if (done) return;
      done = true;
      clearInterval(activeMonitor);
      activeMonitor = null;
      resolve();
    };

    torrent.on("error", (error) => {
      fail(error?.message || "Error en torrent");
    });

    torrent.on("ready", () => {
      const file = pickVideoFile(torrent, candidate.fileIdx);
      if (!file) {
        fail("El torrent no contiene archivos de video soportados.");
        return;
      }

      file.renderTo(elements.video, { autoplay: true }, (error) => {
        if (error) {
          fail(error.message || "No se pudo renderizar video.");
          return;
        }
        setPlaybackStatus(
          `Reproduciendo torrent: ${candidate.displayName} | peers ${torrent.numPeers} | velocidad ${formatSpeed(torrent.downloadSpeed)}`
        );
        succeed();
      });
    });

    activeMonitor = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const peers = torrent.numPeers || 0;
      const speed = torrent.downloadSpeed || 0;
      const progress = Number(torrent.progress || 0) * 100;
      setPlaybackStatus(
        `Conectando torrent: ${candidate.displayName} | peers ${peers} | velocidad ${formatSpeed(speed)} | progreso ${progress.toFixed(1)}%`
      );

      if (elapsed > 18000 && peers < 1 && speed < 20 * 1024) {
        fail("Sin peers o velocidad inicial suficiente.");
      }
    }, 1000);
  });
}

async function playWithFallback(candidates, startIndex = 0) {
  for (let idx = startIndex; idx < candidates.length; idx += 1) {
    const candidate = candidates[idx];
    try {
      if (candidate.directUrl && !candidate.magnet) {
        playDirectUrl(candidate);
        return idx;
      }

      if (candidate.magnet) {
        setPlaybackStatus(`Intentando stream #${idx + 1}: ${candidate.displayName}`);
        await playMagnet(candidate);
        return idx;
      }
    } catch (error) {
      setPlaybackStatus(`Fallback al siguiente stream: ${error.message}`, true);
    }
  }

  setPlaybackStatus("No se pudo iniciar reproduccion con los streams obtenidos.", true);
  return -1;
}

async function loadSources() {
  const payload = await api("/api/sources");
  state.sources.catalog = payload.catalog || [];
  state.sources.stream = payload.stream || [];
  renderSourcesSummary();
}

async function reloadSources() {
  await api("/api/sources/reload", { method: "POST", body: "{}" });
  await loadSources();
  await loadCatalog();
  setPlaybackStatus("Fuentes recargadas desde JSON.");
}

async function loadCatalog() {
  const query = elements.searchInput.value.trim();
  state.query = query;

  renderCatalogSummary("Cargando catalogo...");

  const params = new URLSearchParams({
    category: state.category,
    limit: "60"
  });
  if (query) {
    params.set("query", query);
  }

  const payload = await api(`/api/catalog/browse?${params.toString()}`);
  state.items = payload.items || [];
  renderCatalogItems(state.items);

  const sourceSummary = payload.summary || {};
  renderCatalogSummary(
    `Categoria: ${state.category} | Resultados: ${state.items.length} | TMDB: ${sourceSummary.tmdbItems || 0} | Addons: ${sourceSummary.addonItems || 0}`
  );
}

async function findAndPlayStreams() {
  const itemId = elements.itemIdInput.value.trim();
  if (!itemId) {
    setPlaybackStatus("Selecciona un item o escribe itemId.", true);
    return;
  }

  const type = getCurrentType();
  const params = new URLSearchParams({
    type,
    itemId,
    onlyActive: "true"
  });

  if (type === "series") {
    const season = String(elements.seasonInput.value || "").trim();
    const episode = String(elements.episodeInput.value || "").trim();
    if (season) params.set("season", season);
    if (episode) params.set("episode", episode);
  }

  setPlaybackStatus("Buscando streams en fuentes activas...");
  const payload = await api(`/api/streams?${params.toString()}`);

  const candidates = [];
  for (const providerResult of payload.results || []) {
    if (!providerResult.ok) continue;
    providerResult.streams.forEach((stream, idx) => {
      const candidate = buildCandidate(stream, providerResult.provider, idx);
      if (candidate) candidates.push(candidate);
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  state.rankedCandidates = candidates;
  state.currentPlayIndex = -1;
  renderRanking(candidates);
  updateActionButtons();

  if (!candidates.length) {
    setPlaybackStatus("No se encontraron streams reproducibles.", true);
    return;
  }

  const playedIndex = await playWithFallback(candidates, 0);
  if (playedIndex >= 0) {
    state.currentPlayIndex = playedIndex;
  }
  updateActionButtons();
}

async function playNextAlternative() {
  if (!state.rankedCandidates.length) {
    setPlaybackStatus("Primero debes buscar streams.", true);
    return;
  }

  const startIndex = Math.max(0, state.currentPlayIndex + 1);
  if (startIndex >= state.rankedCandidates.length) {
    setPlaybackStatus("No hay mas alternativas en este ranking.", true);
    updateActionButtons();
    return;
  }

  const playedIndex = await playWithFallback(state.rankedCandidates, startIndex);
  if (playedIndex >= 0) {
    state.currentPlayIndex = playedIndex;
  }
  updateActionButtons();
}

function bindEvents() {
  elements.reloadSourcesBtn.addEventListener("click", async () => {
    try {
      await reloadSources();
    } catch (error) {
      setPlaybackStatus(`No se pudieron recargar fuentes: ${error.message}`, true);
    }
  });

  for (const tab of elements.categoryTabs) {
    tab.addEventListener("click", async () => {
      if (tab.dataset.category === state.category) return;
      setActiveCategory(tab.dataset.category);
      state.selectedItem = null;
      elements.selectedItem.textContent = "Ningun titulo seleccionado.";
      elements.itemIdInput.value = "";
      state.rankedCandidates = [];
      state.currentPlayIndex = -1;
      renderRanking([]);
      updateActionButtons();

      try {
        await loadCatalog();
      } catch (error) {
        setPlaybackStatus(`No se pudo cargar catalogo: ${error.message}`, true);
      }
    });
  }

  elements.searchBtn.addEventListener("click", async () => {
    try {
      await loadCatalog();
    } catch (error) {
      setPlaybackStatus(`Busqueda fallo: ${error.message}`, true);
    }
  });

  elements.clearBtn.addEventListener("click", async () => {
    elements.searchInput.value = "";
    try {
      await loadCatalog();
    } catch (error) {
      setPlaybackStatus(`No se pudo limpiar busqueda: ${error.message}`, true);
    }
  });

  elements.searchInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    try {
      await loadCatalog();
    } catch (error) {
      setPlaybackStatus(`Busqueda fallo: ${error.message}`, true);
    }
  });

  elements.searchInput.addEventListener("input", () => {
    if (state.searchDebounce) {
      clearTimeout(state.searchDebounce);
      state.searchDebounce = null;
    }

    state.searchDebounce = setTimeout(async () => {
      try {
        await loadCatalog();
      } catch {
        // no-op
      }
    }, 450);
  });

  elements.itemIdInput.addEventListener("input", () => {
    updateActionButtons();
  });

  elements.findStreamsBtn.addEventListener("click", async () => {
    try {
      await findAndPlayStreams();
    } catch (error) {
      setPlaybackStatus(`Error buscando streams: ${error.message}`, true);
    }
  });

  elements.nextStreamBtn.addEventListener("click", async () => {
    try {
      await playNextAlternative();
    } catch (error) {
      setPlaybackStatus(`No se pudo pasar al siguiente stream: ${error.message}`, true);
    }
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // no-op
    });
  });
}

async function init() {
  registerServiceWorker();
  bindEvents();
  setActiveCategory("movie");
  updateActionButtons();
  renderRanking([]);

  await loadSources();
  await loadCatalog();

  setPlaybackStatus("Listo. Navega el catalogo y reproduce.");
}

init().catch((error) => {
  setPlaybackStatus(`Inicializacion fallo: ${error.message}`, true);
});
