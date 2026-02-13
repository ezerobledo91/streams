const { safeText } = require("../utils");
const { TMDB_IMAGE_BASE } = require("../config");
const { getTmdbLanguage, fetchTmdb } = require("../tmdb/client");
const { parseNumericRating } = require("../catalog/fetcher");
const { resolveStreamRequest, resolveTmdbReference } = require("./resolver");

function mapTmdbGenres(genres) {
  if (!Array.isArray(genres)) return [];
  return genres
    .map((entry) => safeText(entry?.name))
    .filter(Boolean)
    .slice(0, 6);
}

function mapTmdbCast(credits) {
  const castList = Array.isArray(credits?.cast) ? credits.cast : [];
  return castList
    .map((entry) => safeText(entry?.name))
    .filter(Boolean)
    .slice(0, 12);
}

function mapTmdbSeasons(seasons) {
  if (!Array.isArray(seasons)) return [];
  return seasons
    .filter((season) => Number(season?.season_number) >= 0)
    .map((season) => ({
      season: Number(season.season_number),
      name: safeText(season.name) || `Temporada ${season.season_number}`,
      episodeCount: Number(season.episode_count || 0),
      airDate: safeText(season.air_date) || null
    }))
    .sort((a, b) => a.season - b.season);
}

function mapTmdbEpisodes(seasonNumber, episodes) {
  if (!Array.isArray(episodes)) return [];
  return episodes
    .filter((episode) => Number(episode?.episode_number) > 0)
    .map((episode) => ({
      season: seasonNumber,
      episode: Number(episode.episode_number),
      title: safeText(episode.name) || `Episodio ${episode.episode_number}`,
      overview: safeText(episode.overview) || null,
      rating: parseNumericRating(episode.vote_average),
      airDate: safeText(episode.air_date) || null,
      still: episode?.still_path ? `${TMDB_IMAGE_BASE}${episode.still_path}` : null
    }))
    .sort((a, b) => a.episode - b.episode);
}

async function fetchMetaDetails(type, itemId, season, episode) {
  const resolved = await resolveStreamRequest(type, itemId, season, episode);
  const ref = await resolveTmdbReference(resolved.resolvedType, itemId, resolved.resolvedItemId);
  if (!ref) {
    return {
      requestedType: type,
      requestedItemId: itemId,
      resolvedType: resolved.resolvedType,
      resolvedItemId: resolved.resolvedItemId,
      info: null,
      seasons: [],
      episodes: []
    };
  }

  const language = getTmdbLanguage();
  if (ref.tmdbType === "movie") {
    const details = await fetchTmdb(`/movie/${ref.tmdbId}`, {
      language,
      append_to_response: "credits"
    });

    return {
      requestedType: type,
      requestedItemId: itemId,
      resolvedType: resolved.resolvedType,
      resolvedItemId: resolved.resolvedItemId,
      info: {
        title: safeText(details?.title) || "Sin titulo",
        overview: safeText(details?.overview) || null,
        poster: details?.poster_path ? `${TMDB_IMAGE_BASE}${details.poster_path}` : null,
        background: details?.backdrop_path ? `${TMDB_IMAGE_BASE}${details.backdrop_path}` : null,
        originalLanguage: safeText(details?.original_language) || null,
        rating: parseNumericRating(details?.vote_average),
        year: safeText(details?.release_date).slice(0, 4) || null,
        genres: mapTmdbGenres(details?.genres),
        cast: mapTmdbCast(details?.credits),
        runtime: Number(details?.runtime || 0) || null
      },
      seasons: [],
      episodes: []
    };
  }

  const details = await fetchTmdb(`/tv/${ref.tmdbId}`, {
    language,
    append_to_response: "credits"
  });
  const seasons = mapTmdbSeasons(details?.seasons);
  const fallbackSeason = seasons.find((entry) => entry.season > 0)?.season || 1;
  const seasonNumber = Number.parseInt(season, 10);
  const targetSeason = Number.isFinite(seasonNumber) && seasonNumber > 0 ? seasonNumber : fallbackSeason;

  let episodes = [];
  try {
    const seasonPayload = await fetchTmdb(`/tv/${ref.tmdbId}/season/${targetSeason}`, {
      language
    });
    episodes = mapTmdbEpisodes(targetSeason, seasonPayload?.episodes);
  } catch {
    episodes = [];
  }

  return {
    requestedType: type,
    requestedItemId: itemId,
    resolvedType: resolved.resolvedType,
    resolvedItemId: resolved.resolvedItemId,
    info: {
      title: safeText(details?.name) || "Sin titulo",
      overview: safeText(details?.overview) || null,
      poster: details?.poster_path ? `${TMDB_IMAGE_BASE}${details.poster_path}` : null,
      background: details?.backdrop_path ? `${TMDB_IMAGE_BASE}${details.backdrop_path}` : null,
      originalLanguage: safeText(details?.original_language) || null,
      rating: parseNumericRating(details?.vote_average),
      year: safeText(details?.first_air_date).slice(0, 4) || null,
      genres: mapTmdbGenres(details?.genres),
      cast: mapTmdbCast(details?.credits),
      runtime: Number(Array.isArray(details?.episode_run_time) ? details.episode_run_time[0] : 0) || null
    },
    seasons,
    episodes
  };
}

module.exports = {
  mapTmdbGenres,
  mapTmdbCast,
  mapTmdbSeasons,
  mapTmdbEpisodes,
  fetchMetaDetails
};
