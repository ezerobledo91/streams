import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clapperboard, Film, Radio, RefreshCw, Search, SlidersHorizontal, Tv2, X } from "lucide-react";
import { fetchCatalogByCategory, fetchSources, reloadSources } from "../api";
import { CategoryRail } from "../components/CategoryRail";
import { ContinueWatchingRail } from "../components/ContinueWatchingRail";
import { categoryTitle } from "../components/CategoryTabs";
import { useAppStore } from "../store/AppStore";
import { getContinueWatching } from "../lib/watch-history";
import type { WatchHistoryEntry } from "../lib/watch-history";
import type { CatalogItem, Category } from "../types";

interface RowConfig {
  id: string;
  title: string;
  genre?: string;
  limit: number;
}

const GENRE_ROWS: Record<Category, RowConfig[]> = {
  movie: [
    { id: "trending", title: "Tendencias", limit: 24 },
    { id: "action", title: "Accion", genre: "28", limit: 20 },
    { id: "comedy", title: "Comedia", genre: "35", limit: 20 },
    { id: "drama", title: "Drama", genre: "18", limit: 20 },
    { id: "scifi", title: "Ciencia ficcion", genre: "878", limit: 20 },
    { id: "animation", title: "Animacion", genre: "16", limit: 20 },
    { id: "horror", title: "Terror", genre: "27", limit: 20 },
  ],
  series: [
    { id: "trending", title: "Tendencias", limit: 24 },
    { id: "action", title: "Accion y aventura", genre: "10759", limit: 20 },
    { id: "comedy", title: "Comedia", genre: "35", limit: 20 },
    { id: "drama", title: "Drama", genre: "18", limit: 20 },
    { id: "scifi", title: "Sci-Fi y Fantasia", genre: "10765", limit: 20 },
    { id: "animation", title: "Animacion", genre: "16", limit: 20 },
  ],
  tv: []
};

function dedupeItems(items: CatalogItem[]): CatalogItem[] {
  const out: CatalogItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function suggestionScore(item: CatalogItem, term: string): number {
  const name = normalizeText(item.name);
  const description = normalizeText(item.description);
  const year = normalizeText(item.year);
  const terms = term.split(" ").filter((part) => part.length >= 2);

  let score = 0;
  if (name === term) score += 160;
  else if (name.startsWith(term)) score += 120;
  else if (name.includes(term)) score += 85;

  if (description.includes(term)) score += 24;
  if (year && year.includes(term)) score += 12;

  if (terms.length) {
    const nameHits = terms.reduce((total, part) => total + (name.includes(part) ? 1 : 0), 0);
    const descriptionHits = terms.reduce((total, part) => total + (description.includes(part) ? 1 : 0), 0);
    score += nameHits * 24;
    score += descriptionHits * 7;
    if (nameHits === terms.length) score += 22;
  }

  if (score > 0 && item.rating) score += item.rating;

  return score;
}

export function HomePage() {
  const { state, actions } = useAppStore();
  const navigate = useNavigate();
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchRequestIdRef = useRef(0);
  const loadRequestIdRef = useRef(0);

  const [rowData, setRowData] = useState<Record<string, CatalogItem[]>>({});
  const [searchCatalogByCategory, setSearchCatalogByCategory] = useState<Record<Category, CatalogItem[]>>({
    movie: [],
    series: [],
    tv: []
  });
  const [continueWatching, setContinueWatching] = useState<WatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const categories: Category[] = useMemo(() => ["movie", "series"], []);
  const activeHomeCategory: Category = state.category === "tv" ? "movie" : state.category;

  useEffect(() => {
    if (state.category === "tv") {
      actions.setCategory("movie");
    }
  }, [actions, state.category]);

  useEffect(() => {
    setContinueWatching(getContinueWatching());
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    function onScroll() {
      setIsHeaderScrolled(window.scrollY > 16);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsFilterOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const container = searchBoxRef.current;
      if (!container) return;
      if (container.contains(event.target as Node)) return;
      setIsSearchFocused(false);
      setActiveSuggestionIndex(-1);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!isSearchFocused) return;
    const timeout = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [isSearchFocused]);

  const loadGenreRows = useCallback(async (category: Category) => {
    const rows = GENRE_ROWS[category];
    if (!rows.length) return;

    const requestId = ++loadRequestIdRef.current;
    setLoading(true);

    try {
      const payloads = await Promise.all(
        rows.map((row) =>
          fetchCatalogByCategory({
            category,
            genre: row.genre,
            limit: row.limit
          })
        )
      );

      if (requestId !== loadRequestIdRef.current) return;

      const next: Record<string, CatalogItem[]> = {};
      for (let i = 0; i < rows.length; i++) {
        next[rows[i].id] = payloads[i].items;
      }
      setRowData(next);
    } catch {
      if (requestId === loadRequestIdRef.current) {
        setRowData({});
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  async function loadSearchCatalog(query: string) {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      searchRequestIdRef.current += 1;
      setSearchLoading(false);
      setSearchCatalogByCategory({ movie: [], series: [], tv: [] });
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setSearchLoading(true);

    try {
      const payloads = await Promise.all(
        categories.map((category) =>
          fetchCatalogByCategory({
            category,
            query: trimmedQuery,
            limit: 48
          })
        )
      );

      if (requestId !== searchRequestIdRef.current) return;

      const next: Record<Category, CatalogItem[]> = { movie: [], series: [], tv: [] };
      for (const payload of payloads) {
        next[payload.category] = payload.items;
      }
      setSearchCatalogByCategory(next);
    } catch {
      if (requestId === searchRequestIdRef.current) {
        setSearchCatalogByCategory({ movie: [], series: [], tv: [] });
      }
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setSearchLoading(false);
      }
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sources = await fetchSources();
        if (!mounted) return;
        actions.setSources(sources);
      } catch {
        // no-op
      }
    })();
    return () => { mounted = false; };
  }, [actions]);

  useEffect(() => {
    void loadGenreRows(activeHomeCategory);
  }, [activeHomeCategory, loadGenreRows]);

  useEffect(() => {
    void loadSearchCatalog(debouncedQuery);
  }, [debouncedQuery]);

  async function handleReloadSources() {
    try {
      await reloadSources();
      const sources = await fetchSources();
      actions.setSources(sources);
      await loadGenreRows(activeHomeCategory);
      await loadSearchCatalog(debouncedQuery);
    } catch {
      // no-op
    }
  }

  function handleSelectItem(item: CatalogItem) {
    actions.setSelectedItem(item);
    actions.setCategory(item.type);
    const encodedId = encodeURIComponent(item.id);
    navigate(`/watch/${item.type}/${encodedId}`);
  }

  function handleSelectContinueWatching(entry: WatchHistoryEntry) {
    const encodedId = encodeURIComponent(entry.itemId);
    navigate(`/watch/${entry.type}/${encodedId}`);
  }

  function openSearchResults(rawQuery: string) {
    const immediateQuery = rawQuery.trim();
    setDebouncedQuery(immediateQuery);
    actions.setQuery(immediateQuery);
    if (!immediateQuery) {
      setIsSearchFocused(false);
      setActiveSuggestionIndex(-1);
      return;
    }
    navigate(`/search?q=${encodeURIComponent(immediateQuery)}`);
    setIsSearchFocused(false);
    setActiveSuggestionIndex(-1);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openSearchResults(searchInput);
  }

  function handleClearSearch() {
    setSearchInput("");
    setDebouncedQuery("");
    actions.setQuery("");
    setIsSearchFocused(false);
    setActiveSuggestionIndex(-1);
    setSearchCatalogByCategory({ movie: [], series: [], tv: [] });
  }

  function handleScrollToRow(rowId: string) {
    setIsFilterOpen(false);
    const section = document.querySelector(`[data-row-id="${rowId}"]`);
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleOpenSearchPage() {
    const query = searchInput.trim();
    if (query) {
      openSearchResults(query);
      return;
    }
    navigate("/search");
  }

  const allSearchItems = useMemo(
    () =>
      dedupeItems([
        ...searchCatalogByCategory.movie,
        ...searchCatalogByCategory.series,
        ...searchCatalogByCategory.tv
      ]),
    [searchCatalogByCategory]
  );

  const normalizedSearchTerm = useMemo(() => normalizeText(searchInput), [searchInput]);
  const searchSuggestions = useMemo(() => {
    if (normalizedSearchTerm.length < 2) return [];

    const ranked = allSearchItems
      .map((item) => ({ item, score: suggestionScore(item, normalizedSearchTerm) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.item.rating || 0) - (a.item.rating || 0);
      });

    const positive = ranked.filter((entry) => entry.score > 0);
    const pool = positive.length ? positive : ranked;
    return pool.slice(0, 10).map((entry) => entry.item);
  }, [allSearchItems, normalizedSearchTerm]);

  const showSearchPanel = isSearchFocused && normalizedSearchTerm.length >= 2;

  useEffect(() => {
    setActiveSuggestionIndex(-1);
  }, [normalizedSearchTerm, activeHomeCategory]);

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setIsSearchFocused(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    if (!showSearchPanel || !searchSuggestions.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => Math.min(searchSuggestions.length - 1, current + 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => Math.max(-1, current - 1));
      return;
    }
  }

  // Hero from trending row
  const trendingItems = rowData["trending"] || [];
  const heroPool = useMemo(
    () => trendingItems.filter((item) => item.background).slice(0, 12),
    [trendingItems]
  );
  const heroItem = heroPool.length ? heroPool[heroIndex % heroPool.length] : null;

  useEffect(() => {
    if (!heroPool.length) {
      setHeroIndex(0);
      return;
    }
    setHeroIndex((current) => current % heroPool.length);
  }, [heroPool]);

  useEffect(() => {
    if (heroPool.length <= 1) return undefined;
    const interval = window.setInterval(() => {
      setHeroIndex((current) => (current + 1) % heroPool.length);
    }, 6500);
    return () => window.clearInterval(interval);
  }, [heroPool.length]);

  const heroImage = heroItem ? heroItem.background || heroItem.poster || "" : "";
  const heroPosterFallback = Boolean(heroItem?.poster && !heroItem?.background);
  const activeRows = GENRE_ROWS[activeHomeCategory] || [];

  return (
    <main className="home-shell">
      <header className={`home-header ${isHeaderScrolled ? "is-scrolled" : ""}`}>
        <div className="home-header-inner">
          <div className="home-header-left">
            <div className="brand-logo" aria-label="streams" onClick={() => {
              actions.setCategory("movie");
              actions.setQuery("");
              setSearchInput("");
              setDebouncedQuery("");
              setSearchCatalogByCategory({ movie: [], series: [], tv: [] });
              setIsSearchFocused(false);
              setActiveSuggestionIndex(-1);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}>
              streams
            </div>
            <nav className="home-nav">
              <button
                type="button"
                className={`nav-link ${state.category === "movie" ? "is-active" : ""}`}
                onClick={() => actions.setCategory("movie")}
              >
                Peliculas
              </button>
              <button
                type="button"
                className={`nav-link ${state.category === "series" ? "is-active" : ""}`}
                onClick={() => actions.setCategory("series")}
              >
                Series
              </button>
              <Link to="/live-tv" className="nav-link">
                TV en vivo
              </Link>
            </nav>
          </div>

          <div className="home-header-right">
            <div className={`search-container ${isSearchFocused || searchInput ? "is-expanded" : ""}`} ref={searchBoxRef}>
              <form className="header-search-v2" onSubmit={handleSearchSubmit}>
                <button
                  type="button"
                  className="search-icon-btn"
                  onClick={() => {
                    setIsSearchFocused(true);
                    searchInputRef.current?.focus();
                  }}
                >
                  <Search size={20} />
                </button>
                <input
                  ref={searchInputRef}
                  type="search"
                  placeholder="Titulos, personas, generos..."
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onKeyDown={handleSearchKeyDown}
                />
                {searchInput ? (
                  <button type="button" className="search-clear-btn" onClick={handleClearSearch}>
                    <X size={18} />
                  </button>
                ) : null}
              </form>

              {showSearchPanel ? (
                <div className="search-suggest-panel-v2" role="listbox">
                  {searchLoading ? <div className="search-loader">Buscando...</div> : null}
                  {searchSuggestions.map((item, index) => (
                    <button
                      key={`${item.type}:${item.id}`}
                      type="button"
                      className={`search-suggest-item-v2 ${index === activeSuggestionIndex ? "is-active" : ""}`}
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setActiveSuggestionIndex(index)}
                    >
                      <div className="suggest-thumb">
                        {item.poster ? <img src={item.poster} alt="" /> : <div className="thumb-placeholder" />}
                      </div>
                      <div className="suggest-info">
                        <div className="suggest-title">{item.name}</div>
                        <div className="suggest-meta">
                          <span>{item.year}</span>
                          <span className="dot">|</span>
                          <span>{categoryTitle(item.type)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                  {!searchLoading && !searchSuggestions.length ? (
                    <div className="search-empty">No encontramos resultados para "{searchInput.trim()}".</div>
                  ) : null}
                  {searchInput.trim() ? (
                    <button type="button" className="search-open-results-btn" onClick={() => openSearchResults(searchInput)}>
                      Ver todos los resultados
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <button type="button" className="header-action-btn" onClick={() => setIsFilterOpen(true)} title="Filtros">
              <SlidersHorizontal size={20} />
            </button>
            <button type="button" className="header-action-btn" onClick={handleReloadSources} title="Recargar fuentes">
              <RefreshCw size={20} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <section className="hero-banner">
        {heroImage ? (
          <img
            src={heroImage}
            alt={heroItem?.name || "Titulo destacado"}
            className={heroPosterFallback ? "hero-image hero-image-poster" : "hero-image"}
            key={heroItem?.id}
          />
        ) : null}
        <div className="hero-overlay">
          <div className="hero-content-wrap">
            <span className="hero-kicker">{categoryTitle(activeHomeCategory)}</span>
            <h1>{heroItem?.name || "Explora el catalogo"}</h1>

            <div className="hero-meta">
              <span className="hero-rating">
                {heroItem?.rating ? `${(heroItem.rating * 10).toFixed(0)}% para ti` : "Novedad"}
              </span>
              <span className="hero-year">{heroItem?.year || "s/a"}</span>
            </div>

            <p>{heroItem?.description || "Peliculas, series y TV en vivo en una interfaz simple."}</p>

            <div className="hero-actions">
              {heroItem ? (
                <button type="button" className="primary-btn" onClick={() => handleSelectItem(heroItem)}>
                  <Tv2 size={24} />
                  Reproducir
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {heroPool.length > 1 ? (
          <div className="hero-selectors">
            {heroPool.slice(0, 6).map((_, index) => (
              <button
                key={index}
                type="button"
                className={`hero-selector-btn ${index === (heroIndex % 6) ? "is-active" : ""}`}
                onClick={() => setHeroIndex(index)}
                aria-label={`Ver recomendacion ${index + 1}`}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="home-rows">
        {loading ? <p className="muted" style={{ padding: "0 4%" }}>Cargando...</p> : null}

        {continueWatching.length > 0 ? (
          <ContinueWatchingRail items={continueWatching} onSelect={handleSelectContinueWatching} />
        ) : null}

        {activeRows.map((row) => (
          <div key={row.id} data-row-id={row.id}>
            <CategoryRail
              title={row.title}
              items={rowData[row.id] || []}
              onSelect={handleSelectItem}
            />
          </div>
        ))}
      </section>

      <nav className="mobile-dock" aria-label="Navegacion movil">
        <button
          type="button"
          className={`mobile-dock-item ${state.category === "movie" ? "is-active" : ""}`}
          onClick={() => actions.setCategory("movie")}
        >
          <Film size={17} />
          <span>Pelis</span>
        </button>
        <button
          type="button"
          className={`mobile-dock-item ${state.category === "series" ? "is-active" : ""}`}
          onClick={() => actions.setCategory("series")}
        >
          <Clapperboard size={17} />
          <span>Series</span>
        </button>
        <button
          type="button"
          className="mobile-dock-item"
          onClick={handleOpenSearchPage}
        >
          <Search size={17} />
          <span>Buscar</span>
        </button>
        <Link to="/live-tv" className="mobile-dock-item">
          <Radio size={17} />
          <span>En vivo</span>
        </Link>
      </nav>
      {isFilterOpen ? <div className="offcanvas-backdrop" onClick={() => setIsFilterOpen(false)} /> : null}
      <aside className={`genre-offcanvas ${isFilterOpen ? "is-open" : ""}`} aria-hidden={!isFilterOpen}>
        <div className="genre-offcanvas-header">
          <h3>Generos de {categoryTitle(activeHomeCategory)}</h3>
          <button type="button" className="icon-only-btn" onClick={() => setIsFilterOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <p className="muted">Toca un genero para ir a su fila.</p>
        <div className="genre-grid">
          {activeRows.map((row) => (
            <button
              key={row.id}
              type="button"
              className="genre-chip"
              onClick={() => handleScrollToRow(row.id)}
            >
              {row.title}
            </button>
          ))}
        </div>
      </aside>
    </main>
  );
}
