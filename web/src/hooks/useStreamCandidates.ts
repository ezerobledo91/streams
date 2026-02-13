import { useCallback, useMemo, useState } from "react";
import type { QualityBucket } from "../lib/video-helpers";

export type QualitySelection = QualityBucket | "auto";

const QUALITY_ORDER: QualityBucket[] = ["4k", "1080p", "720p", "sd"];

function normalizeQualityList(values?: Array<QualityBucket | string> | null): QualityBucket[] {
  const allowed = new Set<QualityBucket>(QUALITY_ORDER);
  const selected = new Set<QualityBucket>();
  for (const value of values || []) {
    if (allowed.has(value as QualityBucket)) {
      selected.add(value as QualityBucket);
    }
  }
  return QUALITY_ORDER.filter((item) => selected.has(item));
}

export function useStreamCandidates() {
  const [selectedQuality, setSelectedQuality] = useState<QualitySelection>("auto");
  const [validatedQualities, setValidatedQualities] = useState<QualityBucket[]>([]);

  const availableQualities = useMemo(
    () => normalizeQualityList(validatedQualities),
    [validatedQualities]
  );

  const resetValidatedQualities = useCallback(() => {
    setValidatedQualities([]);
  }, []);

  const applyValidatedQualities = useCallback((incoming: Array<QualityBucket | string> | null | undefined) => {
    setValidatedQualities((current) => {
      const normalizedIncoming = normalizeQualityList(incoming);
      if (normalizedIncoming.length > 1) {
        return normalizedIncoming;
      }
      if (normalizedIncoming.length === 1 && current.length > 1) {
        const merged = new Set([...current, ...normalizedIncoming]);
        return QUALITY_ORDER.filter((item) => merged.has(item));
      }
      return normalizedIncoming;
    });
  }, []);

  const syncSelectedQuality = useCallback((value: QualitySelection | null | undefined) => {
    if (!value) return;
    setSelectedQuality(value);
  }, []);

  return {
    selectedQuality,
    setSelectedQuality,
    availableQualities,
    applyValidatedQualities,
    resetValidatedQualities,
    syncSelectedQuality
  };
}
