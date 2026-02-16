import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchCatalogByCategory } from "../api";
import { MediaCard } from "../components/MediaCard";
import { categoryTitle } from "../components/CategoryTabs";
import { HOME_CATEGORY_ROWS, buildYearOptions } from "../lib/home-categories";
import { useAppStore } from "../store/AppStore";
import type { CatalogItem, Category } from "../types";

function itemKey(item: CatalogItem): string {
  return `${item.type}:${item.id}`;
}

function normalizeCategory(input: string | undefined): Category {
  return input === "series" ? "series" : "movie";
}

export function CategoryPage() {
  const navigate = useNavigate();
  const { actions } = useAppStore();
  const { category: categoryParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestIdRef = useRef(0);
  const nextPageRef = useRef(1);
  const fetchingRef = useRef(false);
  const itemKeysRef = useRef<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const category = normalizeCategory(categoryParam);
  const rows = HOME_CATEGORY_ROWS[category];
  const yearOptions = useMemo(() => buildYearOptions(1980), []);

  const rowParam = String(searchParams.get("row") || "");
  const genreParam = String(searchParams.get("genre") || "").trim();
  const yearParam = String(searchParams.get("year") || "").trim();

  const selectedRow = useMemo(() => rows.find((row) => row.id === rowParam) || null, [rows, rowParam]);
  const selectedGenre = selectedRow?.genre || genreParam;
  const selectedYear = /^\d{4}$/.test(yearParam) ? yearParam : "";

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const gridContainerRef = useRef<HTMLDivElement | null>(null);

  // TV Navigation
  const tvZoneRef = useRef<"header" | "filters" | "results">("results");
  const activeResultIdxRef = useRef(0);
  const headerFocusIdxRef = useRef(0);
  const filterFocusIdxRef = useRef(0);

  useEffect(() => {
    function clearFocus() {
      document.querySelectorAll(".tv-focused").forEach(el => el.classList.remove("tv-focused"));
    }

    function getFocusables() {
      if (tvZoneRef.current === "header") {
        return Array.from(document.querySelectorAll<HTMLElement>(".category-page-header .back-link-icon"));
      } else if (tvZoneRef.current === "filters") {
        return Array.from(document.querySelectorAll<HTMLElement>(".category-page-filters button, .category-page-filters select"));
      } else {
        return Array.from(document.querySelectorAll<HTMLElement>(".category-results-grid .media-tile"));
      }
    }

    function applyFocus(index: number) {
      clearFocus();
      const items = getFocusables();
      if (!items.length) return;
      const safeIdx = Math.max(0, Math.min(items.length - 1, index));
      
      if (tvZoneRef.current === "header") {
        headerFocusIdxRef.current = safeIdx;
      } else if (tvZoneRef.current === "filters") {
        filterFocusIdxRef.current = safeIdx;
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
            tvZoneRef.current = "filters";
            applyFocus(0);
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
      } else if (zone === "filters") {
        const idx = filterFocusIdxRef.current;
        switch (e.key) {
          case "ArrowRight":
            if (idx < items.length - 1) applyFocus(idx + 1);
            break;
          case "ArrowLeft":
            if (idx > 0) applyFocus(idx - 1);
            break;
          case "ArrowUp":
            e.preventDefault();
            tvZoneRef.current = "header";
            applyFocus(0);
            break;
          case "ArrowDown":
            e.preventDefault();
            if (gridContainerRef.current) {
              tvZoneRef.current = "results";
              applyFocus(0);
            }
            break;
          case "Enter":
            if (items[idx]?.tagName === "SELECT") {
              (items[idx] as any).showPicker?.();
            } else {
              items[idx]?.click();
            }
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
              tvZoneRef.current = "filters";
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
            tvZoneRef.current = "filters";
            applyFocus(0);
            break;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items.length, navigate]);

  useEffect(() => {
    if (categoryParam !== "movie" && categoryParam !== "series") {
      navigate("/", { replace: true });
      return;
    }
    actions.setCategory(category);
  }, [actions, category, categoryParam, navigate]);

  const loadPage = useCallback(
    async (page: number) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      const requestId = requestIdRef.current;
      if (page === 1) {
        setLoadingInitial(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const payload = await fetchCatalogByCategory({
          category,
          genre: selectedGenre || undefined,
          year: selectedYear || undefined,
          page,
          limit: 36
        });

        if (requestId !== requestIdRef.current) return;

        let addedCount = 0;
        if (page === 1) {
          const deduped: CatalogItem[] = [];
          const seen = new Set<string>();
          for (const item of payload.items) {
            const key = itemKey(item);
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(item);
          }
          itemKeysRef.current = seen;
          addedCount = deduped.length;
          setItems(deduped);
        } else {
          const uniqueItems: CatalogItem[] = [];
          const seen = itemKeysRef.current;
          for (const item of payload.items) {
            const key = itemKey(item);
            if (seen.has(key)) continue;
            seen.add(key);
            uniqueItems.push(item);
          }
          addedCount = uniqueItems.length;
          if (uniqueItems.length) {
            setItems((current) => [...current, ...uniqueItems]);
          }
        }

        nextPageRef.current = page + 1;
        setHasMore(addedCount > 0 && payload.items.length > 0);
      } catch {
        if (requestId === requestIdRef.current) {
          setError("No pudimos cargar esta categoria. Proba de nuevo.");
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoadingInitial(false);
          setLoadingMore(false);
        }
        fetchingRef.current = false;
      }
    },
    [category, selectedGenre, selectedYear]
  );

  useEffect(() => {
    requestIdRef.current += 1;
    nextPageRef.current = 1;
    itemKeysRef.current = new Set();
    setItems([]);
    setHasMore(true);
    setError("");
    void loadPage(1);
  }, [loadPage]);

  const loadNextPage = useCallback(async () => {
    if (!hasMore || loadingInitial || loadingMore || fetchingRef.current) return;
    await loadPage(nextPageRef.current);
  }, [hasMore, loadPage, loadingInitial, loadingMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void loadNextPage();
          }
        }
      },
      {
        rootMargin: "800px 0px",
        threshold: 0.01
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadNextPage]);

  function updateFilters(next: { row?: string; genre?: string; year?: string }) {
    const params = new URLSearchParams(searchParams);
    if (next.row !== undefined) {
      if (next.row) params.set("row", next.row);
      else params.delete("row");
    }
    if (next.genre !== undefined) {
      if (next.genre) params.set("genre", next.genre);
      else params.delete("genre");
    }
    if (next.year !== undefined) {
      if (next.year) params.set("year", next.year);
      else params.delete("year");
    }
    setSearchParams(params);
  }

  function handleSelectItem(item: CatalogItem) {
    actions.setSelectedItem(item);
    actions.setCategory(item.type);
    navigate(`/watch/${item.type}/${encodeURIComponent(item.id)}`);
  }

  const headerTitle = selectedRow?.title || `Explorar ${categoryTitle(category)}`;

  return (
    <main className="category-page-shell">
      <header className="category-page-header">
        <Link to="/" className="back-link-icon" aria-label="Volver al inicio">
          <ArrowLeft size={22} />
        </Link>
        <div className="category-page-headline">
          <h1>{headerTitle}</h1>
          <p>
            {categoryTitle(category)}
            {selectedYear ? ` | ${selectedYear}` : ""}
          </p>
        </div>
      </header>

      <section className="category-page-filters">
        <div className="chip-row category-chip-row">
          <button
            type="button"
            className={!selectedRow && !selectedGenre ? "is-active" : ""}
            onClick={() => updateFilters({ row: "", genre: "" })}
          >
            Todo
          </button>
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className={selectedRow?.id === row.id ? "is-active" : ""}
              onClick={() => updateFilters({ row: row.id, genre: row.genre || "" })}
            >
              {row.title}
            </button>
          ))}
        </div>

        <label className="category-year-filter" htmlFor="category-year-filter">
          <span>Ano</span>
          <select
            id="category-year-filter"
            value={selectedYear}
            onChange={(event) => updateFilters({ year: event.target.value })}
          >
            <option value="">Todos</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="category-page-content">
        {loadingInitial ? (
          <p className="search-page-empty">Cargando catalogo...</p>
        ) : null}
        {error ? <p className="watch-error">{error}</p> : null}
        {!loadingInitial && !error && !items.length ? (
          <p className="search-page-empty">No hay resultados con esos filtros.</p>
        ) : null}

        {items.length ? (
          <div className="search-results-grid category-results-grid" ref={gridContainerRef}>
            {items.map((item) => (
              <MediaCard key={itemKey(item)} item={item} onSelect={handleSelectItem} />
            ))}
          </div>
        ) : null}

        <div ref={sentinelRef} className="category-scroll-sentinel" aria-hidden="true" />
        {loadingMore ? (
          <p className="category-loading-more">
            <LoaderCircle size={14} className="spin" /> Cargando mas...
          </p>
        ) : null}
        {!loadingInitial && hasMore && !loadingMore ? (
          <button type="button" className="secondary-btn category-load-more" onClick={() => void loadNextPage()}>
            Cargar mas
          </button>
        ) : null}
      </section>
    </main>
  );
}
