import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, User } from "lucide-react";
import { fetchUserList } from "../api";
import { CreateUserModal } from "../components/CreateUserModal";
import { useAppStore } from "../store/AppStore";
import type { UserRecord } from "../types";
import { loginUser } from "../api";
import { useTvFocusManager } from "../hooks/useTvFocusManager";
import { useGamepad } from "../hooks/useGamepad";

export function LoginPage() {
  const { actions } = useAppStore();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  useGamepad();

  const handleFocusSelect = useCallback(
    (element: HTMLElement) => {
      element.click();
    },
    []
  );

  const { focusFirst } = useTvFocusManager({
    containerRef: gridRef,
    groupType: "grid",
    onSelect: handleFocusSelect,
    enabled: !showCreate && !loading
  });

  useEffect(() => {
    if (!loading && users.length) {
      requestAnimationFrame(() => focusFirst());
    }
  }, [loading, users.length, focusFirst]);

  useEffect(() => {
    let cancelled = false;
    const attempt = (retriesLeft: number) => {
      fetchUserList()
        .then((res) => {
          if (!cancelled) {
            setUsers(res.users);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled && retriesLeft > 0) {
            setTimeout(() => attempt(retriesLeft - 1), 2000);
          } else if (!cancelled) {
            setLoading(false);
          }
        });
    };
    attempt(3);
    return () => { cancelled = true; };
  }, []);

  async function handleSelectUser(user: UserRecord) {
    setLoggingIn(user.username);
    try {
      const res = await loginUser({ username: user.username, displayName: user.displayName });
      actions.setUser(res.user);
    } catch {
      setLoggingIn(null);
    }
  }

  function handleUserCreated(user: UserRecord) {
    actions.setUser(user);
  }

  return (
    <main className="login-shell">
      <div className="login-container">
        <div className="login-brand">streams</div>
        <h1 className="login-heading">Quien esta mirando?</h1>

        {loading ? (
          <p className="muted" style={{ textAlign: "center" }}>Cargando perfiles...</p>
        ) : (
          <div className="login-grid" ref={gridRef}>
            {users.map((user) => (
              <button
                key={user.username}
                type="button"
                className="login-profile"
                data-tv-focusable
                onClick={() => void handleSelectUser(user)}
                disabled={loggingIn === user.username}
              >
                <div className="login-profile-avatar">
                  <User size={28} />
                </div>
                <span className="login-profile-name">{user.displayName}</span>
                <small className="login-profile-meta">{user.favorites.length} favoritos</small>
              </button>
            ))}
            <button
              type="button"
              className="login-profile login-profile-add"
              data-tv-focusable
              onClick={() => setShowCreate(true)}
            >
              <div className="login-profile-avatar login-profile-avatar-add">
                <Plus size={28} />
              </div>
              <span className="login-profile-name">Nuevo perfil</span>
            </button>
          </div>
        )}
      </div>

      <CreateUserModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleUserCreated}
      />
    </main>
  );
}
