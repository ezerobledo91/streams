const { safeText } = require("../utils");
const { PLAYBACK_MAX_CONNS, DEFAULT_PUBLIC_TRACKERS } = require("../config");
const { getPlaybackClient, setPlaybackClient, getPlaybackClientPromise, setPlaybackClientPromise } = require("../state");

async function ensurePlaybackClient() {
  if (getPlaybackClient()) return getPlaybackClient();
  if (getPlaybackClientPromise()) return getPlaybackClientPromise();

  const promise = import("webtorrent")
    .then((module) => {
      const WebTorrentCtor = module.default || module;
      const client = new WebTorrentCtor({
        maxConns: PLAYBACK_MAX_CONNS
      });
      setPlaybackClient(client);
      return client;
    })
    .catch((error) => {
      setPlaybackClientPromise(null);
      throw error;
    });

  setPlaybackClientPromise(promise);
  return promise;
}

function buildSessionMagnet({ magnet, infoHash, displayName, trackers }) {
  const cleanMagnet = safeText(magnet);
  if (cleanMagnet.startsWith("magnet:")) {
    return cleanMagnet;
  }

  const cleanHash = safeText(infoHash).toLowerCase();
  if (!cleanHash) return null;

  const params = [`xt=urn:btih:${cleanHash}`];
  if (safeText(displayName)) {
    params.push(`dn=${encodeURIComponent(safeText(displayName))}`);
  }

  const trackerList = Array.isArray(trackers) && trackers.length ? trackers : DEFAULT_PUBLIC_TRACKERS;
  for (const tracker of trackerList) {
      const clean = safeText(tracker);
      if (!clean) continue;
      params.push(`tr=${encodeURIComponent(clean)}`);
  }

  return `magnet:?${params.join("&")}`;
}

module.exports = {
  ensurePlaybackClient,
  buildSessionMagnet
};
