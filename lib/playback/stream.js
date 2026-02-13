const path = require("path");
const { pipeline } = require("stream");
const mime = require("mime-types");
const { safeText } = require("../utils");

function sessionPublicInfo(session) {
  const torrent = session.torrent;
  const file = session.file;
  const directStreamPath = `/api/playback/sessions/${session.id}/stream`;
  const hlsStreamPath = safeText(session?.hls?.playlistPath);
  const streamPath = session?.streamKind === "hls" && hlsStreamPath ? hlsStreamPath : directStreamPath;
  const { getSessionHlsSegmentCount } = require("./hls");
  const hlsSegmentCount = getSessionHlsSegmentCount(session);
  return {
    sessionId: session.id,
    status: session.status,
    error: session.error,
    createdAt: session.createdAt,
    lastAccessAt: session.lastAccessAt,
    streamUrl: streamPath,
    streamKind: session?.streamKind || "direct",
    directStreamUrl: directStreamPath,
    hls:
      session?.hls?.enabled
        ? {
            enabled: true,
            status: session.hls.status,
            error: session.hls.error,
            playlistUrl: session.hls.playlistPath || null,
            segmentCount: hlsSegmentCount
          }
        : {
            enabled: false,
            status: "idle",
            error: null,
            playlistUrl: null,
            segmentCount: 0
          },
    subtitles: (Array.isArray(session.subtitles) ? session.subtitles : []).map((subtitle) => {
      const subtitlePath = `/api/playback/sessions/${session.id}/subtitles/${encodeURIComponent(subtitle.id)}`;
      return {
        id: subtitle.id,
        label: subtitle.label,
        language: subtitle.language,
        extension: subtitle.extension,
        url: subtitlePath
      };
    }),
    file: file
      ? {
          name: file.name,
          length: file.length,
          extension: path.extname(file.name || "").toLowerCase()
        }
      : null,
    torrent: torrent
      ? {
          progress: Number(torrent.progress || 0),
          numPeers: Number(torrent.numPeers || 0),
          downloadSpeed: Number(torrent.downloadSpeed || 0)
        }
      : null
  };
}

function isExpectedStreamCloseError(error) {
  if (!error) return false;
  const code = safeText(error.code).toUpperCase();
  if (["ERR_STREAM_PREMATURE_CLOSE", "ECONNRESET", "EPIPE", "ERR_CANCELED"].includes(code)) {
    return true;
  }

  const message = safeText(error.message).toLowerCase();
  return (
    message.includes("premature") ||
    message.includes("closed prematurely") ||
    message.includes("aborted") ||
    message.includes("socket hang up")
  );
}

function pipeTorrentFileToResponse(file, res, options = null) {
  const readStream = options ? file.createReadStream(options) : file.createReadStream();

  const onClose = () => {
    if (!readStream.destroyed) {
      readStream.destroy();
    }
  };

  res.once("close", onClose);
  pipeline(readStream, res, (error) => {
    res.off("close", onClose);
    if (!error) return;
    if (res.destroyed || res.writableEnded || isExpectedStreamCloseError(error)) {
      return;
    }

    console.error("Error enviando stream de playback:", error?.message || error);
    if (!res.headersSent) {
      res.status(502).json({ error: "No se pudo enviar stream de playback." });
      return;
    }

    try {
      res.destroy(error);
    } catch {
      // no-op
    }
  });
}

module.exports = {
  sessionPublicInfo,
  isExpectedStreamCloseError,
  pipeTorrentFileToResponse
};
