const { safeText } = require("../utils");
const { fetchMetaDetails } = require("../meta/details");

function registerMetaRoutes(app) {
  app.get("/api/meta/details", async (req, res) => {
    const type = safeText(req.query.type);
    const itemId = safeText(req.query.itemId);
    const season = safeText(req.query.season);
    const episode = safeText(req.query.episode);

    if (!type || !itemId) {
      return res.status(400).json({ error: "Debes enviar ?type=...&itemId=..." });
    }

    try {
      const payload = await fetchMetaDetails(type, itemId, season, episode);
      return res.json(payload);
    } catch (error) {
      return res.status(502).json({ error: error?.message || "No se pudieron cargar detalles del titulo." });
    }
  });
}

module.exports = { registerMetaRoutes };
