import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchCatalogByCategory } from "../api";
import { CategoryRail } from "../components/CategoryRail";
import { MediaCard } from "../components/MediaCard";
import { categoryTitle } from "../components/CategoryTabs";
import { HOME_CATEGORY_ROWS, buildYearOptions } from "../lib/home-categories";
import { PLATFORM_PROVIDERS, resolvePlatformProviderName } from "../lib/platform-providers";
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
  const providerRowsRequestIdRef = useRef(0);
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

    for (const provider of PLATFORM_PROVIDERS) {
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
  const shouldRenderProviderGroups = !isProviderHomeMode && groupedByProvider.length > 1;
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

  return (
    <main className="category-page-shell">
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

        {!selectedProvider ? (
          <label className="category-year-filter" htmlFor="category-provider-filter">
            <span>Plataforma</span>
            <select
              id="category-provider-filter"
              value={selectedProvider}
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
          </label>
        ) : null}

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
          <button type="button" className="secondary-btn category-load-more" onClick={() => void loadNextPage()}>
            Cargar mas
          </button>
        ) : null}
      </section>
    </main>
  );
}
