import { useEffect, useRef } from "react";
import { ArrowLeft, Heart } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { MediaCard } from "../components/MediaCard";
import { useAppStore } from "../store/AppStore";
import type { CatalogItem } from "../types";

export function FavoritesPage() {
  const navigate = useNavigate();
  const { state, actions } = useAppStore();
  const favorites = state.user?.favorites || [];
  
  const activeResultIdxRef = useRef(0);
  const headerFocusIdxRef = useRef(0);
  const tvZoneRef = useRef<"header" | "results">(favorites.length > 0 ? "results" : "header");

  useEffect(() => {
    function clearFocus() {
      document.querySelectorAll(".tv-focused").forEach(el => el.classList.remove("tv-focused"));
    }

    function getFocusables() {
      if (tvZoneRef.current === "header") {
        return Array.from(document.querySelectorAll<HTMLElement>(".category-page-header .back-link-icon"));
      } else {
        return Array.from(document.querySelectorAll<HTMLElement>(".search-results-grid .media-tile"));
      }
    }

    function applyFocus(index: number) {
      clearFocus();
      const items = getFocusables();
      if (!items.length) return;
      const safeIdx = Math.max(0, Math.min(items.length - 1, index));
      
      if (tvZoneRef.current === "header") {
        headerFocusIdxRef.current = safeIdx;
      } else {
        activeResultIdxRef.current = safeIdx;
      }

      items[safeIdx].classList.add("tv-focused");
      items[safeIdx].scrollIntoView({ block: "center", behavior: "smooth" });
    }

    function handleKeyDown(e: KeyboardEvent) {
      const zone = tvZoneRef.current;
      const items = getFocusables();

      if (zone === "header") {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            if (favorites.length > 0) {
              tvZoneRef.current = "results";
              applyFocus(0);
            }
            break;
          case "Enter":
            e.preventDefault();
            items[0]?.click();
            break;
          case "Backspace":
          case "Escape":
            e.preventDefault();
            navigate("/");
            break;
        }
      } else {
        const idx = activeResultIdxRef.current;
        const cols = window.innerWidth > 1200 ? 6 : window.innerWidth > 800 ? 4 : 3;

        switch (e.key) {
          case "ArrowRight":
            if (idx < items.length - 1) applyFocus(idx + 1);
            break;
          case "ArrowLeft":
            if (idx > 0) applyFocus(idx - 1);
            break;
          case "ArrowDown":
            if (idx + cols < items.length) applyFocus(idx + cols);
            break;
          case "ArrowUp":
            if (idx - cols >= 0) {
              applyFocus(idx - cols);
            } else {
              tvZoneRef.current = "header";
              applyFocus(0);
            }
            break;
          case "Enter":
            e.preventDefault();
            items[idx]?.click();
            break;
          case "Backspace":
          case "Escape":
            e.preventDefault();
            tvZoneRef.current = "header";
            applyFocus(0);
            break;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [favorites.length, navigate]);

  function handleSelectItem(item: CatalogItem) {
    actions.setSelectedItem(item);
    actions.setCategory(item.type);
    navigate(`/watch/${item.type}/${encodeURIComponent(item.id)}`);
  }

  return (
    <main className="category-page-shell">
      <header className="category-page-header">
        <Link to="/" className="back-link-icon" aria-label="Volver al inicio">
          <ArrowLeft size={22} />
        </Link>
        <div className="category-page-headline">
          <h1>Mis Favoritos</h1>
          <p>Películas y series guardadas</p>
        </div>
      </header>

      <section className="category-page-content" style={{ marginTop: 20 }}>
        {favorites.length === 0 ? (
          <div className="search-page-empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
            <Heart size={48} className="muted" />
            <p>Aún no tienes favoritos guardados.</p>
            <Link to="/" className="primary-btn">Explorar catálogo</Link>
          </div>
        ) : (
          <div className="search-results-grid category-results-grid">
            {favorites.map((item) => (
              <MediaCard key={`${item.type}:${item.id}`} item={item} onSelect={handleSelectItem} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
