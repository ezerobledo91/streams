const fs = require("fs");
const { safeText, clamp } = require("../utils");
const { liveTvState } = require("../state");
const { normalizeLooseText, normalizeLiveCategoryId } = require("../live-tv/parser");
const { getLiveTvSummary, loadLiveTvFromDisk } = require("../live-tv/manager");

function registerLiveTvRoutes(app) {
  app.get("/api/live-tv/status", (req, res) => {
    return res.json({
      ...getLiveTvSummary(),
      exists: fs.existsSync(liveTvState.dir)
    });
  });

  app.post("/api/live-tv/reload", (req, res) => {
    try {
      const summary = loadLiveTvFromDisk();
      return res.json({ ok: true, ...summary });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "No se pudo recargar Live TV." });
    }
  });

  app.get("/api/live-tv/categories", (req, res) => {
    return res.json({
      loadedAt: liveTvState.loadedAt,
      categories: liveTvState.categories
    });
  });

  app.get("/api/live-tv/channels", (req, res) => {
    const rawCategory = safeText(req.query.category).toLowerCase();
    const category = rawCategory && rawCategory !== "all" ? normalizeLiveCategoryId(rawCategory) : "";
    const query = normalizeLooseText(req.query.query);
    const webOnly = req.query.webOnly !== "false";
    const page = clamp(Number.parseInt(req.query.page, 10) || 1, 1, 400);
    const limit = clamp(Number.parseInt(req.query.limit, 10) || 120, 20, 400);

    let pool = liveTvState.channels;
    if (category) {
      pool = pool.filter((item) => item.category.id === category);
    }
    if (webOnly) {
      pool = pool.filter((item) => item.webPlayable);
    }
    if (query) {
      pool = pool.filter((item) => item.searchText.includes(query));
    }

    const total = pool.length;
    const offset = (page - 1) * limit;
    const items = pool.slice(offset, offset + limit).map(({ searchText, ...channel }) => channel);

    return res.json({
      loadedAt: liveTvState.loadedAt,
      category: category || "all",
      query: safeText(req.query.query),
      webOnly,
      page,
      limit,
      total,
      items
    });
  });

  app.get("/api/live-tv/channels/:id", (req, res) => {
    const id = safeText(req.params.id);
    const item = liveTvState.channelById.get(id);
    if (!item) {
      return res.status(404).json({ error: "Canal no encontrado." });
    }
    const { searchText, ...channel } = item;
    return res.json(channel);
  });

  app.get("/api/live-tv/channels/:id/stream", (req, res) => {
    const id = safeText(req.params.id);
    const item = liveTvState.channelById.get(id);
    if (!item) {
      return res.status(404).json({ error: "Canal no encontrado." });
    }
    if (!item.webPlayable) {
      return res.status(400).json({ error: "El canal no es reproducible en navegador (protocolo no soportado)." });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, item.streamUrl);
  });
}

module.exports = { registerLiveTvRoutes };
