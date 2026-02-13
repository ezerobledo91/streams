import type { StreamCandidate } from "../types";
import { formatBytes } from "../scoring";

export function StreamCandidateList({
  candidates,
  onPlayIndex
}: {
  candidates: StreamCandidate[];
  onPlayIndex: (index: number) => void;
}) {
  if (!candidates.length) {
    return <div className="muted">No se encontraron streams reproducibles.</div>;
  }

  return (
    <div className="ranking-list">
      {candidates.map((candidate, index) => (
        <div className="rank-row" key={`${candidate.providerId}-${index}-${candidate.displayName}`}>
          <div>
            <strong>
              #{index + 1} {candidate.displayName}
            </strong>
          </div>
          <div className="muted">
            {candidate.providerName} | {candidate.providerBaseUrl}
          </div>
          <div>
            <span className="score">Score {candidate.score.toFixed(1)}</span> | seeders {candidate.seeders} | peers{" "}
            {candidate.peers} | {candidate.resolution || "?"}p | size {formatBytes(candidate.videoSizeBytes)} |{" "}
            {candidate.fileExtension}
          </div>
          <div className="muted">
            {candidate.magnet ? "torrent" : "url directa"} | {candidate.webFriendly ? "web-friendly" : "riesgo en navegador"}
          </div>
          <button type="button" onClick={() => onPlayIndex(index)}>
            Reproducir este
          </button>
        </div>
      ))}
    </div>
  );
}
