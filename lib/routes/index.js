const { registerTmdbRoutes } = require("./tmdb");
const { registerReliabilityRoutes } = require("./reliability");
const { registerSourceRoutes } = require("./sources");
const { registerLiveTvRoutes } = require("./live-tv");
const { registerEventosRoutes } = require("./eventos");
const { register247Routes } = require("./247");
const { registerCatalogRoutes } = require("./catalog");
const { registerStreamRoutes } = require("./streams");
const { registerMetaRoutes } = require("./meta");
const { registerSubtitleRoutes } = require("./subtitles");
const { registerPlaybackRoutes } = require("./playback");
const { registerAvailabilityRoutes } = require("./availability");
const { registerUserRoutes } = require("./users");

function registerApiRoutes(app) {
  registerTmdbRoutes(app);
  registerReliabilityRoutes(app);
  registerSourceRoutes(app);
  registerLiveTvRoutes(app);
  registerEventosRoutes(app);
  register247Routes(app);
  registerCatalogRoutes(app);
  registerStreamRoutes(app);
  registerMetaRoutes(app);
  registerSubtitleRoutes(app);
  registerPlaybackRoutes(app);
  registerAvailabilityRoutes(app);
  registerUserRoutes(app);
}

module.exports = { registerApiRoutes };
