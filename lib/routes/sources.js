const { safeText } = require("../utils");
const { state } = require("../state");
const { loadManifest } = require("../catalog/fetcher");
const { loadSourcesFromDisk } = require("../sources/loader");

function registerSourceRoutes(app) {
  app.get("/api/sources", (req, res) => {
    return res.json({
      loadedAt: state.loadedAt,
      catalog: state.catalogSources,
      stream: state.streamSources,
      subtitle: state.subtitleSources
    });
  });

  app.post("/api/sources/reload", (req, res) => {
    try {
      const summary = loadSourcesFromDisk();
      return res.json({
        ok: true,
        ...summary,
        loadedAt: state.loadedAt
      });
    } catch (error) {
      return res.status(500).json({
        error: `No se pudieron recargar fuentes: ${error.message}`
      });
    }
  });

  app.get("/api/sources/:role/:id/manifest", async (req, res) => {
    const role = safeText(req.params.role).toLowerCase();
    const sourceId = safeText(req.params.id);

    const pool =
      role === "catalog"
        ? state.catalogSources
        : role === "stream"
          ? state.streamSources
          : role === "subtitle"
            ? state.subtitleSources
            : [];
    const source = pool.find((entry) => entry.id === sourceId);

    if (!source) {
      return res.status(404).json({ error: "Fuente no encontrada" });
    }

    try {
      const manifest = await loadManifest(source, req.query.force === "true");
      return res.json({ source, manifest });
    } catch (error) {
      return res.status(502).json({
        source,
        error: `No se pudo leer manifest: ${error.message}`
      });
    }
  });
}

module.exports = { registerSourceRoutes };
