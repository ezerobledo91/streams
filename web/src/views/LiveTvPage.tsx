import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { LoaderCircle, RefreshCw, Search, Tv2 } from "lucide-react";
import { fetchLiveTvCategories, fetchLiveTvChannels, reloadLiveTvChannels } from "../api";
import type { LiveTvCategoryItem, LiveTvChannelItem } from "../types";

export function LiveTvPage() {
  const [categories, setCategories] = useState<LiveTvCategoryItem[]>([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [channels, setChannels] = useState<LiveTvChannelItem[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      const payload = await fetchLiveTvCategories();
      setCategories(payload.categories || []);
    } catch {
      setCategories([]);
    }
  }, []);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchLiveTvChannels({
        category: activeCategory === "all" ? "" : activeCategory,
        query: searchQuery,
        webOnly: true,
        limit: 220
      });
      setChannels(payload.items || []);
      if (payload.items?.length) {
        const hasSelected = payload.items.some((item) => item.id === selectedChannelId);
        if (!hasSelected) {
          setSelectedChannelId(payload.items[0].id);
        }
      } else {
        setSelectedChannelId("");
      }
    } catch (apiError) {
      setChannels([]);
      setSelectedChannelId("");
      setError(apiError instanceof Error ? apiError.message : "No se pudieron cargar canales.");
    } finally {
      setLoading(false);
    }
  }, [activeCategory, searchQuery, selectedChannelId]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  const selectedChannel = useMemo(
    () => channels.find((item) => item.id === selectedChannelId) || null,
    [channels, selectedChannelId]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedChannel) return;
    video.src = `/api/live-tv/channels/${encodeURIComponent(selectedChannel.id)}/stream`;
    video.load();
    video.play().catch(() => {
      // autoplay can be blocked by browser policy
    });
  }, [selectedChannel]);

  async function handleReload() {
    setReloading(true);
    setError(null);
    try {
      await reloadLiveTvChannels();
      await loadCategories();
      await loadChannels();
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "No se pudieron recargar listas.");
    } finally {
      setReloading(false);
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchQuery(searchInput.trim());
  }

  return (
    <main className="home-shell">
      <header className="home-header is-scrolled">
        <div className="home-header-inner">
          <div className="home-header-left">
            <Link to="/" className="brand-logo" style={{ textDecoration: "none" }}>
              streams
            </Link>
            <nav className="home-nav">
              <Link to="/" className="nav-link">Inicio</Link>
              <Link to="/live-tv" className="nav-link is-active">TV en vivo</Link>
            </nav>
          </div>
          <div className="home-header-right">
            <button type="button" className="header-action-btn" onClick={() => void handleReload()} disabled={reloading} title="Recargar listas">
              <RefreshCw size={20} className={reloading ? "spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <div style={{ height: "80px" }} />

      <form className="header-search-v2 live-tv-search" onSubmit={handleSearchSubmit} style={{ margin: "0 4% 20px", width: "auto", maxWidth: "600px", opacity: 1 }}>
        <button type="submit" className="search-icon-btn">
          <Search size={20} />
        </button>
        <input
          type="search"
          placeholder="Buscar canal..."
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          style={{ width: "100%", opacity: 1, padding: "8px" }}
        />
      </form>

      <section className="live-tv-layout">
        <aside className="live-tv-sidebar">
          <div className="live-tv-categories">
            <button
              type="button"
              className={`live-tv-category ${activeCategory === "all" ? "is-active" : ""}`}
              onClick={() => setActiveCategory("all")}
            >
              Todos
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`live-tv-category ${activeCategory === category.id ? "is-active" : ""}`}
                onClick={() => setActiveCategory(category.id)}
              >
                <span>{category.name}</span>
                <small>{category.count}</small>
              </button>
            ))}
          </div>

          <div className="live-tv-channel-list">
            {loading ? (
              <p className="muted">Cargando canales...</p>
            ) : channels.length ? (
              channels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  className={`live-tv-channel ${channel.id === selectedChannelId ? "is-active" : ""}`}
                  onClick={() => setSelectedChannelId(channel.id)}
                >
                  <div className="live-tv-channel-logo">
                    {channel.logo ? <img src={channel.logo} alt={channel.name} loading="lazy" /> : <Tv2 size={16} />}
                  </div>
                  <div className="live-tv-channel-meta">
                    <strong>{channel.name}</strong>
                    <span>{channel.category.name}</span>
                  </div>
                </button>
              ))
            ) : (
              <p className="muted">No hay canales para el filtro actual.</p>
            )}
          </div>
        </aside>

        <section className="live-tv-player-panel">
          <div className="live-tv-player-stage">
            {selectedChannel ? (
              <video ref={videoRef} controls autoPlay playsInline className="video-player" />
            ) : (
              <div className="live-tv-player-empty">
                {loading ? <LoaderCircle size={20} className="player-spinner" /> : <Tv2 size={20} />}
                <p>{loading ? "Cargando..." : "Selecciona un canal para reproducir."}</p>
              </div>
            )}
          </div>

          {selectedChannel ? (
            <div className="live-tv-current">
              <h2>{selectedChannel.name}</h2>
              <p className="muted">
                {selectedChannel.category.name}
                {selectedChannel.country ? ` | ${selectedChannel.country}` : ""}
                {selectedChannel.language ? ` | ${selectedChannel.language}` : ""}
              </p>
            </div>
          ) : null}

          {error ? <p className="watch-error">{error}</p> : null}
        </section>
      </section>
    </main>
  );
}
