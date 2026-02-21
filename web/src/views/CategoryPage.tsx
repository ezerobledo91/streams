import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchCatalogByCategory } from "../api";
import { CategoryRail } from "../components/CategoryRail";
import { MediaCard } from "../components/MediaCard";
import { categoryTitle } from "../components/CategoryTabs";
import { useGamepad } from "../hooks/useGamepad";
import { HOME_CATEGORY_ROWS, buildYearOptions } from "../lib/home-categories";
import { PLATFORM_PROVIDER_CATALOG, resolvePlatformProviderName } from "../lib/platform-providers";
import { useAppStore } from "../store/AppStore";
import { useAppShell } from "../context/AppShellContext";
import type { CatalogItem, Category } from "../types";

type Direction = "up" | "down" | "left" | "right";

function itemKey(item: CatalogItem): string {
  return `${item.type}:${item.id}`;
}

function normalizeCategory(input: string | undefined): Category {
  return input === "series" ? "series" : "movie";
}

function isVisibleElement(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

function elementCenterX(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  return rect.left + rect.width / 2;
}

function findClosestIndexByX(elements: HTMLElement[], x: number): number {
  if (!elements.length) return -1;
  let bestIndex = 0;
  let bestDistance = Math.abs(elementCenterX(elements[0]) - x);
  for (let index = 1; index < elements.length; index += 1) {
    const distance = Math.abs(elementCenterX(elements[index]) - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
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

export function CategoryPage() {
  const navigate = useNavigate();
  const { actions } = useAppStore();
  const { isSideNavOpen } = useAppShell();
  const { category: categoryParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const pageRootRef = useRef<HTMLElement | null>(null);
  const requestIdRef = useRef(0);
  const providerRowsRequestIdRef = useRef(0);
  const nextPageRef = useRef(1);
  const fetchingRef = useRef(false);
  const itemKeysRef = useRef<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const focusedElementRef = useRef<HTMLElement | null>(null);
  const navActivatedRef = useRef(false);
  const controlIndexRef = useRef(0);
  const railRowIndexRef = useRef(0);
  const railColByRowRef = useRef<Record<number, number>>({});
  const desiredRailColRef = useRef(0);
  const gridIndexRef = useRef(0);
  const selectMenuRef = useRef<HTMLDivElement | null>(null);

  const category = normalizeCategory(categoryParam);
  const rows = HOME_CATEGORY_ROWS[category];
  const yearOptions = useMemo(() => buildYearOptions(1980), []);

  const rowParam = String(searchParams.get("row") || "");
  const genreParam = String(searchParams.get("genre") || "").trim();
  const yearParam = String(searchParams.get("year") || "").trim();
  const providerParam = String(searchParams.get("provider") || "").trim();
  const providerNameParam = String(searchParams.get("providerName") || "").trim();

  const selectedRow = useMemo(() => rows.find((row) => row.id === rowParam) || null, [rows, rowParam]);
  const selectedGenre = selectedRow?.genre || genreParam;
  const selectedYear = /^\d{4}$/.test(yearParam) ? yearParam : "";
  const selectedProvider = /^\d+$/.test(providerParam) ? providerParam : "";
  const isProviderHomeMode = Boolean(selectedProvider) && !selectedRow;

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [providerRowData, setProviderRowData] = useState<Record<string, CatalogItem[]>>({});
  const [providerRowsLoading, setProviderRowsLoading] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const [openSelectMenu, setOpenSelectMenu] = useState<null | "provider" | "year">(null);
  const [openSelectOptionIndex, setOpenSelectOptionIndex] = useState(0);

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
          provider: selectedProvider || undefined,
          includeAvailability: true,
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
    [category, selectedGenre, selectedProvider, selectedYear]
  );

  const loadProviderRows = useCallback(async () => {
    if (!selectedProvider) {
      providerRowsRequestIdRef.current += 1;
      setProviderRowsLoading(false);
      setProviderRowData({});
      return;
    }

    const requestId = providerRowsRequestIdRef.current + 1;
    providerRowsRequestIdRef.current = requestId;
    setProviderRowsLoading(true);

    try {
      const payloads = await Promise.all(
        rows.map((row) =>
          fetchCatalogByCategory({
            category,
            genre: row.genre,
            provider: selectedProvider,
            includeAvailability: true,
            year: selectedYear || undefined,
            page: 1,
            limit: 24
          })
        )
      );

      if (requestId !== providerRowsRequestIdRef.current) return;

      const next: Record<string, CatalogItem[]> = {};
      for (let i = 0; i < rows.length; i += 1) {
        next[rows[i].id] = payloads[i].items || [];
      }
      setProviderRowData(next);
    } catch {
      if (requestId === providerRowsRequestIdRef.current) {
        setProviderRowData({});
        setError("No pudimos cargar plataformas para esta categoria.");
      }
    } finally {
      if (requestId === providerRowsRequestIdRef.current) {
        setProviderRowsLoading(false);
      }
    }
  }, [category, rows, selectedProvider, selectedYear]);

  useEffect(() => {
    requestIdRef.current += 1;
    providerRowsRequestIdRef.current += 1;
    nextPageRef.current = 1;
    itemKeysRef.current = new Set();
    setItems([]);
    setProviderRowData({});
    setHasMore(!isProviderHomeMode);
    setProviderRowsLoading(false);
    setError("");
    if (isProviderHomeMode) {
      void loadProviderRows();
      return;
    }
    void loadPage(1);
  }, [isProviderHomeMode, loadPage, loadProviderRows]);

  const loadNextPage = useCallback(async () => {
    if (isProviderHomeMode) return;
    if (!hasMore || loadingInitial || loadingMore || fetchingRef.current) return;
    await loadPage(nextPageRef.current);
  }, [hasMore, isProviderHomeMode, loadPage, loadingInitial, loadingMore]);

  useEffect(() => {
    if (isProviderHomeMode) return undefined;
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
  }, [hasMore, isProviderHomeMode, loadNextPage]);

  function updateFilters(next: { row?: string; genre?: string; provider?: string; providerName?: string; year?: string }) {
    const params = new URLSearchParams(searchParams);
    if (next.row !== undefined) {
      if (next.row) params.set("row", next.row);
      else params.delete("row");
    }
    if (next.genre !== undefined) {
      if (next.genre) params.set("genre", next.genre);
      else params.delete("genre");
    }
    if (next.provider !== undefined) {
      if (next.provider) params.set("provider", next.provider);
      else params.delete("provider");
    }
    if (next.providerName !== undefined) {
      if (next.providerName) params.set("providerName", next.providerName);
      else params.delete("providerName");
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

  const providerOptions = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; count: number }>();
    const sourceItems = isProviderHomeMode
      ? Object.values(providerRowData).flat()
      : items;

    for (const provider of PLATFORM_PROVIDER_CATALOG) {
      byId.set(provider.id, { id: provider.id, name: provider.name, count: 0 });
    }

    for (const item of sourceItems) {
      const providers = Array.isArray(item.availability?.providers) ? item.availability.providers : [];
      for (const provider of providers) {
        const id = String(provider.id || "").trim();
        if (!id) continue;
        const existing = byId.get(id);
        if (existing) {
          existing.count += 1;
          if (!existing.name || existing.name.startsWith("Proveedor ")) {
            existing.name = provider.name || existing.name;
          }
          continue;
        }
        byId.set(id, {
          id,
          name: provider.name || `Proveedor ${id}`,
          count: 1
        });
      }
    }

    if (selectedProvider && !byId.has(selectedProvider)) {
      byId.set(selectedProvider, {
        id: selectedProvider,
        name: resolvePlatformProviderName(selectedProvider, providerNameParam),
        count: 0
      });
    }

    return [...byId.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  }, [isProviderHomeMode, items, providerNameParam, providerRowData, selectedProvider]);

  const selectedProviderName = useMemo(() => {
    if (!selectedProvider) return "";
    const fromOptions = providerOptions.find((option) => option.id === selectedProvider)?.name;
    return resolvePlatformProviderName(selectedProvider, fromOptions || providerNameParam);
  }, [providerNameParam, providerOptions, selectedProvider]);

  const providerSelectOptions = useMemo(
    () => [
      { value: "", label: "Todas" },
      ...providerOptions.map((provider) => ({
        value: provider.id,
        label: provider.name
      }))
    ],
    [providerOptions]
  );

  const yearSelectOptions = useMemo(
    () => [
      { value: "", label: "Todos" },
      ...yearOptions.map((year) => ({ value: year, label: year }))
    ],
    [yearOptions]
  );

  const openMenuOptions = openSelectMenu === "provider"
    ? providerSelectOptions
    : openSelectMenu === "year"
      ? yearSelectOptions
      : [];

  useEffect(() => {
    if (openSelectMenu === "provider" && selectedProvider) {
      setOpenSelectMenu(null);
      return;
    }
    if (!openMenuOptions.length) return;
    if (openSelectOptionIndex >= openMenuOptions.length) {
      setOpenSelectOptionIndex(openMenuOptions.length - 1);
    }
  }, [openMenuOptions.length, openSelectMenu, openSelectOptionIndex, selectedProvider]);

  useEffect(() => {
    if (!openSelectMenu) return;
    const menu = selectMenuRef.current;
    if (!menu) return;
    const active = menu.querySelector<HTMLElement>(".category-select-option.is-active");
    active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [openSelectMenu, openSelectOptionIndex]);

  const groupedByProvider = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; items: CatalogItem[] }>();
    for (const item of items) {
      const providers = Array.isArray(item.availability?.providers) ? item.availability.providers : [];
      const selectedMatch = selectedProvider
        ? providers.find((provider) => String(provider.id) === selectedProvider) || null
        : null;
      const primary = selectedMatch || providers[0] || null;
      const groupId = primary ? String(primary.id) : "unknown";
      const groupName = primary?.name || "Sin plataforma";
      const existing = groups.get(groupId);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(groupId, { id: groupId, name: groupName, items: [item] });
      }
    }
    return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  }, [items, selectedProvider]);

  const groupSuffix = selectedRow?.title || selectedProviderName || "Todo";
  const shouldRenderProviderGroups = !isProviderHomeMode && Boolean(selectedProvider) && groupedByProvider.length > 1;
  const headerTitle = isProviderHomeMode
    ? `${selectedProviderName} en ${categoryTitle(category)}`
    : selectedRow?.title || `Explorar ${categoryTitle(category)}`;

  function buildProviderRowBrowseUrl(rowId: string) {
    const params = new URLSearchParams();
    if (selectedProvider) params.set("provider", selectedProvider);
    if (selectedProviderName) params.set("providerName", selectedProviderName);
    if (rowId) params.set("row", rowId);
    const row = rows.find((entry) => entry.id === rowId);
    if (row?.genre) params.set("genre", row.genre);
    if (selectedYear) params.set("year", selectedYear);
    const query = params.toString();
    return `/category/${category}${query ? `?${query}` : ""}`;
  }

  function openSelectOverlay(menu: "provider" | "year") {
    const options = menu === "provider" ? providerSelectOptions : yearSelectOptions;
    const currentValue = menu === "provider" ? selectedProvider : selectedYear;
    const currentIndex = Math.max(0, options.findIndex((option) => option.value === currentValue));
    setOpenSelectMenu(menu);
    setOpenSelectOptionIndex(currentIndex);
  }

  function applySelectOverlayValue(menu: "provider" | "year", value: string) {
    if (menu === "provider") {
      const nextName = resolvePlatformProviderName(value, "");
      updateFilters({
        row: "",
        genre: "",
        provider: value,
        providerName: value ? nextName : ""
      });
      return;
    }
    updateFilters({ year: value });
  }

  const getControlFocusableElements = useCallback(() => {
    const root = pageRootRef.current;
    if (!root) return [] as HTMLElement[];
    const elements = Array.from(root.querySelectorAll<HTMLElement>(".category-control-focusable"))
      .filter(isVisibleElement);
    for (const element of elements) {
      element.tabIndex = -1;
    }
    return elements;
  }, []);

  const getProviderRailRows = useCallback(() => {
    const root = pageRootRef.current;
    if (!root) return [] as HTMLElement[][];

    const rails = Array.from(root.querySelectorAll<HTMLElement>(".category-provider-home-rails .category-rail"));
    return rails
      .map((rail) => {
        const cards = Array.from(rail.querySelectorAll<HTMLElement>(".carousel-track > .media-tile"))
          .filter(isVisibleElement);
        const browse = rail.querySelector<HTMLElement>(".rail-browse-link");
        const row = browse && isVisibleElement(browse) ? [...cards, browse] : cards;
        for (const element of row) {
          element.classList.add("category-rail-focusable");
          element.tabIndex = -1;
        }
        return row;
      })
      .filter((row) => row.length > 0);
  }, []);

  const getGridFocusableElements = useCallback(() => {
    const root = pageRootRef.current;
    if (!root) return [] as HTMLElement[];
    const elements = Array.from(
      root.querySelectorAll<HTMLElement>(
        ".category-page-content .category-results-grid .media-tile, .category-page-content .category-grid-focusable"
      )
    ).filter(isVisibleElement);
    for (const element of elements) {
      element.classList.add("category-grid-focusable");
      element.tabIndex = -1;
    }
    return elements;
  }, []);

  const clearCategoryFocus = useCallback(() => {
    const root = pageRootRef.current;
    if (!root) return;
    for (const element of root.querySelectorAll<HTMLElement>(
      ".category-control-focusable, .category-rail-focusable, .category-grid-focusable"
    )) {
      element.classList.remove("tv-focused");
      element.tabIndex = -1;
    }
  }, []);

  const markCategoryLocation = useCallback(
    (element: HTMLElement) => {
      const controls = getControlFocusableElements();
      const controlIndex = controls.indexOf(element);
      if (controlIndex >= 0) {
        controlIndexRef.current = controlIndex;
        focusedElementRef.current = element;
        return { zone: "controls" as const, index: controlIndex };
      }

      if (isProviderHomeMode) {
        const railRows = getProviderRailRows();
        for (let rowIndex = 0; rowIndex < railRows.length; rowIndex += 1) {
          const colIndex = railRows[rowIndex].indexOf(element);
          if (colIndex >= 0) {
            railRowIndexRef.current = rowIndex;
            railColByRowRef.current[rowIndex] = colIndex;
            desiredRailColRef.current = colIndex;
            focusedElementRef.current = element;
            return { zone: "providerRails" as const, rowIndex, columnIndex: colIndex };
          }
        }
      } else {
        const gridItems = getGridFocusableElements();
        const gridIndex = gridItems.indexOf(element);
        if (gridIndex >= 0) {
          gridIndexRef.current = gridIndex;
          focusedElementRef.current = element;
          return { zone: "grid" as const, index: gridIndex };
        }
      }

      focusedElementRef.current = null;
      return null;
    },
    [getControlFocusableElements, getGridFocusableElements, getProviderRailRows, isProviderHomeMode]
  );

  const applyCategoryFocus = useCallback(
    (element: HTMLElement | null) => {
      if (!element || !element.isConnected) return false;
      clearCategoryFocus();
      element.classList.add("tv-focused");
      element.tabIndex = 0;
      element.focus({ preventScroll: false });
      const isControl = element.classList.contains("category-control-focusable");
      element.scrollIntoView({
        block: isControl ? "start" : "nearest",
        inline: "nearest",
        behavior: "smooth"
      });
      markCategoryLocation(element);
      navActivatedRef.current = true;
      return true;
    },
    [clearCategoryFocus, markCategoryLocation]
  );

  const focusControlByIndex = useCallback(
    (nextIndex: number) => {
      const controls = getControlFocusableElements();
      if (!controls.length) return false;
      const bounded = Math.max(0, Math.min(controls.length - 1, nextIndex));
      return applyCategoryFocus(controls[bounded]);
    },
    [applyCategoryFocus, getControlFocusableElements]
  );

  const focusClosestControlToElement = useCallback(
    (sourceElement: HTMLElement | null) => {
      const controls = getControlFocusableElements();
      if (!controls.length) return false;
      if (!sourceElement) return focusControlByIndex(controlIndexRef.current);
      const sourceX = elementCenterX(sourceElement);
      const nextIndex = findClosestIndexByX(controls, sourceX);
      if (nextIndex < 0) return false;
      return focusControlByIndex(nextIndex);
    },
    [focusControlByIndex, getControlFocusableElements]
  );

  const focusProviderRailByCoordinates = useCallback(
    (rowIndex: number, columnIndex: number) => {
      const rowsList = getProviderRailRows();
      if (!rowsList.length) return false;
      const boundedRow = Math.max(0, Math.min(rowsList.length - 1, rowIndex));
      const row = rowsList[boundedRow];
      if (!row?.length) return false;
      desiredRailColRef.current = Math.max(0, columnIndex);
      const boundedColumn = Math.max(0, Math.min(row.length - 1, desiredRailColRef.current));
      railRowIndexRef.current = boundedRow;
      railColByRowRef.current[boundedRow] = boundedColumn;
      return applyCategoryFocus(row[boundedColumn]);
    },
    [applyCategoryFocus, getProviderRailRows]
  );

  const focusGridByIndex = useCallback(
    (nextIndex: number) => {
      const grid = getGridFocusableElements();
      if (!grid.length) return false;
      const bounded = Math.max(0, Math.min(grid.length - 1, nextIndex));
      gridIndexRef.current = bounded;
      return applyCategoryFocus(grid[bounded]);
    },
    [applyCategoryFocus, getGridFocusableElements]
  );

  const getCurrentLocation = useCallback(() => {
    const current = focusedElementRef.current;
    if (current && current.isConnected) {
      const location = markCategoryLocation(current);
      if (location) return location;
    }

    const active = document.activeElement;
    if (active && active instanceof HTMLElement && pageRootRef.current?.contains(active)) {
      const location = markCategoryLocation(active);
      if (location) return location;
    }

    return null;
  }, [markCategoryLocation]);

  useGamepad(true);

  useEffect(() => {
    if (!navActivatedRef.current || isSideNavOpen) return;

    const location = getCurrentLocation();
    if (!location) {
      focusControlByIndex(controlIndexRef.current);
      return;
    }

    if (location.zone === "controls") {
      focusControlByIndex(location.index);
      return;
    }

    if (location.zone === "providerRails") {
      if (isProviderHomeMode) {
        focusProviderRailByCoordinates(location.rowIndex, location.columnIndex);
      } else {
        focusControlByIndex(controlIndexRef.current);
      }
      return;
    }

    if (!isProviderHomeMode) {
      focusGridByIndex(location.index);
      return;
    }

    focusControlByIndex(controlIndexRef.current);
  }, [
    focusControlByIndex,
    focusGridByIndex,
    focusProviderRailByCoordinates,
    getCurrentLocation,
    hasMore,
    isProviderHomeMode,
    isSideNavOpen,
    items,
    loadingInitial,
    loadingMore,
    providerRowData,
    providerRowsLoading,
    searchParams,
    shouldRenderProviderGroups
  ]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isSideNavOpen) return;
      const key = event.key;
      const isBackKey = key === "Escape" || key === "Backspace" || key === "BrowserBack" || key === "GoBack";
      if (isBackKey && openSelectMenu) {
        event.preventDefault();
        setOpenSelectMenu(null);
        return;
      }
      if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Enter") {
        return;
      }
      const targetTag = (event.target as HTMLElement | null)?.tagName;
      if (targetTag === "INPUT" || targetTag === "TEXTAREA" || (event.target as HTMLElement | null)?.isContentEditable) {
        return;
      }

      const location = getCurrentLocation();
      if (!location) {
        event.preventDefault();
        if (key === "ArrowDown") {
          if (isProviderHomeMode) {
            if (!focusProviderRailByCoordinates(0, railColByRowRef.current[0] ?? 0)) {
              focusControlByIndex(controlIndexRef.current);
            }
          } else if (!focusGridByIndex(gridIndexRef.current)) {
            focusControlByIndex(controlIndexRef.current);
          }
          return;
        }
        focusControlByIndex(controlIndexRef.current);
        return;
      }

      if (location.zone === "controls") {
        const controls = getControlFocusableElements();
        const controlElement = controls[location.index];
        const selectMenuKey =
          controlElement?.id === "category-provider-filter"
            ? "provider"
            : controlElement?.id === "category-year-filter"
              ? "year"
              : null;
        const isSelect = Boolean(selectMenuKey);
        const isSelectMenuOpen = Boolean(selectMenuKey && openSelectMenu === selectMenuKey);
        const direction = key.replace("Arrow", "").toLowerCase() as Direction;

        if (key === "Enter") {
          if (selectMenuKey) {
            event.preventDefault();
            if (!isSelectMenuOpen) {
              openSelectOverlay(selectMenuKey);
              return;
            }
            const selectedOption = openMenuOptions[openSelectOptionIndex];
            if (selectedOption) {
              applySelectOverlayValue(selectMenuKey, selectedOption.value);
            }
            setOpenSelectMenu(null);
            return;
          }
          setOpenSelectMenu(null);
          event.preventDefault();
          controls[location.index]?.click();
          return;
        }

        if (isSelectMenuOpen && (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight")) {
          event.preventDefault();
          const delta = key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1;
          const next = Math.max(0, Math.min(openMenuOptions.length - 1, openSelectOptionIndex + delta));
          setOpenSelectOptionIndex(next);
          return;
        }

        if (isSelectMenuOpen) {
          event.preventDefault();
          return;
        }

        if (isSelect && (key === "ArrowUp" || key === "ArrowDown")) {
          event.preventDefault();
          const nextIndex = findDirectionalIndex(controls, location.index, direction);
          if (nextIndex >= 0) {
            focusControlByIndex(nextIndex);
            return;
          }
          if (key === "ArrowDown") {
            if (isProviderHomeMode) {
              focusProviderRailByCoordinates(0, railColByRowRef.current[0] ?? location.index);
            } else {
              focusGridByIndex(gridIndexRef.current);
            }
          }
          return;
        }

        event.preventDefault();
        const nextIndex = findDirectionalIndex(controls, location.index, direction);
        if (nextIndex >= 0) {
          focusControlByIndex(nextIndex);
          return;
        }

        if (key === "ArrowDown") {
          if (isProviderHomeMode) {
            focusProviderRailByCoordinates(0, railColByRowRef.current[0] ?? location.index);
          } else {
            focusGridByIndex(gridIndexRef.current);
          }
        }
        return;
      }

      if (location.zone === "providerRails") {
        setOpenSelectMenu(null);
        const rowsList = getProviderRailRows();
        const current = rowsList[location.rowIndex]?.[location.columnIndex] || null;

        switch (key) {
          case "ArrowLeft":
            event.preventDefault();
            focusProviderRailByCoordinates(location.rowIndex, location.columnIndex - 1);
            return;
          case "ArrowRight":
            event.preventDefault();
            focusProviderRailByCoordinates(location.rowIndex, location.columnIndex + 1);
            return;
          case "ArrowUp":
            event.preventDefault();
            if (location.rowIndex === 0) {
              focusClosestControlToElement(current);
            } else {
              focusProviderRailByCoordinates(location.rowIndex - 1, desiredRailColRef.current);
            }
            return;
          case "ArrowDown":
            event.preventDefault();
            focusProviderRailByCoordinates(location.rowIndex + 1, desiredRailColRef.current);
            return;
          case "Enter":
            event.preventDefault();
            rowsList[location.rowIndex]?.[location.columnIndex]?.click();
            return;
        }
        return;
      }

      const grid = getGridFocusableElements();
      setOpenSelectMenu(null);
      const current = grid[location.index] || null;
      if (key === "Enter") {
        event.preventDefault();
        current?.click();
        return;
      }

      event.preventDefault();
      const direction = key.replace("Arrow", "").toLowerCase() as Direction;
      const nextIndex = findDirectionalIndex(grid, location.index, direction);
      if (nextIndex >= 0) {
        focusGridByIndex(nextIndex);
        return;
      }

      if (key === "ArrowUp") {
        focusClosestControlToElement(current);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    applySelectOverlayValue,
    focusClosestControlToElement,
    focusControlByIndex,
    focusGridByIndex,
    focusProviderRailByCoordinates,
    getControlFocusableElements,
    getCurrentLocation,
    getGridFocusableElements,
    getProviderRailRows,
    isProviderHomeMode,
    isSideNavOpen,
    openMenuOptions,
    openSelectMenu,
    openSelectOptionIndex,
    openSelectOverlay
  ]);

  useEffect(() => {
    if (!openSelectMenu) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".category-year-filter")) return;
      setOpenSelectMenu(null);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [openSelectMenu]);

  useEffect(() => {
    return () => {
      clearCategoryFocus();
      focusedElementRef.current = null;
      setOpenSelectMenu(null);
    };
  }, [clearCategoryFocus]);

  return (
    <main
      className="category-page-shell"
      ref={pageRootRef}
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        const inControls = target.classList.contains("category-control-focusable");
        const inProviderRails = target.classList.contains("media-tile") && Boolean(target.closest(".category-provider-home-rails"));
        const inGrid = target.classList.contains("media-tile") && Boolean(target.closest(".category-results-grid"));
        const isKnownFocusable =
          inControls ||
          target.classList.contains("category-rail-focusable") ||
          target.classList.contains("category-grid-focusable") ||
          inProviderRails ||
          inGrid;
        if (!isKnownFocusable) return;

        if (inProviderRails) target.classList.add("category-rail-focusable");
        if (inGrid) target.classList.add("category-grid-focusable");

        if (!(target instanceof HTMLSelectElement)) {
          setOpenSelectMenu(null);
        }

        clearCategoryFocus();
        target.classList.add("tv-focused");
        target.tabIndex = 0;
        markCategoryLocation(target);
        navActivatedRef.current = true;
      }}
    >
      <header className="category-page-header">
        <div className="category-page-headline">
          <h1>{headerTitle}</h1>
          <p>
            {categoryTitle(category)}
            {selectedProviderName ? ` | ${selectedProviderName}` : ""}
            {selectedYear ? ` | ${selectedYear}` : ""}
          </p>
        </div>
      </header>

      <section className="category-page-filters">
        <div className="chip-row category-chip-row">
          <button
            type="button"
            className={`category-control-focusable ${!selectedRow && !selectedGenre ? "is-active" : ""}`.trim()}
            onClick={() => updateFilters({ row: "", genre: "" })}
          >
            Todo
          </button>
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className={`category-control-focusable ${selectedRow?.id === row.id ? "is-active" : ""}`.trim()}
              onClick={() => updateFilters({ row: row.id, genre: row.genre || "" })}
            >
              {row.title}
            </button>
          ))}
        </div>

        {!selectedProvider ? (
          <label className="category-year-filter" htmlFor="category-provider-filter">
            <span>Plataforma</span>
            <select
              id="category-provider-filter"
              className="category-control-focusable"
              value={selectedProvider}
              onFocus={() => setOpenSelectMenu(null)}
              onChange={(event) => {
                const nextProvider = event.target.value;
                const nextName = resolvePlatformProviderName(nextProvider, "");
                updateFilters({
                  row: "",
                  genre: "",
                  provider: nextProvider,
                  providerName: nextProvider ? nextName : ""
                });
              }}
            >
              <option value="">Todas</option>
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} ({provider.count})
                </option>
              ))}
            </select>
            {openSelectMenu === "provider" ? (
              <div ref={selectMenuRef} className="category-select-menu" role="listbox" aria-label="Seleccionar plataforma">
                {providerSelectOptions.map((option, index) => (
                  <button
                    key={`provider-${option.value || "all"}`}
                    type="button"
                    className={`category-select-option ${index === openSelectOptionIndex ? "is-active" : ""}`}
                    onMouseEnter={() => setOpenSelectOptionIndex(index)}
                    onClick={() => {
                      applySelectOverlayValue("provider", option.value);
                      setOpenSelectMenu(null);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </label>
        ) : null}

        <label className="category-year-filter" htmlFor="category-year-filter">
          <span>Ano</span>
          <select
            id="category-year-filter"
            className="category-control-focusable"
            value={selectedYear}
            onFocus={() => setOpenSelectMenu(null)}
            onChange={(event) => updateFilters({ year: event.target.value })}
          >
            <option value="">Todos</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          {openSelectMenu === "year" ? (
            <div ref={selectMenuRef} className="category-select-menu" role="listbox" aria-label="Seleccionar ano">
              {yearSelectOptions.map((option, index) => (
                <button
                  key={`year-${option.value || "all"}`}
                  type="button"
                  className={`category-select-option ${index === openSelectOptionIndex ? "is-active" : ""}`}
                  onMouseEnter={() => setOpenSelectOptionIndex(index)}
                  onClick={() => {
                    applySelectOverlayValue("year", option.value);
                    setOpenSelectMenu(null);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </label>
      </section>

      <section className="category-page-content">
        {isProviderHomeMode && providerRowsLoading ? (
          <p className="search-page-empty">Cargando plataforma...</p>
        ) : null}
        {!isProviderHomeMode && loadingInitial ? (
          <p className="search-page-empty">Cargando catalogo...</p>
        ) : null}
        {error ? <p className="watch-error">{error}</p> : null}
        {!isProviderHomeMode && !loadingInitial && !error && !items.length ? (
          <p className="search-page-empty">No hay resultados con esos filtros.</p>
        ) : null}
        {isProviderHomeMode && !providerRowsLoading && !error && !Object.values(providerRowData).some((row) => row.length > 0) ? (
          <p className="search-page-empty">No hay resultados para esta plataforma.</p>
        ) : null}

        {isProviderHomeMode && !providerRowsLoading ? (
          <div className="category-provider-home-rails">
            {rows.map((row) => (
              <CategoryRail
                key={row.id}
                title={row.title}
                items={providerRowData[row.id] || []}
                onSelect={handleSelectItem}
                browseUrl={buildProviderRowBrowseUrl(row.id)}
              />
            ))}
          </div>
        ) : null}

        {!isProviderHomeMode && items.length && shouldRenderProviderGroups ? (
          <div className="category-provider-groups">
            {groupedByProvider.map((group) => (
              <section key={group.id} className="category-provider-section">
                <div className="category-provider-head">
                  <h2>{group.name} -&gt; {groupSuffix}</h2>
                  <span>{group.items.length} titulos</span>
                </div>
                <div className="search-results-grid category-results-grid">
                  {group.items.map((item) => (
                    <MediaCard key={itemKey(item)} item={item} onSelect={handleSelectItem} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {!isProviderHomeMode && items.length && !shouldRenderProviderGroups ? (
          <div className="search-results-grid category-results-grid">
            {items.map((item) => (
              <MediaCard key={itemKey(item)} item={item} onSelect={handleSelectItem} />
            ))}
          </div>
        ) : null}

        {!isProviderHomeMode ? <div ref={sentinelRef} className="category-scroll-sentinel" aria-hidden="true" /> : null}
        {!isProviderHomeMode && loadingMore ? (
          <p className="category-loading-more">
            <LoaderCircle size={14} className="spin" /> Cargando mas...
          </p>
        ) : null}
        {!isProviderHomeMode && !loadingInitial && hasMore && !loadingMore ? (
          <button
            type="button"
            className="secondary-btn category-load-more category-grid-focusable"
            onClick={() => void loadNextPage()}
          >
            Cargar mas
          </button>
        ) : null}
      </section>
    </main>
  );
}
