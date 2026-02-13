import { createContext, useContext, useMemo, useReducer } from "react";
import type { CatalogItem, Category, SourcesPayload } from "../types";

interface AppState {
  category: Category;
  query: string;
  sources: SourcesPayload | null;
  selectedItem: CatalogItem | null;
}

type Action =
  | { type: "setCategory"; payload: Category }
  | { type: "setQuery"; payload: string }
  | { type: "setSources"; payload: SourcesPayload | null }
  | { type: "setSelectedItem"; payload: CatalogItem | null };

const initialState: AppState = {
  category: "movie",
  query: "",
  sources: null,
  selectedItem: null
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "setCategory":
      return { ...state, category: action.payload };
    case "setQuery":
      return { ...state, query: action.payload };
    case "setSources":
      return { ...state, sources: action.payload };
    case "setSelectedItem":
      return { ...state, selectedItem: action.payload };
    default:
      return state;
  }
}

interface StoreContextValue {
  state: AppState;
  actions: {
    setCategory: (category: Category) => void;
    setQuery: (query: string) => void;
    setSources: (sources: SourcesPayload | null) => void;
    setSelectedItem: (item: CatalogItem | null) => void;
  };
}

const AppStoreContext = createContext<StoreContextValue | null>(null);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const actions = useMemo(
    () => ({
      setCategory: (category: Category) => dispatch({ type: "setCategory", payload: category }),
      setQuery: (query: string) => dispatch({ type: "setQuery", payload: query }),
      setSources: (sources: SourcesPayload | null) => dispatch({ type: "setSources", payload: sources }),
      setSelectedItem: (item: CatalogItem | null) => dispatch({ type: "setSelectedItem", payload: item })
    }),
    []
  );

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const context = useContext(AppStoreContext);
  if (!context) {
    throw new Error("useAppStore debe usarse dentro de AppStoreProvider");
  }
  return context;
}
