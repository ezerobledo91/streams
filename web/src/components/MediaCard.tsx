import { Star } from "lucide-react";
import type { CatalogItem } from "../types";

function formatRating(rating: number | null): string {
  if (!Number.isFinite(rating || 0) || (rating || 0) <= 0) return "Sin rating";
  return `${Number(rating).toFixed(1)}/10`;
}

function ratingToStars(rating: number | null): number {
  if (!Number.isFinite(rating || 0) || (rating || 0) <= 0) return 0;
  return Math.max(0, Math.min(5, Math.round((Number(rating) / 10) * 5)));
}

export function MediaCard({
  item,
  onSelect
}: {
  item: CatalogItem;
  onSelect: (item: CatalogItem) => void;
}) {
  const poster = item.poster || item.background;
  const stars = ratingToStars(item.rating);

  return (
    <article className="media-tile" onClick={() => onSelect(item)}>
      {poster ? (
        <img loading="lazy" src={poster} alt={item.name} />
      ) : (
        <div className="media-card-placeholder">Sin imagen</div>
      )}
      <div className="media-tile-overlay">
        <div className="media-tile-meta">
          <h3>{item.name}</h3>
          <p>{item.year || "s/a"}</p>
        </div>
        <div className="media-tile-rating">
          <div className="rating-stars" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <Star key={index} size={12} className={index < stars ? "is-filled" : ""} />
            ))}
          </div>
          <span>{formatRating(item.rating)}</span>
        </div>
      </div>
    </article>
  );
}
