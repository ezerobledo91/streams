import { useState } from "react";
import type { FormEvent } from "react";
import { loginUser } from "../api";
import type { UserRecord } from "../types";

interface CreateUserModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (user: UserRecord) => void;
}

export function CreateUserModal({ open, onClose, onCreated }: CreateUserModalProps) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim()) {
      setError("Ingresa un nombre de usuario.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await loginUser({ username, displayName });
      onCreated(response.user);
      setUsername("");
      setDisplayName("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el usuario.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>Nueva sesión</h2>
        <form className="modal-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Usuario"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={loading}
          />
          <input
            type="text"
            placeholder="Nombre visible (opcional)"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={loading}
          />
          {error ? <span className="muted">{error}</span> : null}
          <div className="modal-actions">
            <button type="button" className="secondary-btn" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className="primary-btn" disabled={loading}>
              {loading ? "Creando..." : "Crear sesión"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
