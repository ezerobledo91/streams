import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Heart, Slash, Star } from "lucide-react";
import type { CatalogItem } from "../types";
import { checkAvailability } from "../lib/availability-cache";
import { toggleUserFavorite } from "../api";
import { useAppStore } from "../store/AppStore";

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
  const { state, actions } = useAppStore();
  const poster = item.poster || item.background;
  const stars = ratingToStars(item.rating);
  const articleRef = useRef<HTMLElement | null>(null);
  const checkedRef = useRef(false);
  const [availability, setAvailability] = useState<"unknown" | "available" | "unavailable">("unknown");

  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !checkedRef.current) {
            checkedRef.current = true;
            observer.disconnect();
            checkAvailability(item.type, item.id).then((ok) => {
              setAvailability(ok ? "available" : "unavailable");
            });
          }
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [item.type, item.id]);

  function renderAvailabilityDot() {
    if (availability !== "available") return null;
    return <span className="availability-dot is-available" />;
  }

  const hasAvailable = availability === "available";
  const isFavorite = Boolean(
    state.user?.favorites.some((entry) => entry.type === item.type && entry.id === item.id)
  );

  async function handleToggleFavorite(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!state.user) {
      alert("Inicia sesion para marcar favoritos.");
      return;
    }
    const response = await toggleUserFavorite(state.user.username, item);
    actions.setUser(response.user);
  }
  return (
    <article ref={articleRef} className="media-tile" onClick={() => onSelect(item)}>
      {renderAvailabilityDot()}
      <button
        type="button"
        className={`favorite-btn ${isFavorite ? "is-active" : ""}`}
        onClick={handleToggleFavorite}
      >
        <Heart size={16} />
      </button>
      {!hasAvailable && availability === "unavailable" ? (
        <div className="media-tile-unavailable">
          <Slash size={24} aria-hidden="true" />
          <span>No disponible</span>
        </div>
      ) : null}
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
