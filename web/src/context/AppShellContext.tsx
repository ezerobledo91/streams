import { createContext, useContext } from "react";

interface AppContextType {
  isSideNavOpen: boolean;
  openSideNav: () => void;
  closeSideNav: () => void;
  toggleSideNav: () => void;
}

export const AppContext = createContext<AppContextType | null>(null);

export function useAppShell() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppShell must be used within an AppShellProvider");
  }
  return context;
}
