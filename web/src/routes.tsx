import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { useAppStore } from "./store/AppStore";
import { HomePage } from "./views/HomePage";
import { LiveTvPage } from "./views/LiveTvPage";
import { LoginPage } from "./views/LoginPage";
import { SearchPage } from "./views/SearchPage";
import { WatchPage } from "./views/WatchPage";
import { CategoryPage } from "./views/CategoryPage";

function RequireAuth() {
  const { state, initializing } = useAppStore();
  if (initializing) return null;
  if (!state.user) return <Navigate to="/login" replace />;
  return <Outlet />;
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
      }
    ]
  }
]);
