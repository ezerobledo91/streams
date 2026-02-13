import { useEffect, useRef, useState } from "react";
import type { WheelEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CatalogItem } from "../types";
import { MediaCard } from "./MediaCard";

export function CategoryRail({
  title,
  items,
  onSelect
}: {
  title: string;
  items: CatalogItem[];
  onSelect: (item: CatalogItem) => void;
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
    
    // Initial check after a short delay to ensure layout is ready
    const timeout = setTimeout(refreshScrollButtons, 100);

    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(timeout);
    };
  }, [items]);

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track) return;
    // If vertical scroll is stronger than horizontal, don't interfere
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    
    // Translate vertical wheel to horizontal scroll
    track.scrollLeft += event.deltaY;
  }

  function scrollTrack(direction: "left" | "right") {
    const track = trackRef.current;
    if (!track) return;
    const jump = Math.max(220, Math.floor(track.clientWidth * 0.85));
    track.scrollBy({
      left: direction === "left" ? -jump : jump,
      behavior: "smooth"
    });
  }

  return (
    <section className="category-rail">
      <header>
        <h2>{title}</h2>
      </header>
      <div className="rail-carousel-shell">
        <button
          type="button"
          className={`rail-nav rail-nav-left ${canScrollLeft ? "is-visible" : ""}`}
          onClick={() => scrollTrack("left")}
          aria-label={`Desplazar ${title} hacia la izquierda`}
        >
          <ChevronLeft size={28} />
        </button>
        
        <div
          ref={trackRef}
          className="carousel-track"
          onScroll={refreshScrollButtons}
          onWheel={onWheel}
        >
          {items.map((item) => (
            <MediaCard key={`${item.type}-${item.id}`} item={item} onSelect={onSelect} />
          ))}
        </div>

        <button
          type="button"
          className={`rail-nav rail-nav-right ${canScrollRight ? "is-visible" : ""}`}
          onClick={() => scrollTrack("right")}
          aria-label={`Desplazar ${title} hacia la derecha`}
        >
          <ChevronRight size={28} />
        </button>
      </div>
    </section>
  );
}
