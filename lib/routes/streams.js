const { safeText } = require("../utils");
const { fetchAggregatedStreams } = require("../streams/service");

function registerStreamRoutes(app) {
  app.get("/api/streams", async (req, res) => {
    const type = safeText(req.query.type);
    const itemId = safeText(req.query.itemId);
    const onlyActive = req.query.onlyActive !== "false";
    const season = safeText(req.query.season);
    const episode = safeText(req.query.episode);

    if (!type || !itemId) {
      return res.status(400).json({ error: "Debes enviar ?type=...&itemId=..." });
    }

    try {
      const payload = await fetchAggregatedStreams({
        type,
        itemId,
        onlyActive,
        season,
        episode
      });
      return res.json(payload);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });
}

module.exports = { registerStreamRoutes };
