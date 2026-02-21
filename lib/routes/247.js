const { safeText, clamp } = require("../utils");
const { marathonState } = require("../state");
const { normalizeLooseText, normalizeLiveCategoryId } = require("../live-tv/parser");

function isWebPlayableCandidate(item) {
  return Boolean(item?.webPlayable) || /^https?:\/\//i.test(safeText(item?.streamUrl));
}

function toPublicChannel(item) {
  const { searchText, ...rest } = item || {};
  return rest;
}

function register247Routes(app) {
  app.get("/api/247/status", (req, res) => {
    return res.json({
      loadedAt: marathonState.loadedAt,
      categoryCount: marathonState.categories.length,
      channelCount: marathonState.channels.length
    });
  });

  app.get("/api/247/categories", (req, res) => {
    return res.json({
      loadedAt: marathonState.loadedAt,
      categories: marathonState.categories
    });
  });

  app.get("/api/247/channels", (req, res) => {
    const rawCategory = safeText(req.query.category).toLowerCase();
    const category = rawCategory && rawCategory !== "all" ? normalizeLiveCategoryId(rawCategory) : "";
    const query = normalizeLooseText(req.query.query);
    const webOnly = req.query.webOnly !== "false";
    const page = clamp(Number.parseInt(req.query.page, 10) || 1, 1, 400);
    const limit = clamp(Number.parseInt(req.query.limit, 10) || 120, 20, 15000);

    let pool = marathonState.channels;
    if (category) {
      pool = pool.filter((item) => item.category.id === category);
    }
    if (webOnly) {
      pool = pool.filter((item) => isWebPlayableCandidate(item));
    }
    if (query) {
      pool = pool.filter((item) => item.searchText.includes(query));
    }

    const total = pool.length;
    const offset = (page - 1) * limit;
    const items = pool.slice(offset, offset + limit).map((item) => toPublicChannel(item));

    return res.json({
      loadedAt: marathonState.loadedAt,
      category: category || "all",
      query: safeText(req.query.query),
      webOnly,
      page,
      limit,
      total,
      items
    });
  });

  app.get("/api/247/channels/:id", (req, res) => {
    const id = safeText(req.params.id);
    const item = marathonState.channelById.get(id);
    if (!item) {
      return res.status(404).json({ error: "Canal no encontrado." });
    }
    return res.json(toPublicChannel(item));
  });

  app.get("/api/247/channels/:id/stream", (req, res) => {
    const id = safeText(req.params.id);
    const item = marathonState.channelById.get(id);
    if (!item) {
      return res.status(404).json({ error: "Canal no encontrado." });
    }
    const mode = safeText(req.query.mode).toLowerCase();
    const quality = safeText(req.query.quality);
    const encodedId = encodeURIComponent(id);

    if (mode === "direct") {
      return res.redirect(302, `/api/live-tv/channels/${encodedId}/proxy`);
    }
    if (mode === "transcode") {
      const qualityQuery = quality ? `?quality=${encodeURIComponent(quality)}` : "";
      return res.redirect(302, `/api/live-tv/channels/${encodedId}/hls/index.m3u8${qualityQuery}`);
    }
    return res.redirect(302, `/api/live-tv/channels/${encodedId}/stream`);
  });
}

module.exports = { register247Routes };
