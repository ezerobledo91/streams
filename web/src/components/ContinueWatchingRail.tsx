import { useEffect, useRef, useState } from "react";
import type { WheelEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { WatchHistoryEntry } from "../lib/watch-history";

export function ContinueWatchingRail({
  items,
  onSelect
}: {
  items: WatchHistoryEntry[];
  onSelect: (entry: WatchHistoryEntry) => void;
}) {
  if (!items.length) return null;

  const trackRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function refreshScrollButtons() {
    const track = trackRef.current;
    if (!track) return;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const current = Math.max(0, track.scrollLeft);
    setCanScrollLeft(current > 10);
    setCanScrollRight(current < maxScroll - 10);
  }

  useEffect(() => {
    refreshScrollButtons();
    const track = trackRef.current;
    if (!track) return;
    const onResize = () => refreshScrollButtons();
    window.addEventListener("resize", onResize);
    const timeout = setTimeout(refreshScrollButtons, 100);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(timeout);
    };
  }, [items]);

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    track.scrollLeft += event.deltaY;
  }

  function scrollTrack(direction: "left" | "right") {
    const track = trackRef.current;
    if (!track) return;
    const jump = Math.max(220, Math.floor(track.clientWidth * 0.85));
    track.scrollBy({ left: direction === "left" ? -jump : jump, behavior: "smooth" });
  }

  return (
    <section className="category-rail">
      <header>
        <h2>Continuar viendo</h2>
      </header>
      <div className="rail-carousel-shell">
        <button
          type="button"
          className={`rail-nav rail-nav-left ${canScrollLeft ? "is-visible" : ""}`}
          onClick={() => scrollTrack("left")}
          aria-label="Desplazar hacia la izquierda"
        >
          <ChevronLeft size={28} />
        </button>

        <div ref={trackRef} className="carousel-track" onScroll={refreshScrollButtons} onWheel={onWheel}>
          {items.map((entry) => {
            const key = `${entry.type}:${entry.itemId}:${entry.season ?? ""}:${entry.episode ?? ""}`;
            const poster = entry.poster || entry.background;
            const progressPct = entry.duration > 0 ? Math.min(100, (entry.position / entry.duration) * 100) : 0;
            const episodeLabel =
              entry.type === "series" && entry.season != null && entry.episode != null
                ? `T${entry.season} E${entry.episode}`
                : null;

            return (
              <article key={key} className="media-tile cw-tile" onClick={() => onSelect(entry)}>
                {poster ? (
                  <img loading="lazy" src={poster} alt={entry.name} />
                ) : (
                  <div className="media-card-placeholder">Sin imagen</div>
                )}
                <div className="media-tile-overlay">
                  <div className="media-tile-meta">
                    <h3>{entry.name}</h3>
                    {episodeLabel ? <p>{episodeLabel}{entry.episodeTitle ? ` - ${entry.episodeTitle}` : ""}</p> : null}
                  </div>
                </div>
                <div className="cw-progress-bar">
                  <div className="cw-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
              </article>
            );
          })}
        </div>

        <button
          type="button"
          className={`rail-nav rail-nav-right ${canScrollRight ? "is-visible" : ""}`}
          onClick={() => scrollTrack("right")}
          aria-label="Desplazar hacia la derecha"
        >
          <ChevronRight size={28} />
        </button>
      </div>
    </section>
  );
}
