import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { fetchMetaDetails } from "../api";
import type { MetaDetailsPayload } from "../types";

interface UseMetaDetailsOptions {
  decodedItemId: string;
  streamsType: string;
  isSeries: boolean;
  season: number;
  episode: number;
  setSeason: Dispatch<SetStateAction<number>>;
  setEpisode: Dispatch<SetStateAction<number>>;
}

export function useMetaDetails({
  decodedItemId,
  streamsType,
  isSeries,
  season,
  episode,
  setSeason,
  setEpisode
}: UseMetaDetailsOptions) {
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaDetails, setMetaDetails] = useState<MetaDetailsPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!decodedItemId) return undefined;

    setLoadingMeta(true);
    fetchMetaDetails({
      type: streamsType,
      itemId: decodedItemId,
      season: isSeries ? season : undefined,
      episode: isSeries ? episode : undefined
    })
      .then((payload) => {
        if (cancelled) return;
        setMetaDetails(payload);
      })
      .catch(() => {
        if (cancelled) return;
        setMetaDetails(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingMeta(false);
      });

    return () => {
      cancelled = true;
    };
  }, [decodedItemId, episode, isSeries, season, streamsType]);

  useEffect(() => {
    if (!isSeries || !metaDetails) return;

    if (metaDetails.seasons.length) {
      const exists = metaDetails.seasons.some((item) => item.season === season);
      if (!exists) {
        const firstSeason = metaDetails.seasons.find((item) => item.season > 0)?.season || metaDetails.seasons[0].season;
        if (firstSeason !== season) {
          setSeason(firstSeason);
          return;
        }
      }
    }

    if (metaDetails.episodes.length) {
      const episodeExists = metaDetails.episodes.some((item) => item.episode === episode);
      if (!episodeExists) {
        const firstEpisode = metaDetails.episodes[0].episode;
        if (firstEpisode !== episode) {
          setEpisode(firstEpisode);
        }
      }
    }
  }, [episode, isSeries, metaDetails, season, setEpisode, setSeason]);

  return {
    loadingMeta,
    metaDetails
  };
}
