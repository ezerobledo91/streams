import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AppStoreProvider } from "./store/AppStore";
import { appRouter } from "./routes";
import "./styles.css";

const appTree = (
  <AppStoreProvider>
    <RouterProvider router={appRouter} />
  </AppStoreProvider>
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  import.meta.env.DEV ? (
    appTree
  ) : (
  <React.StrictMode>
    {appTree}
  </React.StrictMode>
  )
);
