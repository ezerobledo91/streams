import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { useAppStore } from "./store/AppStore";
import { AppShell } from "./components/AppShell";
import { HomePage } from "./views/HomePage";
import { LiveTvPage } from "./views/LiveTvPage";
import { EventosPage } from "./views/EventosPage";
import { Page247 } from "./views/Page247";
import { LoginPage } from "./views/LoginPage";
import { SearchPage } from "./views/SearchPage";
import { WatchPage } from "./views/WatchPage";
import { CategoryPage } from "./views/CategoryPage";
import { FavoritesPage } from "./views/FavoritesPage";

function RequireAuth() {
  const { state, initializing } = useAppStore();
  if (initializing) return null;
  if (!state.user) return <Navigate to="/login" replace />;
  // Envuelve el Outlet con AppShell para que todas las rutas hijas lo usen
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function RedirectIfAuth() {
  const { state, initializing } = useAppStore();
  if (initializing) return null;
  if (state.user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

export const appRouter = createBrowserRouter([
  {
    path: "/login",
    element: <RedirectIfAuth />
  },
  {
    element: <RequireAuth />,
    children: [
      {
        path: "/",
        element: <HomePage />
      },
      {
        path: "/watch/:type/:itemId",
        element: <WatchPage />
      },
      {
        path: "/search",
        element: <SearchPage />
      },
      {
        path: "/category/:category",
        element: <CategoryPage />
      },
      {
        path: "/live-tv",
        element: <LiveTvPage />
      },
      {
        path: "/eventos",
        element: <EventosPage />
      },
      {
        path: "/247",
        element: <Page247 />
      },
      {
        path: "/favorites",
        element: <FavoritesPage />
      }
    ]
  }
]);
