const { resolveTmdbAuth, getTmdbLanguage } = require("../tmdb/client");

function registerTmdbRoutes(app) {
  app.get("/api/tmdb/status", (req, res) => {
    const auth = resolveTmdbAuth();

    return res.json({
      configured: Boolean(auth.bearerToken || auth.apiKey),
      language: getTmdbLanguage(),
      authMode: auth.bearerToken ? "bearer" : auth.apiKey ? "api_key" : "none"
    });
  });
}

module.exports = { registerTmdbRoutes };
