const { safeText } = require("../utils");
const { isTmdbConfigured, getTmdbLanguage, fetchTmdb } = require("../tmdb/client");

function parseTmdbCompositeId(itemId) {
  const match = safeText(itemId).match(/^tmdb:(movie|tv):(\d+)$/i);
  if (!match) return null;
  return {
    tmdbType: match[1].toLowerCase(),
    tmdbId: Number(match[2])
  };
}

function normalizeStreamType(type) {
  const clean = safeText(type).toLowerCase();
  return clean;
}

function mapAppTypeToTmdbType(type) {
  const clean = safeText(type).toLowerCase();
  if (clean === "movie") return "movie";
  if (clean === "series" || clean === "tv") return "tv";
  return null;
}

async function resolveStreamRequest(type, itemId, season, episode) {
  const resolvedType = normalizeStreamType(type);
  const rawItemId = safeText(itemId);
  if (!resolvedType || !rawItemId) {
    throw new Error("Debes enviar type e itemId.");
  }

  const imdbWithOptionalEpisodeMatch = rawItemId.match(/^(tt\d+)(?::(\d+):(\d+))?$/i);
  if (imdbWithOptionalEpisodeMatch) {
    const imdbId = safeText(imdbWithOptionalEpisodeMatch[1]).toLowerCase();
    const embeddedSeasonNum = Number.parseInt(imdbWithOptionalEpisodeMatch[2], 10);
    const embeddedEpisodeNum = Number.parseInt(imdbWithOptionalEpisodeMatch[3], 10);
    const querySeasonNum = Number.parseInt(season, 10);
    const queryEpisodeNum = Number.parseInt(episode, 10);

    if (resolvedType === "series") {
      if (
        Number.isFinite(querySeasonNum) &&
        querySeasonNum > 0 &&
        Number.isFinite(queryEpisodeNum) &&
        queryEpisodeNum > 0
      ) {
        return {
          resolvedType,
          resolvedItemId: `${imdbId}:${querySeasonNum}:${queryEpisodeNum}`
        };
      }
      if (
        Number.isFinite(embeddedSeasonNum) &&
        embeddedSeasonNum > 0 &&
        Number.isFinite(embeddedEpisodeNum) &&
        embeddedEpisodeNum > 0
      ) {
        return {
          resolvedType,
          resolvedItemId: `${imdbId}:${embeddedSeasonNum}:${embeddedEpisodeNum}`
        };
      }
    }

    return {
      resolvedType,
      resolvedItemId: imdbId
    };
  }

  const tmdbRef = parseTmdbCompositeId(rawItemId);
  if (!tmdbRef) {
    return {
      resolvedType,
      resolvedItemId: rawItemId
    };
  }

  if (!isTmdbConfigured()) {
    throw new Error("TMDB no esta configurado para convertir itemId tmdb:... a imdb tt...");
  }

  const external = await fetchTmdb(`/${tmdbRef.tmdbType}/${tmdbRef.tmdbId}/external_ids`, {
    language: getTmdbLanguage()
  });

  const imdbId = safeText(external?.imdb_id).toLowerCase();
  if (!/^tt\d+$/i.test(imdbId)) {
    throw new Error("TMDB no devolvio imdb_id para este titulo.");
  }

  const seasonNum = Number.parseInt(season, 10);
  const episodeNum = Number.parseInt(episode, 10);

  if (resolvedType === "series" && Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
    return {
      resolvedType,
      resolvedItemId: `${imdbId}:${seasonNum}:${episodeNum}`
    };
  }

  return {
    resolvedType,
    resolvedItemId: imdbId
  };
}

async function resolveTmdbReference(appType, originalItemId, resolvedItemId) {
  if (!isTmdbConfigured()) return null;

  const tmdbType = mapAppTypeToTmdbType(appType);
  if (!tmdbType) return null;

  const tmdbComposite = parseTmdbCompositeId(originalItemId);
  if (tmdbComposite && tmdbComposite.tmdbType === tmdbType) {
    return {
      tmdbType,
      tmdbId: tmdbComposite.tmdbId,
      imdbId: null
    };
  }

  const imdbId = safeText(resolvedItemId || originalItemId).split(":")[0].toLowerCase();
  if (!/^tt\d+$/i.test(imdbId)) return null;

  const payload = await fetchTmdb(`/find/${imdbId}`, {
    external_source: "imdb_id",
    language: getTmdbLanguage()
  });

  const bucket = tmdbType === "movie" ? payload?.movie_results : payload?.tv_results;
  const first = Array.isArray(bucket) ? bucket[0] : null;
  if (!first?.id) return null;

  return {
    tmdbType,
    tmdbId: Number(first.id),
    imdbId
  };
}

module.exports = {
  parseTmdbCompositeId,
  normalizeStreamType,
  resolveStreamRequest,
  resolveTmdbReference
};
