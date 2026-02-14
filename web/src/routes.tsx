import { createBrowserRouter } from "react-router-dom";
import { HomePage } from "./views/HomePage";
import { LiveTvPage } from "./views/LiveTvPage";
import { SearchPage } from "./views/SearchPage";
import { WatchPage } from "./views/WatchPage";

export const appRouter = createBrowserRouter([
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
    path: "/live-tv",
    element: <LiveTvPage />
  }
]);
