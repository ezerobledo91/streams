import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AppStoreProvider } from "./store/AppStore";
import { appRouter } from "./routes";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppStoreProvider>
      <RouterProvider router={appRouter} />
    </AppStoreProvider>
  </React.StrictMode>
);
