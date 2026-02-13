import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RefreshCw, Search, SlidersHorizontal, Tv2, X } from "lucide-react";
import { fetchCatalogByCategory, fetchSources, reloadSources } from "../api";
import { CategoryRail } from "../components/CategoryRail";
import { categoryTitle } from "../components/CategoryTabs";
import { useAppStore } from "../store/AppStore";
import type { CatalogItem, Category } from "../types";

interface GenreOption {
  id: string;
  label: string;
}

type SortMode = "trending" | "year" | "rating" | "name";

const SORT_LABELS: Record<SortMode, string> = {
  trending: "Tendencias",
  year: "Anio (nuevo primero)",
  rating: "Rating (alto primero)",
  name: "Nombre (A-Z)"
};

const GENRE_OPTIONS: Record<Category, GenreOption[]> = {
  movie: [
    { id: "28", label: "Accion" },
    { id: "12", label: "Aventura" },
    { id: "16", label: "Animacion" },
    { id: "35", label: "Comedia" },
    { id: "80", label: "Crimen" },
    { id: "99", label: "Documental" },
    { id: "18", label: "Drama" },
    { id: "10751", label: "Familiar" },
    { id: "14", label: "Fantasia" },
    { id: "27", label: "Terror" },
    { id: "878", label: "Ciencia ficcion" },
    { id: "53", label: "Suspenso" }
  ],
  series: [
    { id: "10759", label: "Accion y aventura" },
    { id: "16", label: "Animacion" },
    { id: "35", label: "Comedia" },
    { id: "80", label: "Crimen" },
    { id: "99", label: "Documental" },
    { id: "18", label: "Drama" },
    { id: "10751", label: "Familiar" },
    { id: "10762", label: "Kids" },
    { id: "9648", label: "Misterio" },
    { id: "10765", label: "Sci-Fi y Fantasia" },
    { id: "10768", label: "Guerra y politica" }
  ],
  tv: [
    { id: "10759", label: "Accion" },
    { id: "35", label: "Comedia" },
    { id: "18", label: "Drama" },
    { id: "10764", label: "Reality" },
    { id: "10766", label: "Soap" },
    { id: "10767", label: "Talk" },
    { id: "10768", label: "Noticias" }
  ]
};

function toNumber(value: string | null): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
  return String(value || "").trim().toLowerCase();
}

function suggestionScore(item: CatalogItem, term: string): number {
  const name = normalizeText(item.name);
  const description = normalizeText(item.description);
  const year = normalizeText(item.year);

  let score = 0;
  if (name === term) score += 140;
  else if (name.startsWith(term)) score += 100;
  else if (name.includes(term)) score += 70;

  if (description.includes(term)) score += 18;
  if (year && year.includes(term)) score += 12;
  if (item.rating) score += item.rating;

  return score;
}

export function HomePage() {
  const { state, actions } = useAppStore();
  const navigate = useNavigate();
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);

  const [catalogByCategory, setCatalogByCategory] = useState<Record<Category, CatalogItem[]>>({
    movie: [],
    series: [],
    tv: []
  });
  const [loading, setLoading] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);
  const [searchInput, setSearchInput] = useState(state.query || "");
  const [debouncedQuery, setDebouncedQuery] = useState(state.query || "");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("trending");
  const [minYearInput, setMinYearInput] = useState("");
  const [genreByCategory, setGenreByCategory] = useState<Record<Category, string>>({
    movie: "",
    series: "",
    tv: ""
  });

  const categories: Category[] = useMemo(() => ["movie", "series", "tv"], []);
  const activeGenre = genreByCategory[state.category];

  useEffect(() => {
    setSearchInput(state.query || "");
    setDebouncedQuery(state.query || "");
  }, [state.query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    actions.setQuery(debouncedQuery);
  }, [actions, debouncedQuery]);

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

  async function loadAllCatalog(query: string) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);

    try {
      const trimmedQuery = query.trim();
      const payloads = await Promise.all(
        categories.map((category) =>
          fetchCatalogByCategory({
            category,
            query: trimmedQuery,
            genre: genreByCategory[category],
            limit: trimmedQuery ? 72 : 90
          })
        )
      );

      if (requestId !== requestIdRef.current) return;

      const next: Record<Category, CatalogItem[]> = { movie: [], series: [], tv: [] };
      for (const payload of payloads) {
        next[payload.category] = payload.items;
      }
      setCatalogByCategory(next);
    } catch {
      if (requestId === requestIdRef.current) {
        setCatalogByCategory({ movie: [], series: [], tv: [] });
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
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

    return () => {
      mounted = false;
    };
  }, [actions]);

  useEffect(() => {
    void loadAllCatalog(debouncedQuery);
  }, [debouncedQuery, genreByCategory]);

  async function handleReloadSources() {
    try {
      await reloadSources();
      const sources = await fetchSources();
      actions.setSources(sources);
      await loadAllCatalog(debouncedQuery);
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

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const immediateQuery = searchInput.trim();
    setDebouncedQuery(immediateQuery);
    actions.setQuery(immediateQuery);
    setIsSearchFocused(false);
    setActiveSuggestionIndex(-1);
  }

  function handleClearSearch() {
    setSearchInput("");
    setDebouncedQuery("");
    actions.setQuery("");
    setIsSearchFocused(false);
    setActiveSuggestionIndex(-1);
  }

  function handleSetGenre(genreId: string) {
    setGenreByCategory((prev) => ({
      ...prev,
      [state.category]: genreId
    }));
  }

  function applyLocalFilters(items: CatalogItem[]): CatalogItem[] {
    const minYear = toNumber(minYearInput);
    const filtered = minYear > 0 ? items.filter((item) => toNumber(item.year) >= minYear) : items;

    if (sortMode === "year") {
      return [...filtered].sort((a, b) => toNumber(b.year) - toNumber(a.year));
    }

    if (sortMode === "rating") {
      return [...filtered].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }

    if (sortMode === "name") {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
    }

    return filtered;
  }

  const filteredCatalogByCategory = useMemo(
    () => ({
      movie: applyLocalFilters(catalogByCategory.movie),
      series: applyLocalFilters(catalogByCategory.series),
      tv: applyLocalFilters(catalogByCategory.tv)
    }),
    [catalogByCategory, minYearInput, sortMode]
  );

  const allVisibleItems = useMemo(
    () =>
      dedupeItems([
        ...filteredCatalogByCategory.movie,
        ...filteredCatalogByCategory.series,
        ...filteredCatalogByCategory.tv
      ]),
    [filteredCatalogByCategory]
  );

  const normalizedSearchTerm = useMemo(() => normalizeText(searchInput), [searchInput]);
  const searchSuggestions = useMemo(() => {
    if (normalizedSearchTerm.length < 2) return [];

    return allVisibleItems
      .map((item) => ({ item, score: suggestionScore(item, normalizedSearchTerm) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.item.rating || 0) - (a.item.rating || 0);
      })
      .slice(0, 10)
      .map((entry) => entry.item);
  }, [allVisibleItems, normalizedSearchTerm]);

  const showSearchPanel = isSearchFocused && normalizedSearchTerm.length >= 2;

  useEffect(() => {
    setActiveSuggestionIndex(-1);
  }, [normalizedSearchTerm, state.category]);

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

    if (event.key === "Enter" && activeSuggestionIndex >= 0) {
      event.preventDefault();
      handleSelectItem(searchSuggestions[activeSuggestionIndex]);
      setIsSearchFocused(false);
      setActiveSuggestionIndex(-1);
    }
  }

  const activeItems = filteredCatalogByCategory[state.category] || [];
  const newestRow = useMemo(
    () => [...activeItems].sort((a, b) => toNumber(b.year) - toNumber(a.year)).slice(0, 24),
    [activeItems]
  );
  const topRatedRow = useMemo(
    () => [...activeItems].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 24),
    [activeItems]
  );
  const trendingRow = useMemo(() => activeItems.slice(0, 24), [activeItems]);
  const mixedRow = useMemo(
    () =>
      dedupeItems([
        ...filteredCatalogByCategory.movie.slice(0, 10),
        ...filteredCatalogByCategory.series.slice(0, 10),
        ...filteredCatalogByCategory.tv.slice(0, 10)
      ]),
    [filteredCatalogByCategory]
  );
  const heroPool = useMemo(
    () => dedupeItems([...newestRow, ...topRatedRow, ...trendingRow, ...mixedRow]).slice(0, 18),
    [mixedRow, newestRow, topRatedRow, trendingRow]
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

  const heroRecommendations = useMemo(() => {
    if (!heroPool.length) return [];
    const amount = Math.min(4, heroPool.length);
    return Array.from({ length: amount }, (_, offset) => {
      const itemIndex = (heroIndex + offset) % heroPool.length;
      return {
        item: heroPool[itemIndex],
        index: itemIndex
      };
    });
  }, [heroIndex, heroPool]);

  const heroImage = heroItem ? heroItem.background || heroItem.poster || "" : "";
  const heroPosterFallback = Boolean(heroItem?.poster && !heroItem?.background);
  const hasLocalFilters = sortMode !== "trending" || Boolean(minYearInput.trim());

  return (
    <main className="home-shell">
      <header className={`home-header ${isHeaderScrolled ? "is-scrolled" : ""}`}>
        <div className="home-header-inner">
          <div className="home-header-left">
            <div className="brand-logo" aria-label="streams" onClick={() => {
              actions.setCategory("movie");
              actions.setQuery("");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}>
              streams
            </div>
            <nav className="home-nav">
              <button 
                type="button" 
                className={`nav-link ${state.category === "movie" && !state.query ? "is-active" : ""}`}
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
              <button 
                type="button" 
                className={`nav-link ${state.category === "tv" ? "is-active" : ""}`}
                onClick={() => actions.setCategory("tv")}
              >
                Canales
              </button>
              <Link to="/live-tv" className="nav-link">
                TV en vivo
              </Link>
            </nav>
          </div>

          <div className="home-header-right">
            <div className={`search-container ${isSearchFocused || searchInput ? "is-expanded" : ""}`} ref={searchBoxRef}>
              <form className="header-search-v2" onSubmit={handleSearchSubmit}>
                <button type="button" className="search-icon-btn" onClick={() => setIsSearchFocused(true)}>
                  <Search size={20} />
                </button>
                <input
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
                  {loading ? <div className="search-loader">Buscando...</div> : null}
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
                          <span className="dot">•</span>
                          <span>{categoryTitle(item.type)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
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
            key={heroItem?.id} // Add key to trigger transition if image changes
          />
        ) : null}
        <div className="hero-overlay">
          <div className="hero-content-wrap">
            <span className="hero-kicker">{categoryTitle(state.category)}</span>
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

        {heroRecommendations.length > 1 ? (
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
        {hasLocalFilters ? (
          <p className="muted home-filter-summary">Orden: {SORT_LABELS[sortMode]} | Anio minimo: {minYearInput || "sin limite"}</p>
        ) : null}
        {loading ? <p className="muted">Cargando...</p> : null}
        {!loading && !activeItems.length ? <p className="muted">No hay resultados para los filtros actuales.</p> : null}
        <CategoryRail title={`${categoryTitle(state.category)} | Estrenos`} items={newestRow} onSelect={handleSelectItem} />
        <CategoryRail
          title={`${categoryTitle(state.category)} | Mejor valoradas`}
          items={topRatedRow}
          onSelect={handleSelectItem}
        />
        <CategoryRail title={`${categoryTitle(state.category)} | Tendencias`} items={trendingRow} onSelect={handleSelectItem} />
        <CategoryRail title="Para explorar" items={mixedRow} onSelect={handleSelectItem} />
      </section>

      {isFilterOpen ? <div className="offcanvas-backdrop" onClick={() => setIsFilterOpen(false)} /> : null}
      <aside className={`genre-offcanvas ${isFilterOpen ? "is-open" : ""}`} aria-hidden={!isFilterOpen}>
        <div className="genre-offcanvas-header">
          <h3>Filtros de {categoryTitle(state.category)}</h3>
          <button type="button" className="icon-only-btn" onClick={() => setIsFilterOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="filter-stack">
          <label className="season-select">
            <span>Orden</span>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="trending">Tendencias</option>
              <option value="year">Anio (nuevo primero)</option>
              <option value="rating">Rating (alto primero)</option>
              <option value="name">Nombre (A-Z)</option>
            </select>
          </label>

          <label className="season-select">
            <span>Anio minimo</span>
            <input
              type="number"
              inputMode="numeric"
              min={1900}
              max={2100}
              step={1}
              value={minYearInput}
              onChange={(event) => setMinYearInput(event.target.value.replace(/[^\d]/g, "").slice(0, 4))}
              placeholder="Ej: 2018"
            />
          </label>

          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setSortMode("trending");
              setMinYearInput("");
            }}
          >
            Limpiar filtros locales
          </button>
        </div>

        <p className="muted">Selecciona un genero para refinar recomendaciones.</p>
        <div className="genre-grid">
          <button
            type="button"
            className={`genre-chip ${!activeGenre ? "is-active" : ""}`}
            onClick={() => handleSetGenre("")}
          >
            Todos
          </button>
          {GENRE_OPTIONS[state.category].map((genre) => (
            <button
              key={genre.id}
              type="button"
              className={`genre-chip ${activeGenre === genre.id ? "is-active" : ""}`}
              onClick={() => handleSetGenre(genre.id)}
            >
              {genre.label}
            </button>
          ))}
        </div>
      </aside>
    </main>
  );
}
