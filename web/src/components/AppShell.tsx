import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { useLocation } from "react-router-dom";
import { SideNav } from "./SideNav";
import { AppContext } from "../context/AppShellContext";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const [isSideNavOpen, setIsSideNavOpen] = useState(false);
  const lastFocusedBeforeOpenRef = useRef<HTMLElement | null>(null);

  const openSideNav = useCallback(() => {
    const active = document.activeElement;
    if (active && active instanceof HTMLElement && active !== document.body) {
      lastFocusedBeforeOpenRef.current = active;
    }
    setIsSideNavOpen(true);
  }, []);

  const closeSideNav = useCallback(() => {
    setIsSideNavOpen(false);
    const previous = lastFocusedBeforeOpenRef.current;
    if (previous && previous.isConnected) {
      window.requestAnimationFrame(() => {
        previous.focus({ preventScroll: true });
      });
    }
  }, []);

  const toggleSideNav = useCallback(() => setIsSideNavOpen((current) => !current), []);

  useEffect(() => {
    if (window.innerWidth < 900) {
      setIsSideNavOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    function onGlobalMenuKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target?.isContentEditable) {
        return;
      }

      if (event.defaultPrevented) return;

      const key = event.key;
      const isMenuKey =
        key === "ContextMenu" ||
        key === "Menu" ||
        key === "F1" ||
        key === "m" ||
        key === "M";

      if (!isMenuKey) return;
      event.preventDefault();
      if (isSideNavOpen) {
        closeSideNav();
      } else {
        openSideNav();
      }
    }

    window.addEventListener("keydown", onGlobalMenuKeyDown);
    return () => window.removeEventListener("keydown", onGlobalMenuKeyDown);
  }, [isSideNavOpen, openSideNav, closeSideNav]);

  const contextValue = useMemo(
    () => ({
      isSideNavOpen,
      openSideNav,
      closeSideNav,
      toggleSideNav
    }),
    [isSideNavOpen, openSideNav, closeSideNav, toggleSideNav]
  );

  return (
    <AppContext.Provider value={contextValue}>
      <div className="app-shell-root">
        <SideNav isOpen={isSideNavOpen} onClose={closeSideNav} />
        <button
          type="button"
          className={`shell-menu-trigger ${isSideNavOpen ? "is-hidden" : ""}`}
          onClick={openSideNav}
          aria-label="Abrir menu principal"
          title="Abrir menu"
        >
          <Menu size={22} />
        </button>
        <div className="app-page-wrapper">
          {children}
        </div>
      </div>
    </AppContext.Provider>
  );
}
