import { createContext, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { loginUser } from "../api";
import type { CatalogItem, Category, SourcesPayload, UserRecord } from "../types";

interface AppState {
  category: Category;
  query: string;
  sources: SourcesPayload | null;
  selectedItem: CatalogItem | null;
  user: UserRecord | null;
}

type Action =
  | { type: "setCategory"; payload: Category }
  | { type: "setQuery"; payload: string }
  | { type: "setSources"; payload: SourcesPayload | null }
  | { type: "setSelectedItem"; payload: CatalogItem | null }
  | { type: "setUser"; payload: UserRecord | null };

const initialState: AppState = {
  category: "movie",
  query: "",
  sources: null,
  selectedItem: null,
  user: null
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
    case "setUser":
      return { ...state, user: action.payload };
    default:
      return state;
  }
}

interface StoreContextValue {
  state: AppState;
  initializing: boolean;
  actions: {
    setCategory: (category: Category) => void;
    setQuery: (query: string) => void;
    setSources: (sources: SourcesPayload | null) => void;
    setSelectedItem: (item: CatalogItem | null) => void;
    setUser: (user: UserRecord | null) => void;
  };
}

const AppStoreContext = createContext<StoreContextValue | null>(null);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [initializing, setInitializing] = useState(true);
  const LOCAL_USER_KEY = "streams-user-session";

  const actions = useMemo(
    () => ({
      setCategory: (category: Category) => dispatch({ type: "setCategory", payload: category }),
      setQuery: (query: string) => dispatch({ type: "setQuery", payload: query }),
      setSources: (sources: SourcesPayload | null) => dispatch({ type: "setSources", payload: sources }),
      setSelectedItem: (item: CatalogItem | null) => dispatch({ type: "setSelectedItem", payload: item }),
      setUser: (user: UserRecord | null) => dispatch({ type: "setUser", payload: user })
    }),
    []
  );

  useEffect(() => {
    const stored = (() => {
      try {
        const raw = localStorage.getItem(LOCAL_USER_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })();
    if (stored?.username) {
      loginUser({ username: stored.username, displayName: stored.displayName })
        .then((response) => {
          actions.setUser(response.user);
        })
        .catch(() => {
          localStorage.removeItem(LOCAL_USER_KEY);
        })
        .finally(() => {
          setInitializing(false);
        });
    } else {
      setInitializing(false);
    }
  }, [actions]);

  useEffect(() => {
    if (state.user) {
      localStorage.setItem(
        LOCAL_USER_KEY,
        JSON.stringify({ username: state.user.username, displayName: state.user.displayName })
      );
    } else {
      localStorage.removeItem(LOCAL_USER_KEY);
    }
  }, [state.user]);

  const value = useMemo(() => ({ state, initializing, actions }), [state, initializing, actions]);
  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const context = useContext(AppStoreContext);
  if (!context) {
    throw new Error("useAppStore debe usarse dentro de AppStoreProvider");
  }
  return context;
}
