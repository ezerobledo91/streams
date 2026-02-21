import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clapperboard, Film, Heart, Radio, RefreshCw, Search, SlidersHorizontal, Tv2, X } from "lucide-react";
import { fetchCatalogByCategory, fetchContinueWatching, fetchSources, reloadSources } from "../api";
import { CategoryRail } from "../components/CategoryRail";
import { ContinueWatchingRail } from "../components/ContinueWatchingRail";
import { UserSummary } from "../components/UserSummary";
import { categoryTitle } from "../components/CategoryTabs";
import { useAppStore } from "../store/AppStore";
import { useGamepad } from "../hooks/useGamepad";
import { useAppShell } from "../context/AppShellContext";
import { getContinueWatching } from "../lib/watch-history";
import type { WatchHistoryEntry } from "../lib/watch-history";
import type { CatalogItem, Category } from "../types";

interface RowConfig {
  id: string;
  title: string;
  genre?: string;
  limit: number;
}

type Direction = "up" | "down" | "left" | "right";

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

function truncateText(value: string, maxChars: number): string {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function toHighResTmdbImage(url: string): string {
  const input = String(url || "").trim();
  if (!input.includes("image.tmdb.org/t/p/")) return input;
  return input.replace(/\/t\/p\/(?:w\d+|original)\//, "/t/p/original/");
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return Boolean(
    tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      element?.isContentEditable
  );
}

function isVisibleElement(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

function findDirectionalIndex(elements: HTMLElement[], currentIndex: number, direction: Direction): number {
  if (!elements.length) return -1;
  const boundedIndex = Math.max(0, Math.min(elements.length - 1, currentIndex));

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

  let currentRowIndex = -1;
  let currentColumnIndex = -1;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const colIndex = rows[rowIndex].findIndex((entry) => entry.index === boundedIndex);
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
}

export function HomePage() {
  const { state, actions } = useAppStore();
  const { isSideNavOpen } = useAppShell();
  const navigate = useNavigate();
  const homeRootRef = useRef<HTMLElement | null>(null);
  const filterPanelRef = useRef<HTMLElement | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchRequestIdRef = useRef(0);
  const loadRequestIdRef = useRef(0);
  const focusedHomeElementRef = useRef<HTMLElement | null>(null);
  const homeNavActivatedRef = useRef(false);
  const headerIndexRef = useRef(0);
  const railRowIndexRef = useRef(0);
  const railColByRowRef = useRef<Record<number, number>>({});
  const desiredRailColRef = useRef(0);
  const filterFocusedIndexRef = useRef(0);
  const lastFocusedBeforeFilterRef = useRef<HTMLElement | null>(null);

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

  const getHeaderFocusableElements = useCallback(() => {
    const root = homeRootRef.current;
    if (!root) return [] as HTMLElement[];
    const elements = Array.from(root.querySelectorAll<HTMLElement>(".home-header-focusable"))
      .filter(isVisibleElement);
    for (const element of elements) {
      element.tabIndex = -1;
    }
    return elements;
  }, []);

  const getHeroFocusableElement = useCallback(() => {
    const root = homeRootRef.current;
    if (!root) return null;
    const element = root.querySelector<HTMLElement>(".home-hero-focusable");
    if (!element || !isVisibleElement(element)) return null;
    element.tabIndex = -1;
    return element;
  }, []);

  const getRailRows = useCallback(() => {
    const root = homeRootRef.current;
    if (!root) return [] as HTMLElement[][];

    const rails = Array.from(root.querySelectorAll<HTMLElement>(".home-rows .category-rail"));
    return rails
      .map((rail) => {
        const cards = Array.from(rail.querySelectorAll<HTMLElement>(".carousel-track > .media-tile"))
          .filter(isVisibleElement);
        const browse = rail.querySelector<HTMLElement>(".rail-browse-link");
        const row = browse && isVisibleElement(browse) ? [...cards, browse] : cards;
        for (const element of row) {
          element.classList.add("home-rail-focusable");
          element.tabIndex = -1;
        }
        return row;
      })
      .filter((row) => row.length > 0);
  }, []);

  const clearHomeFocus = useCallback(() => {
    const root = homeRootRef.current;
    if (!root) return;
    for (const element of root.querySelectorAll<HTMLElement>(".home-header-focusable, .home-hero-focusable, .home-rail-focusable")) {
      element.classList.remove("tv-focused");
      element.tabIndex = -1;
    }
  }, []);

  const markHomeLocation = useCallback(
    (element: HTMLElement) => {
      const headerElements = getHeaderFocusableElements();
      const headerIndex = headerElements.indexOf(element);
      if (headerIndex >= 0) {
        headerIndexRef.current = headerIndex;
        focusedHomeElementRef.current = element;
        return { zone: "header" as const, index: headerIndex };
      }

      const heroElement = getHeroFocusableElement();
      if (heroElement && heroElement === element) {
        focusedHomeElementRef.current = element;
        return { zone: "hero" as const };
      }

      const rows = getRailRows();
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const columnIndex = rows[rowIndex].indexOf(element);
        if (columnIndex >= 0) {
          railRowIndexRef.current = rowIndex;
          railColByRowRef.current[rowIndex] = columnIndex;
          desiredRailColRef.current = columnIndex;
          focusedHomeElementRef.current = element;
          return { zone: "rails" as const, rowIndex, columnIndex };
        }
      }

      focusedHomeElementRef.current = null;
      return null;
    },
    [getHeaderFocusableElements, getHeroFocusableElement, getRailRows]
  );

  const applyHomeFocus = useCallback(
    (element: HTMLElement | null) => {
      if (!element || !element.isConnected) return false;
      clearHomeFocus();
      element.classList.add("tv-focused");
      element.tabIndex = 0;
      element.focus({ preventScroll: false });
      element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      markHomeLocation(element);
      homeNavActivatedRef.current = true;
      return true;
    },
    [clearHomeFocus, markHomeLocation]
  );

  const focusHeaderByIndex = useCallback(
    (nextIndex: number) => {
      const elements = getHeaderFocusableElements();
      if (!elements.length) return false;
      const bounded = Math.max(0, Math.min(elements.length - 1, nextIndex));
      return applyHomeFocus(elements[bounded]);
    },
    [applyHomeFocus, getHeaderFocusableElements]
  );

  const focusHeroPrimary = useCallback(() => {
    const hero = getHeroFocusableElement();
    return applyHomeFocus(hero);
  }, [applyHomeFocus, getHeroFocusableElement]);

  const focusRailByCoordinates = useCallback(
    (rowIndex: number, columnIndex: number) => {
      const rows = getRailRows();
      if (!rows.length) return false;

      const boundedRow = Math.max(0, Math.min(rows.length - 1, rowIndex));
      const row = rows[boundedRow];
      if (!row?.length) return false;

      desiredRailColRef.current = Math.max(0, columnIndex);
      const boundedColumn = Math.max(0, Math.min(row.length - 1, desiredRailColRef.current));
      railRowIndexRef.current = boundedRow;
      railColByRowRef.current[boundedRow] = boundedColumn;
      return applyHomeFocus(row[boundedColumn]);
    },
    [applyHomeFocus, getRailRows]
  );

  const getCurrentHomeLocation = useCallback(() => {
    const current = focusedHomeElementRef.current;
    if (current && current.isConnected) {
      const location = markHomeLocation(current);
      if (location) return location;
    }

    const active = document.activeElement;
    if (active && active instanceof HTMLElement && homeRootRef.current?.contains(active)) {
      const location = markHomeLocation(active);
      if (location) return location;
    }

    return null;
  }, [markHomeLocation]);

  const getFilterFocusableElements = useCallback(() => {
    const panel = filterPanelRef.current;
    if (!panel) return [] as HTMLElement[];
    const elements = Array.from(panel.querySelectorAll<HTMLElement>(".home-filter-focusable"))
      .filter(isVisibleElement);
    for (const element of elements) {
      element.tabIndex = -1;
    }
    return elements;
  }, []);

  const clearFilterFocus = useCallback((elements?: HTMLElement[]) => {
    const list = elements || getFilterFocusableElements();
    for (const element of list) {
      element.classList.remove("tv-focused");
      element.tabIndex = -1;
    }
  }, [getFilterFocusableElements]);

  const applyFilterFocusByIndex = useCallback(
    (nextIndex: number) => {
      const elements = getFilterFocusableElements();
      if (!elements.length) return false;
      const bounded = Math.max(0, Math.min(elements.length - 1, nextIndex));
      filterFocusedIndexRef.current = bounded;
      clearFilterFocus(elements);

      const target = elements[bounded];
      target.classList.add("tv-focused");
      target.tabIndex = 0;
      target.focus({ preventScroll: false });
      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      return true;
    },
    [clearFilterFocus, getFilterFocusableElements]
  );

  const closeSearchOverlay = useCallback(
    (restoreHeaderFocus = true) => {
      setIsSearchFocused(false);
      setActiveSuggestionIndex(-1);
      searchInputRef.current?.blur();
      if (!restoreHeaderFocus) return;
      if (searchButtonRef.current) {
        applyHomeFocus(searchButtonRef.current);
      }
    },
    [applyHomeFocus]
  );

  const closeFilterPanel = useCallback(() => {
    clearFilterFocus();
    setIsFilterOpen(false);
    const previous = lastFocusedBeforeFilterRef.current;
    if (previous && previous.isConnected) {
      window.requestAnimationFrame(() => {
        applyHomeFocus(previous);
      });
    }
  }, [applyHomeFocus, clearFilterFocus]);

  useEffect(() => {
    if (state.category === "tv") {
      actions.setCategory("movie");
    }
  }, [actions, state.category]);

  useEffect(() => {
    const localEntries = getContinueWatching();

    if (!state.user) {
      setContinueWatching(localEntries);
      return;
    }

    fetchContinueWatching(state.user.username)
      .then((res) => {
        const backendEntries: WatchHistoryEntry[] = res.items.map((e) => ({
          type: e.type,
          itemId: e.itemId,
          name: e.name,
          poster: e.poster,
          background: e.background,
          season: e.season ?? undefined,
          episode: e.episode ?? undefined,
          episodeTitle: e.episodeTitle ?? undefined,
          position: e.position,
          duration: e.duration,
          lastWatched: e.lastWatched
        }));

        const seen = new Set<string>();
        const merged: WatchHistoryEntry[] = [];
        for (const e of backendEntries) {
          const k = e.type === "series" && e.season != null && e.episode != null
            ? `${e.type}:${e.itemId}:${e.season}:${e.episode}`
            : `${e.type}:${e.itemId}`;
          if (!seen.has(k)) {
            seen.add(k);
            merged.push(e);
          }
        }
        for (const e of localEntries) {
          const k = e.type === "series" && e.season != null && e.episode != null
            ? `${e.type}:${e.itemId}:${e.season}:${e.episode}`
            : `${e.type}:${e.itemId}`;
          if (!seen.has(k)) {
            seen.add(k);
            merged.push(e);
          }
        }
        merged.sort((a, b) => b.lastWatched - a.lastWatched);
        setContinueWatching(merged);
      })
      .catch(() => setContinueWatching(localEntries));
  }, [state.user]);

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
      closeSearchOverlay();
      return;
    }
    navigate(`/search?q=${encodeURIComponent(immediateQuery)}`);
    closeSearchOverlay(false);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openSearchResults(searchInput);
  }

  function handleClearSearch() {
    setSearchInput("");
    setDebouncedQuery("");
    actions.setQuery("");
    closeSearchOverlay();
    setSearchCatalogByCategory({ movie: [], series: [], tv: [] });
  }

  function handleScrollToRow(rowId: string) {
    clearFilterFocus();
    setIsFilterOpen(false);
    const query = rowId ? `?row=${encodeURIComponent(rowId)}` : "";
    navigate(`/category/${activeHomeCategory}${query}`);
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
    if (event.key === "Escape" || event.key === "BrowserBack" || event.key === "GoBack") {
      event.preventDefault();
      closeSearchOverlay();
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
      const selectedItem = searchSuggestions[activeSuggestionIndex];
      if (selectedItem) {
        handleSelectItem(selectedItem);
      }
    }
  }

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

  const heroImage = heroItem ? toHighResTmdbImage(heroItem.background || heroItem.poster || "") : "";
  const heroPosterFallback = Boolean(heroItem?.poster && !heroItem?.background);
  const heroTitle = truncateText(heroItem?.name || "Explora el catalogo", 25);
  const activeRows = GENRE_ROWS[activeHomeCategory] || [];

  useGamepad(true);

  useEffect(() => {
    if (!isFilterOpen) {
      clearFilterFocus();
      filterFocusedIndexRef.current = 0;
      return;
    }

    const focusables = getFilterFocusableElements();
    if (!focusables.length) return;
    const firstChipIndex = focusables.findIndex((item) => item.classList.contains("genre-chip"));
    const initialIndex = firstChipIndex >= 0 ? firstChipIndex : 0;
    const timeout = window.setTimeout(() => {
      applyFilterFocusByIndex(initialIndex);
    }, 40);

    return () => window.clearTimeout(timeout);
  }, [applyFilterFocusByIndex, clearFilterFocus, getFilterFocusableElements, isFilterOpen]);

  useEffect(() => {
    if (!homeNavActivatedRef.current) return;
    if (isSideNavOpen || isFilterOpen || isSearchFocused) return;

    const location = getCurrentHomeLocation();
    if (!location) {
      focusHeaderByIndex(headerIndexRef.current);
      return;
    }
    if (location.zone === "header") {
      focusHeaderByIndex(location.index);
      return;
    }
    if (location.zone === "hero") {
      focusHeroPrimary();
      return;
    }
    focusRailByCoordinates(location.rowIndex, location.columnIndex);
  }, [
    activeHomeCategory,
    continueWatching,
    focusHeaderByIndex,
    focusHeroPrimary,
    focusRailByCoordinates,
    getCurrentHomeLocation,
    isFilterOpen,
    isSearchFocused,
    isSideNavOpen,
    rowData
  ]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isSideNavOpen) return;
      const key = event.key;
      const isBackKey = key === "Escape" || key === "Backspace" || key === "BrowserBack" || key === "GoBack";

      if (isFilterOpen) {
        if (isBackKey) {
          event.preventDefault();
          closeFilterPanel();
          return;
        }

        if (key === "Enter") {
          event.preventDefault();
          const focusables = getFilterFocusableElements();
          const index = Math.max(0, Math.min(focusables.length - 1, filterFocusedIndexRef.current));
          focusables[index]?.click();
          return;
        }

        if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
          event.preventDefault();
          const focusables = getFilterFocusableElements();
          const currentIndex = Math.max(0, Math.min(focusables.length - 1, filterFocusedIndexRef.current));
          const direction = key.replace("Arrow", "").toLowerCase() as Direction;
          const nextIndex = findDirectionalIndex(focusables, currentIndex, direction);
          if (nextIndex >= 0) {
            applyFilterFocusByIndex(nextIndex);
          }
          return;
        }

        return;
      }

      if (isSearchFocused) {
        if (key === "Escape" || key === "BrowserBack" || key === "GoBack") {
          event.preventDefault();
          closeSearchOverlay();
          return;
        }

        if (isEditableTarget(event.target)) return;
        if (!showSearchPanel || !searchSuggestions.length) return;

        if (key === "ArrowDown") {
          event.preventDefault();
          setActiveSuggestionIndex((current) => Math.min(searchSuggestions.length - 1, current + 1));
          return;
        }

        if (key === "ArrowUp") {
          event.preventDefault();
          setActiveSuggestionIndex((current) => Math.max(-1, current - 1));
          return;
        }

        if (key === "Enter") {
          event.preventDefault();
          const selectedItem = activeSuggestionIndex >= 0 ? searchSuggestions[activeSuggestionIndex] : null;
          if (selectedItem) {
            handleSelectItem(selectedItem);
          } else {
            openSearchResults(searchInput);
          }
        }
        return;
      }

      if (isEditableTarget(event.target)) return;
      if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Enter") {
        return;
      }

      const location = getCurrentHomeLocation();
      if (!location) {
        event.preventDefault();
        if (key === "ArrowDown") {
          if (!focusHeroPrimary() && !focusRailByCoordinates(0, railColByRowRef.current[0] ?? 0)) {
            focusHeaderByIndex(headerIndexRef.current);
          }
          return;
        }
        focusHeaderByIndex(headerIndexRef.current);
        return;
      }

      if (location.zone === "header") {
        switch (key) {
          case "ArrowLeft":
            event.preventDefault();
            focusHeaderByIndex(location.index - 1);
            return;
          case "ArrowRight":
            event.preventDefault();
            focusHeaderByIndex(location.index + 1);
            return;
          case "ArrowDown":
            event.preventDefault();
            if (!focusHeroPrimary() && !focusRailByCoordinates(0, railColByRowRef.current[0] ?? location.index)) {
              focusHeaderByIndex(location.index);
            }
            return;
          case "ArrowUp":
            event.preventDefault();
            return;
          case "Enter":
            event.preventDefault();
            getHeaderFocusableElements()[location.index]?.click();
            return;
        }
        return;
      }

      if (location.zone === "hero") {
        switch (key) {
          case "ArrowUp":
            event.preventDefault();
            focusHeaderByIndex(headerIndexRef.current);
            return;
          case "ArrowDown":
            event.preventDefault();
            focusRailByCoordinates(0, railColByRowRef.current[0] ?? desiredRailColRef.current);
            return;
          case "ArrowLeft":
          case "ArrowRight":
            event.preventDefault();
            return;
          case "Enter":
            event.preventDefault();
            getHeroFocusableElement()?.click();
            return;
        }
        return;
      }

      switch (key) {
        case "ArrowLeft":
          event.preventDefault();
          focusRailByCoordinates(location.rowIndex, location.columnIndex - 1);
          return;
        case "ArrowRight":
          event.preventDefault();
          focusRailByCoordinates(location.rowIndex, location.columnIndex + 1);
          return;
        case "ArrowUp":
          event.preventDefault();
          if (location.rowIndex === 0) {
            if (!focusHeroPrimary()) {
              focusHeaderByIndex(headerIndexRef.current);
            }
          } else {
            focusRailByCoordinates(location.rowIndex - 1, desiredRailColRef.current);
          }
          return;
        case "ArrowDown":
          event.preventDefault();
          focusRailByCoordinates(location.rowIndex + 1, desiredRailColRef.current);
          return;
        case "Enter":
          event.preventDefault();
          getRailRows()[location.rowIndex]?.[location.columnIndex]?.click();
          return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeSuggestionIndex,
    applyFilterFocusByIndex,
    closeFilterPanel,
    closeSearchOverlay,
    focusHeaderByIndex,
    focusHeroPrimary,
    focusRailByCoordinates,
    getCurrentHomeLocation,
    getFilterFocusableElements,
    getHeaderFocusableElements,
    getHeroFocusableElement,
    getRailRows,
    isFilterOpen,
    isSearchFocused,
    isSideNavOpen,
    searchInput,
    searchSuggestions,
    showSearchPanel
  ]);

  return (
    <main
      className="home-shell"
      ref={homeRootRef}
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.classList.contains("home-filter-focusable")) {
          const items = getFilterFocusableElements();
          const index = items.indexOf(target);
          if (index >= 0) {
            filterFocusedIndexRef.current = index;
            clearFilterFocus(items);
            target.classList.add("tv-focused");
            target.tabIndex = 0;
          }
          return;
        }
        if (
          !target.classList.contains("home-header-focusable") &&
          !target.classList.contains("home-hero-focusable") &&
          !target.classList.contains("home-rail-focusable")
        ) {
          return;
        }
        clearHomeFocus();
        target.classList.add("tv-focused");
        target.tabIndex = 0;
        markHomeLocation(target);
        homeNavActivatedRef.current = true;
      }}
    >
      <header className={`home-header ${isHeaderScrolled ? "is-scrolled" : ""}`}>
        <div className="home-header-inner">
          <div className="home-header-left">
            <div className="brand-logo" aria-label="streams" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
              streams
            </div>
          </div>

          <div className="home-header-right">
            <div className={`search-container ${isSearchFocused || searchInput ? "is-expanded" : ""}`} ref={searchBoxRef}>
              <form className="header-search-v2" onSubmit={handleSearchSubmit}>
                <button
                  type="button"
                  ref={searchButtonRef}
                  className="search-icon-btn home-header-focusable"
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

            <button
              type="button"
              className="header-action-btn home-header-focusable"
              onClick={(event) => {
                lastFocusedBeforeFilterRef.current = event.currentTarget;
                setIsFilterOpen(true);
              }}
              title="Filtros"
            >
              <SlidersHorizontal size={20} />
            </button>
            <button
              type="button"
              className="header-action-btn home-header-focusable"
              onClick={handleReloadSources}
              title="Recargar fuentes"
            >
              <RefreshCw size={20} className={loading ? "spin" : ""} />
            </button>
            <UserSummary />
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
        <div className="hero-media-overlay" aria-hidden="true" />
        <div className="hero-overlay">
          <div className="hero-content-wrap">
            <span className="hero-kicker">{categoryTitle(activeHomeCategory)}</span>
            <h1 title={heroItem?.name || "Explora el catalogo"}>{heroTitle}</h1>

            <div className="hero-meta">
              <span className="hero-rating">
                {heroItem?.rating ? `${(heroItem.rating * 10).toFixed(0)}% para ti` : "Novedad"}
              </span>
              <span className="hero-year">{heroItem?.year || "s/a"}</span>
            </div>

            <p>{heroItem?.description || "Peliculas, series y TV en vivo en una interfaz simple."}</p>

            <div className="hero-actions">
              {heroItem ? (
                <button type="button" className="primary-btn home-hero-focusable" onClick={() => handleSelectItem(heroItem)}>
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
          <div className="continue-watching-rail">
            <ContinueWatchingRail items={continueWatching} onSelect={handleSelectContinueWatching} />
          </div>
        ) : null}

        {activeRows.map((row) => (
          <div key={row.id} data-row-id={row.id}>
            <CategoryRail
              title={row.title}
              items={rowData[row.id] || []}
              onSelect={handleSelectItem}
              browseUrl={`/category/${activeHomeCategory}?row=${row.id}`}
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
          <Film size={15} />
          <span>Pelis</span>
        </button>
        <button
          type="button"
          className={`mobile-dock-item ${state.category === "series" ? "is-active" : ""}`}
          onClick={() => actions.setCategory("series")}
        >
          <Clapperboard size={15} />
          <span>Series</span>
        </button>
        <button
          type="button"
          className="mobile-dock-item"
          onClick={handleOpenSearchPage}
        >
          <Search size={15} />
          <span>Buscar</span>
        </button>
        <Link to="/live-tv" className="mobile-dock-item">
          <Radio size={15} />
          <span>En vivo</span>
        </Link>
        <Link to="/favorites" className="mobile-dock-item">
          <Heart size={15} />
          <span>Favs</span>
        </Link>
      </nav>
      {isFilterOpen ? <div className="offcanvas-backdrop" onClick={closeFilterPanel} /> : null}
      <aside ref={filterPanelRef} className={`genre-offcanvas ${isFilterOpen ? "is-open" : ""}`} aria-hidden={!isFilterOpen}>
        <div className="genre-offcanvas-header">
          <h3>Generos de {categoryTitle(activeHomeCategory)}</h3>
          <button type="button" className="icon-only-btn home-filter-focusable" onClick={closeFilterPanel}>
            <X size={16} />
          </button>
        </div>

        <p className="muted">Toca un genero para explorar todos sus titulos.</p>
        <div className="genre-grid">
          <button
            type="button"
            className="genre-chip home-filter-focusable"
            onClick={() => handleScrollToRow("")}
          >
            Explorar todo
          </button>
          {activeRows.map((row) => (
            <button
              key={row.id}
              type="button"
              className="genre-chip home-filter-focusable"
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


