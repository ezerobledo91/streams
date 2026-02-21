import { useState } from "react";
import { User } from "lucide-react";
import { useAppStore } from "../store/AppStore";

export function UserSummary() {
  const { state, actions } = useAppStore();
  const [showMenu, setShowMenu] = useState(false);

  if (!state.user) return null;

  const initials = state.user.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="user-summary" style={{ position: "relative" }}>
      <button
        type="button"
        className="user-avatar-btn home-header-focusable"
        onClick={() => setShowMenu((v) => !v)}
        title={state.user.displayName}
      >
        {initials || <User size={14} />}
      </button>
      {showMenu ? (
        <>
          <div className="user-avatar-menu">
            <p className="user-avatar-menu-name">{state.user.displayName}</p>
            <p className="user-avatar-menu-meta">{state.user.favorites.length} favoritos</p>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => { actions.setUser(null); setShowMenu(false); }}
            >
              Cerrar sesion
            </button>
          </div>
          <div className="user-avatar-backdrop" onClick={() => setShowMenu(false)} />
        </>
      ) : null}
    </div>
  );
}
