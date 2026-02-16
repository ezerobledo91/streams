const fs = require("fs");
const path = require("path");
const os = require("os");
const express = require("express");

const {
  HOST,
  PORT,
  WEB_DIST_DIR,
  LEGACY_PUBLIC_DIR,
  STREAM_RELIABILITY_FILE,
  PLAYBACK_HLS_DIR
} = require("./lib/config");
const { ensureDirSync } = require("./lib/utils");
const { loadReliabilityFromDisk } = require("./lib/reliability/persistence");
const { loadSourcesFromDisk } = require("./lib/sources/loader");
const { loadLiveTvFromDisk } = require("./lib/live-tv/manager");
const { cleanupPlaybackSessions } = require("./lib/playback/sessions");
const { registerApiRoutes } = require("./lib/routes");

function cleanupStaleHlsOnStartup() {
  try {
    if (!fs.existsSync(PLAYBACK_HLS_DIR)) return;
    const entries = fs.readdirSync(PLAYBACK_HLS_DIR, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(PLAYBACK_HLS_DIR, entry.name);
      fs.rmSync(dirPath, { recursive: true, force: true });
      removed++;
    }
    if (removed > 0) {
      console.log(`[HLS-STARTUP] Eliminadas ${removed} carpetas HLS de sesiones anteriores.`);
    }
  } catch (err) {
    console.error("[HLS-STARTUP] Error limpiando carpetas HLS:", err.message);
  }
}

const app = express();

app.use(express.json({ limit: "1mb" }));

const clientDir = fs.existsSync(path.join(WEB_DIST_DIR, "index.html"))
  ? WEB_DIST_DIR
  : LEGACY_PUBLIC_DIR;

app.get("/service-worker.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.send(`
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((client) => client.navigate(client.url));
  })());
});
`);
});

app.use(express.static(clientDir));

registerApiRoutes(app);

app.get("*", (req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

function getLanIpv4List() {
  const interfaces = os.networkInterfaces();
  const out = [];
  for (const rows of Object.values(interfaces || {})) {
    for (const row of rows || []) {
      if (!row || row.internal || row.family !== "IPv4") continue;
      out.push(row.address);
    }
  }
  return [...new Set(out)];
}

function startServer() {
  loadReliabilityFromDisk();
  console.log(`Confiabilidad de streams cargada desde ${STREAM_RELIABILITY_FILE}`);
  ensureDirSync(PLAYBACK_HLS_DIR);
  cleanupStaleHlsOnStartup();

  try {
    const summary = loadSourcesFromDisk();
    console.log(
      `Fuentes cargadas. Catalogos: ${summary.catalogCount} | Streams: ${summary.streamCount} | Subtitulos: ${summary.subtitleCount}`
    );
  } catch (error) {
    console.error("No se pudieron cargar fuentes iniciales:", error.message);
  }

  try {
    const liveTvSummary = loadLiveTvFromDisk();
    console.log(
      `Live TV cargado. Existe: ${liveTvSummary.exists ? "si" : "no"} | Archivos: ${liveTvSummary.fileCount} | Categorias: ${liveTvSummary.categoryCount} | Canales: ${liveTvSummary.channelCount}`
    );
  } catch (error) {
    console.error("No se pudieron cargar listas Live TV:", error.message);
  }

  app.listen(PORT, HOST, () => {
    const localHostLabel = HOST === "0.0.0.0" ? "localhost" : HOST;
    console.log(`Streams MVP escuchando en http://${localHostLabel}:${PORT}`);
    if (HOST === "0.0.0.0") {
      const lanIps = getLanIpv4List();
      for (const ip of lanIps) {
        console.log(`Red local: http://${ip}:${PORT}`);
      }
    }
  });
}

setInterval(cleanupPlaybackSessions, 2 * 60 * 1000);

startServer();
