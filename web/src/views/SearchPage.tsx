import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fetchCatalogByCategory } from "../api";
import { categoryTitle } from "../components/CategoryTabs";
import { MediaCard } from "../components/MediaCard";
import { useAppStore } from "../store/AppStore";
import type { CatalogItem, Category } from "../types";

const CATEGORIES: Category[] = ["movie", "series"];

export function SearchPage() {
  const navigate = useNavigate();
  const { actions } = useAppStore();
  const requestIdRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const query = String(searchParams.get("q") || "").trim();

  const [searchInput, setSearchInput] = useState(query);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resultsByCategory, setResultsByCategory] = useState<Record<Category, CatalogItem[]>>({
    movie: [],
    series: [],
    tv: []
  });

  useEffect(() => {
    setSearchInput(query);
    actions.setQuery(query);
  }, [actions, query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      requestIdRef.current += 1;
      setLoading(false);
      setError("");
      setResultsByCategory({ movie: [], series: [], tv: [] });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");

    (async () => {
      try {
        const payloads = await Promise.all(
          CATEGORIES.map((category) =>
            fetchCatalogByCategory({
              category,
              query: trimmed,
              limit: 72
            })
          )
        );

        if (requestId !== requestIdRef.current) return;
        const next: Record<Category, CatalogItem[]> = { movie: [], series: [], tv: [] };
        for (const payload of payloads) {
          next[payload.category] = payload.items;
        }
        setResultsByCategory(next);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setResultsByCategory({ movie: [], series: [], tv: [] });
        setError("No pudimos cargar resultados ahora. Proba de nuevo.");
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
  }, [query]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = searchInput.trim();
    if (!trimmed) {
      setSearchParams({});
      return;
    }
    setSearchParams({ q: trimmed });
  }

  function handleSelectItem(item: CatalogItem) {
    actions.setSelectedItem(item);
    actions.setCategory(item.type);
    navigate(`/watch/${item.type}/${encodeURIComponent(item.id)}`);
  }

  const total = useMemo(
    () => CATEGORIES.reduce((sum, category) => sum + resultsByCategory[category].length, 0),
    [resultsByCategory]
  );

  return (
    <main className="search-page-shell">
      <header className="search-page-header">
        <Link to="/" className="back-link-icon" aria-label="Volver al inicio">
          <ArrowLeft size={22} />
        </Link>
        <form className="search-page-form" onSubmit={handleSearchSubmit}>
          <Search size={18} />
          <input
            ref={searchInputRef}
            type="search"
            value={searchInput}
            placeholder="Busca peliculas o series..."
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <button type="submit" className="primary-btn search-submit-btn">
            Buscar
          </button>
        </form>
      </header>

      <section className="search-page-content">
        {query.length < 2 ? <p className="search-page-empty">Escribi al menos 2 letras para buscar.</p> : null}
        {loading ? <p className="search-page-empty">Buscando resultados para "{query}"...</p> : null}
        {error ? <p className="watch-error">{error}</p> : null}

        {!loading && query.length >= 2 ? (
          <div className="search-summary">
            <h1>Resultados para "{query}"</h1>
            <span>{total} opciones</span>
          </div>
        ) : null}

        {!loading && !error && query.length >= 2 && total === 0 ? (
          <p className="search-page-empty">No encontramos coincidencias. Proba con otro termino.</p>
        ) : null}

        {!loading && !error && total > 0
          ? CATEGORIES.map((category) => {
              const items = resultsByCategory[category];
              if (!items.length) return null;
              return (
                <section key={category} className="search-section">
                  <div className="search-section-head">
                    <h2>{categoryTitle(category)}</h2>
                    <span>{items.length}</span>
                  </div>
                  <div className="search-results-grid">
                    {items.map((item) => (
                      <MediaCard key={`${item.type}:${item.id}`} item={item} onSelect={handleSelectItem} />
                    ))}
                  </div>
                </section>
              );
            })
          : null}
      </section>
    </main>
  );
}
