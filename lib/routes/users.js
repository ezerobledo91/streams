const {
  ensureUser,
  getUser,
  toggleFavorite,
  markUnavailable,
  sanitizeUsername,
  listUsers,
  upsertContinueWatching,
  getContinueWatchingForUser
} = require("../user-store");

function registerUserRoutes(app) {
  app.post("/api/users/login", (req, res) => {
    const usernameRaw = String(req.body?.username || req.query.username || "");
    const username = sanitizeUsername(usernameRaw);
    if (!usernameRaw.trim()) {
      return res.status(400).json({ error: "username requerido" });
    }
    const displayName = String(req.body?.displayName || req.query.displayName || usernameRaw).trim() || username;
    const user = ensureUser({ username, displayName });
    return res.json({ user });
  });

  // IMPORTANT: /list must come before /:username to avoid matching "list" as a username
  app.get("/api/users/list", (req, res) => {
    const users = listUsers();
    return res.json({ users });
  });

  app.get("/api/users/:username", (req, res) => {
    const user = getUser(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "usuario no encontrado" });
    }
    return res.json({ user });
  });

  app.post("/api/users/:username/favorites", (req, res) => {
    const user = getUser(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "usuario no encontrado" });
    }
    const payload = req.body?.item;
    if (!payload || !payload.type || !payload.id) {
      return res.status(400).json({ error: "item invalido" });
    }
    const updated = toggleFavorite(req.params.username, payload);
    return res.json({ user: updated });
  });

  app.post("/api/users/:username/unavailable", (req, res) => {
    const user = getUser(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "usuario no encontrado" });
    }
    const payload = {
      type: String(req.body?.type || req.query.type || "movie"),
      itemId: String(req.body?.itemId || req.query.itemId || "")
    };
    if (!payload.itemId) {
      return res.status(400).json({ error: "itemId requerido" });
    }
    const updated = markUnavailable(req.params.username, payload);
    return res.json({ user: updated });
  });

  app.post("/api/users/:username/continue-watching", (req, res) => {
    const user = getUser(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "usuario no encontrado" });
    }
    const entry = req.body;
    if (!entry || !entry.type || !entry.itemId) {
      return res.status(400).json({ error: "entry invalida (type + itemId requeridos)" });
    }
    const updated = upsertContinueWatching(req.params.username, entry);
    return res.json({ user: updated });
  });

  app.get("/api/users/:username/continue-watching", (req, res) => {
    const user = getUser(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "usuario no encontrado" });
    }
    const items = getContinueWatchingForUser(req.params.username);
    return res.json({ items });
  });
}

module.exports = { registerUserRoutes };
