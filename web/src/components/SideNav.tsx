import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, ChevronDown, ChevronRight, Film, Heart, Radio, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { HOME_CATEGORY_ROWS } from "../lib/home-categories";
import { PLATFORM_PROVIDERS } from "../lib/platform-providers";
import { useAppStore } from "../store/AppStore";
import type { Category } from "../types";

interface SideNavProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SideNav({ isOpen, onClose }: SideNavProps) {
  const { state, actions } = useAppStore();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const asideRef = useRef<HTMLElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const focusedIndexRef = useRef(0);
  const [expanded, setExpanded] = useState({ movie: true, series: false });

  const selectedRow = useMemo(() => new URLSearchParams(search).get("row") || "", [search]);
  const selectedProvider = useMemo(() => new URLSearchParams(search).get("provider") || "", [search]);
  const activePlatformCategory: "movie" | "series" = useMemo(() => {
    if (pathname.startsWith("/category/series")) return "series";
    if (pathname.startsWith("/category/movie")) return "movie";
    return state.category === "series" ? "series" : "movie";
  }, [pathname, state.category]);
  const [platformCategory, setPlatformCategory] = useState<"movie" | "series">(activePlatformCategory);

  useEffect(() => {
    setPlatformCategory(activePlatformCategory);
  }, [activePlatformCategory]);

  useEffect(() => {
    const isMovieActive = pathname === "/" ? state.category === "movie" : pathname.startsWith("/category/movie");
    const isSeriesActive = pathname === "/" ? state.category === "series" : pathname.startsWith("/category/series");

    setExpanded((current) => ({
      movie: isMovieActive ? true : current.movie,
      series: isSeriesActive ? true : current.series
    }));
  }, [pathname, state.category]);

  const handleSetCategory = (category: "movie" | "series") => {
    actions.setCategory(category);
    if (pathname !== "/") {
      navigate("/");
    }
    onClose();
  };

  const handleOpenCategory = (category: "movie" | "series", rowId = "") => {
    actions.setCategory(category);
    const query = rowId ? `?row=${encodeURIComponent(rowId)}` : "";
    navigate(`/category/${category}${query}`);
    onClose();
  };

  const handleOpenProviderHome = (category: "movie" | "series", provider: { id: string; name: string }) => {
    actions.setCategory(category);
    const params = new URLSearchParams({
      provider: provider.id,
      providerName: provider.name
    });
    navigate(`/category/${category}?${params.toString()}`);
    onClose();
  };

  const toggleExpanded = (category: "movie" | "series") => {
    setExpanded((current) => ({ ...current, [category]: !current[category] }));
  };

  const getFocusableElements = useCallback(
    () => Array.from(navRef.current?.querySelectorAll<HTMLElement>(".sidenav-focusable") || []),
    []
  );

  const clearFocus = useCallback((elements: HTMLElement[]) => {
    for (const item of elements) {
      item.classList.remove("tv-focused");
      item.tabIndex = -1;
    }
  }, []);

  const applyFocusByIndex = useCallback(
    (nextIndex: number) => {
      const focusableElements = getFocusableElements();
      if (!focusableElements.length) return;
      const boundedIndex = Math.max(0, Math.min(focusableElements.length - 1, nextIndex));
      focusedIndexRef.current = boundedIndex;

      clearFocus(focusableElements);
      const target = focusableElements[boundedIndex];
      target.classList.add("tv-focused");
      target.tabIndex = 0;
      target.focus({ preventScroll: false });
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [clearFocus, getFocusableElements]
  );

  const markFocusedElement = useCallback(
    (targetElement: HTMLElement) => {
      const focusableElements = getFocusableElements();
      if (!focusableElements.length) return;
      const index = focusableElements.indexOf(targetElement);
      if (index < 0) return;

      focusedIndexRef.current = index;
      clearFocus(focusableElements);
      focusableElements[index].classList.add("tv-focused");
      focusableElements[index].tabIndex = 0;
    },
    [clearFocus, getFocusableElements]
  );

  const findDirectionalIndex = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      const elements = getFocusableElements();
      if (!elements.length) return -1;

      const points = elements.map((element, index) => {
        const rect = element.getBoundingClientRect();
        return {
          index,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      });

      const sorted = [...points].sort((a, b) => {
        if (Math.abs(a.y - b.y) > 8) return a.y - b.y;
        return a.x - b.x;
      });

      const rows: Array<Array<{ index: number; x: number; y: number }>> = [];
      const rowThreshold = 18;
      for (const point of sorted) {
        const lastRow = rows[rows.length - 1];
        if (!lastRow) {
          rows.push([point]);
          continue;
        }
        const avgY = lastRow.reduce((acc, entry) => acc + entry.y, 0) / lastRow.length;
        if (Math.abs(point.y - avgY) <= rowThreshold) {
          lastRow.push(point);
        } else {
          rows.push([point]);
        }
      }

      for (const row of rows) {
        row.sort((a, b) => a.x - b.x);
      }

      const currentIndex = Math.max(0, Math.min(elements.length - 1, focusedIndexRef.current));
      let currentRowIndex = -1;
      let currentColumnIndex = -1;

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const colIndex = rows[rowIndex].findIndex((entry) => entry.index === currentIndex);
        if (colIndex >= 0) {
          currentRowIndex = rowIndex;
          currentColumnIndex = colIndex;
          break;
        }
      }

      if (currentRowIndex < 0 || currentColumnIndex < 0) return -1;

      const current = rows[currentRowIndex][currentColumnIndex];
      if (!current) return -1;

      if (direction === "left") {
        const next = rows[currentRowIndex][currentColumnIndex - 1];
        return next ? next.index : -1;
      }
      if (direction === "right") {
        const next = rows[currentRowIndex][currentColumnIndex + 1];
        return next ? next.index : -1;
      }
      if (direction === "up") {
        const targetRow = rows[currentRowIndex - 1];
        if (!targetRow?.length) return -1;
        let best = targetRow[0];
        let bestDistance = Math.abs(best.x - current.x);
        for (const candidate of targetRow) {
          const distance = Math.abs(candidate.x - current.x);
          if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
          }
        }
        return best.index;
      }
      if (direction === "down") {
        const targetRow = rows[currentRowIndex + 1];
        if (!targetRow?.length) return -1;
        let best = targetRow[0];
        let bestDistance = Math.abs(best.x - current.x);
        for (const candidate of targetRow) {
          const distance = Math.abs(candidate.x - current.x);
          if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
          }
        }
        return best.index;
      }

      return -1;
    },
    [getFocusableElements]
  );

  useEffect(() => {
    const focusableElements = getFocusableElements();
    if (!isOpen) {
      clearFocus(focusableElements);
      return;
    }

    const activeIndex = focusableElements.findIndex((item) => item.classList.contains("is-active"));
    const initialIndex = activeIndex >= 0 ? activeIndex : 0;
    const timeout = window.setTimeout(() => applyFocusByIndex(initialIndex), 60);

    function onKeyDown(event: KeyboardEvent) {
      if (!isOpen || event.defaultPrevented) return;

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target?.isContentEditable) {
        return;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          {
            const next = findDirectionalIndex("down");
            if (next >= 0) applyFocusByIndex(next);
          }
          break;
        case "ArrowUp":
          event.preventDefault();
          {
            const next = findDirectionalIndex("up");
            if (next >= 0) applyFocusByIndex(next);
          }
          break;
        case "ArrowLeft":
          event.preventDefault();
          {
            const next = findDirectionalIndex("left");
            if (next >= 0) applyFocusByIndex(next);
          }
          break;
        case "ArrowRight":
          event.preventDefault();
          {
            const next = findDirectionalIndex("right");
            if (next >= 0) applyFocusByIndex(next);
          }
          break;
        case "Enter":
          event.preventDefault();
          getFocusableElements()[focusedIndexRef.current]?.click();
          break;
        case "Escape":
        case "Backspace":
        case "BrowserBack":
        case "GoBack":
          event.preventDefault();
          onClose();
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [applyFocusByIndex, clearFocus, findDirectionalIndex, getFocusableElements, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: PointerEvent) {
      const panel = asideRef.current;
      if (!panel) return;
      const target = event.target as Node | null;
      if (target && panel.contains(target)) return;
      onClose();
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const focusable = getFocusableElements();
    if (!focusable.length) return;

    const boundedIndex = Math.max(0, Math.min(focusable.length - 1, focusedIndexRef.current));
    applyFocusByIndex(boundedIndex);
  }, [applyFocusByIndex, expanded, getFocusableElements, isOpen, platformCategory]);

  const isMovieMainActive = pathname === "/" ? state.category === "movie" : pathname.startsWith("/category/movie");
  const isSeriesMainActive = pathname === "/" ? state.category === "series" : pathname.startsWith("/category/series");

  function isSubitemActive(category: Category, rowId: string) {
    if (!pathname.startsWith(`/category/${category}`)) return false;
    return selectedRow === rowId;
  }

  return (
    <aside
      ref={asideRef}
      className={`app-sidenav ${isOpen ? "is-open" : ""}`}
      aria-hidden={!isOpen}
      aria-label="Menu principal"
    >
      <div className="sidenav-header">
        <Link to="/" className="brand-logo" onClick={onClose}>
          streams
        </Link>
        <button type="button" className="sidenav-close-btn" onClick={onClose} aria-label="Cerrar menu">
          <X size={24} />
        </button>
      </div>

      <nav
        className="sidenav-nav"
        ref={navRef}
        onFocusCapture={(event) => {
          const target = event.target as HTMLElement;
          if (!target.classList.contains("sidenav-focusable")) return;
          markFocusedElement(target);
        }}
      >
        <p className="sidenav-section-label">Catalogo</p>

        <section className="sidenav-group">
          <div className="sidenav-group-head">
            <button
              type="button"
              className={`sidenav-link sidenav-main-link sidenav-focusable ${isMovieMainActive ? "is-active" : ""}`}
              onClick={() => handleSetCategory("movie")}
            >
              <Film size={20} />
              <span>Peliculas</span>
            </button>
            <button
              type="button"
              className="sidenav-expand-btn sidenav-focusable"
              onClick={() => toggleExpanded("movie")}
              aria-label={expanded.movie ? "Ocultar categorias de peliculas" : "Mostrar categorias de peliculas"}
            >
              {expanded.movie ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>

          {expanded.movie ? (
            <div className="sidenav-submenu">
              <button
                type="button"
                className={`sidenav-link sidenav-subitem sidenav-focusable ${pathname.startsWith("/category/movie") && !selectedRow ? "is-active" : ""}`}
                onClick={() => handleOpenCategory("movie")}
              >
                Explorar todo
              </button>
              {HOME_CATEGORY_ROWS.movie.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`sidenav-link sidenav-subitem sidenav-focusable ${isSubitemActive("movie", row.id) ? "is-active" : ""}`}
                  onClick={() => handleOpenCategory("movie", row.id)}
                >
                  {row.title}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="sidenav-group">
          <div className="sidenav-group-head">
            <button
              type="button"
              className={`sidenav-link sidenav-main-link sidenav-focusable ${isSeriesMainActive ? "is-active" : ""}`}
              onClick={() => handleSetCategory("series")}
            >
              <Clapperboard size={20} />
              <span>Series</span>
            </button>
            <button
              type="button"
              className="sidenav-expand-btn sidenav-focusable"
              onClick={() => toggleExpanded("series")}
              aria-label={expanded.series ? "Ocultar categorias de series" : "Mostrar categorias de series"}
            >
              {expanded.series ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>

          {expanded.series ? (
            <div className="sidenav-submenu">
              <button
                type="button"
                className={`sidenav-link sidenav-subitem sidenav-focusable ${pathname.startsWith("/category/series") && !selectedRow ? "is-active" : ""}`}
                onClick={() => handleOpenCategory("series")}
              >
                Explorar todo
              </button>
              {HOME_CATEGORY_ROWS.series.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`sidenav-link sidenav-subitem sidenav-focusable ${isSubitemActive("series", row.id) ? "is-active" : ""}`}
                  onClick={() => handleOpenCategory("series", row.id)}
                >
                  {row.title}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <p className="sidenav-section-label">Plataformas</p>
        <div className="sidenav-switch">
          <button
            type="button"
            className={`sidenav-switch-btn sidenav-focusable ${platformCategory === "movie" ? "is-active" : ""}`}
            onClick={() => setPlatformCategory("movie")}
          >
            Peliculas
          </button>
          <button
            type="button"
            className={`sidenav-switch-btn sidenav-focusable ${platformCategory === "series" ? "is-active" : ""}`}
            onClick={() => setPlatformCategory("series")}
          >
            Series
          </button>
        </div>
        <div className="sidenav-submenu">
          {PLATFORM_PROVIDERS.map((provider) => (
            <button
              key={`${platformCategory}:${provider.id}`}
              type="button"
              className={`sidenav-link sidenav-subitem sidenav-focusable ${pathname.startsWith(`/category/${platformCategory}`) && selectedProvider === provider.id ? "is-active" : ""}`}
              onClick={() => handleOpenProviderHome(platformCategory, provider)}
            >
              {provider.name}
            </button>
          ))}
        </div>

        <p className="sidenav-section-label">Secciones</p>
        <Link
          to="/live-tv"
          className={`sidenav-link sidenav-focusable ${pathname === "/live-tv" ? "is-active" : ""}`}
          onClick={onClose}
        >
          <Radio size={20} />
          <span>TV en vivo</span>
        </Link>
        <Link
          to="/favorites"
          className={`sidenav-link sidenav-focusable ${pathname === "/favorites" ? "is-active" : ""}`}
          onClick={onClose}
        >
          <Heart size={20} />
          <span>Favoritos</span>
        </Link>
      </nav>
    </aside>
  );
}
