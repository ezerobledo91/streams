const path = require("path");
const AdmZip = require("adm-zip");
const { safeText } = require("../utils");
const { fetchJson } = require("../http");
const { resolveStreamRequest } = require("../meta/resolver");
const { state } = require("../state");
const { toWebVtt, sanitizeSubtitleProxyExtension } = require("../subtitles/converter");
const {
  getOpenSubtitlesHeaders,
  fetchProviderSubtitles,
  fetchSubdlExternalSubtitles,
  fetchOpenSubtitlesExternalSubtitles,
  dedupeSubtitles,
  isSpanishSubtitleLanguage
} = require("../subtitles/providers");

function registerSubtitleRoutes(app) {
  app.get("/api/subtitles", async (req, res) => {
    const type = safeText(req.query.type);
    const itemId = safeText(req.query.itemId);
    const onlyActive = req.query.onlyActive !== "false";
    const season = safeText(req.query.season);
    const episode = safeText(req.query.episode);

    if (!type || !itemId) {
      return res.status(400).json({ error: "Debes enviar ?type=...&itemId=..." });
    }

    let resolved;
    try {
      resolved = await resolveStreamRequest(type, itemId, season, episode);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const targetSources = state.subtitleSources.filter((source) => (onlyActive ? source.active : true));
    const filteredSources = targetSources.filter(
      (source) => !source.categories.length || source.categories.includes(resolved.resolvedType)
    );

    const results = await Promise.all(
      filteredSources.map((source) => fetchProviderSubtitles(source, resolved.resolvedType, resolved.resolvedItemId, req))
    );

    const [externalOpenSubtitles, externalSubdl] = await Promise.all([
      fetchOpenSubtitlesExternalSubtitles(resolved.resolvedType, resolved.resolvedItemId, season, episode, req),
      fetchSubdlExternalSubtitles(resolved.resolvedType, resolved.resolvedItemId, season, episode, req)
    ]);
    if (externalOpenSubtitles) results.push(externalOpenSubtitles);
    if (externalSubdl) results.push(externalSubdl);

    const merged = dedupeSubtitles(results.flatMap((item) => item.subtitles || []), 60).filter((item) =>
      isSpanishSubtitleLanguage(item?.language)
    );

    return res.json({
      requestedType: type,
      requestedItemId: itemId,
      resolvedType: resolved.resolvedType,
      resolvedItemId: resolved.resolvedItemId,
      providerCount: filteredSources.length,
      results,
      subtitles: merged
    });
  });

  app.get("/api/subtitles/opensubtitles/file/:fileId", async (req, res) => {
    const fileId = safeText(req.params.fileId);
    if (!/^\d+$/.test(fileId)) {
      return res.status(400).json({ error: "fileId invalido." });
    }

    const headers = getOpenSubtitlesHeaders();
    if (!headers) {
      return res.status(503).json({ error: "OPEN_SUBTITLES_API_KEY no configurado." });
    }

    const ext = sanitizeSubtitleProxyExtension(req.query.ext || ".srt", ".srt");

    try {
      const downloadPayload = await fetchJson("https://api.opensubtitles.com/api/v1/download", {
        method: "POST",
        timeoutMs: 15000,
        headers: {
          ...headers,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          file_id: Number(fileId)
        })
      });

      const downloadUrl = safeText(downloadPayload?.link);
      if (!/^https?:\/\//i.test(downloadUrl)) {
        throw new Error("OpenSubtitles no devolvio un link descargable.");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      try {
        const response = await fetch(downloadUrl, {
          signal: controller.signal,
          headers: {
            accept: "text/plain,text/vtt,application/x-subrip,*/*",
            "user-agent": "streams-mvp/1.0"
          }
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`No se pudo descargar subtitulo: HTTP ${response.status} ${body.slice(0, 140)}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 8 * 1024 * 1024) {
          return res.status(413).json({ error: "Subtitulo demasiado grande." });
        }

        const contentType = safeText(response.headers.get("content-type")).toLowerCase();
        const isZipLike =
          ext === ".zip" ||
          ext === ".rar" ||
          contentType.includes("zip") ||
          contentType.includes("octet-stream");

        let subtitleText = "";
        if (isZipLike) {
          const zip = new AdmZip(buffer);
          const entries = zip
            .getEntries()
            .filter((entry) => !entry.isDirectory)
            .filter((entry) => {
              const extension = path.extname(entry.entryName || "").toLowerCase();
              return extension === ".srt" || extension === ".vtt";
            })
            .sort((a, b) => {
              const aExt = path.extname(a.entryName || "").toLowerCase();
              const bExt = path.extname(b.entryName || "").toLowerCase();
              if (aExt === ".srt" && bExt !== ".srt") return -1;
              if (bExt === ".srt" && aExt !== ".srt") return 1;
              return (a.entryName || "").length - (b.entryName || "").length;
            });

          const selected = entries[0];
          if (!selected) {
            return res.status(415).json({ error: "No se encontro .srt/.vtt dentro del archivo comprimido." });
          }
          subtitleText = selected.getData().toString("utf8");
        } else {
          subtitleText = buffer.toString("utf8");
        }

        const vtt = toWebVtt(subtitleText);
        res.setHeader("Content-Type", "text/vtt; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=1800");
        return res.send(vtt);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return res.status(502).json({ error: error?.message || "No se pudo procesar subtitulo de OpenSubtitles." });
    }
  });

  app.get("/api/subtitles/proxy", async (req, res) => {
    const rawUrl = safeText(req.query.url);
    if (!rawUrl) {
      return res.status(400).json({ error: "url es requerida." });
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: "url invalida." });
    }

    if (!/^https?:$/i.test(parsed.protocol)) {
      return res.status(400).json({ error: "Solo se permiten urls http/https." });
    }

    const ext = sanitizeSubtitleProxyExtension(req.query.ext, ".srt");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const response = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: {
          accept: "text/plain,text/vtt,application/x-subrip,*/*",
          "user-agent": "streams-mvp/1.0"
        }
      });

      if (!response.ok) {
        const body = await response.text();
        return res.status(502).json({ error: `No se pudo descargar subtitulo: HTTP ${response.status} ${body.slice(0, 140)}` });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 8 * 1024 * 1024) {
        return res.status(413).json({ error: "Subtitulo demasiado grande." });
      }

      const contentType = safeText(response.headers.get("content-type")).toLowerCase();
      const isZipLike =
        ext === ".zip" ||
        ext === ".rar" ||
        contentType.includes("zip") ||
        contentType.includes("octet-stream");

      let subtitleText = "";
      if (isZipLike) {
        const zip = new AdmZip(buffer);
        const entries = zip
          .getEntries()
          .filter((entry) => !entry.isDirectory)
          .filter((entry) => {
            const extension = path.extname(entry.entryName || "").toLowerCase();
            return extension === ".srt" || extension === ".vtt";
          })
          .sort((a, b) => {
            const aExt = path.extname(a.entryName || "").toLowerCase();
            const bExt = path.extname(b.entryName || "").toLowerCase();
            if (aExt === ".srt" && bExt !== ".srt") return -1;
            if (bExt === ".srt" && aExt !== ".srt") return 1;
            return (a.entryName || "").length - (b.entryName || "").length;
          });

        const selected = entries[0];
        if (!selected) {
          return res.status(415).json({ error: "No se encontro .srt/.vtt dentro del archivo comprimido." });
        }
        subtitleText = selected.getData().toString("utf8");
      } else {
        subtitleText = buffer.toString("utf8");
      }

      const vtt = toWebVtt(subtitleText);
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=1800");
      return res.send(vtt);
    } catch (error) {
      return res.status(502).json({ error: error?.message || "No se pudo procesar subtitulo." });
    } finally {
      clearTimeout(timeout);
    }
  });
}

module.exports = { registerSubtitleRoutes };
