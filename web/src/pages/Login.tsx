import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from || "/";
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message || "Anmeldung fehlgeschlagen");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-app-bg-root)]">
      <div className="auth-frame">
        <div className="px-6 pt-12 pb-6 text-center">
          <div className="brand-tile">CP</div>
          <h1 className="text-[28px] font-bold tracking-tight mt-5 text-[var(--color-app-text)]">
            Willkommen zurück
          </h1>
          <p className="text-[14px] text-[var(--color-app-text-secondary)] mt-1">
            Melde dich an, um deine Pre-Flight Checks fortzusetzen.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-5 pb-8 space-y-4 flex-1">
          <div>
            <label className="label" htmlFor="email">E-Mail</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="input-email"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Passwort</label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="input-password"
            />
          </div>
          {error && (
            <div className="text-sm text-[var(--color-nogo)] bg-[var(--color-nogo-bg)] rounded-xl px-3 py-2">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={submitting}
            data-testid="button-login"
          >
            {submitting ? "Wird angemeldet …" : "Anmelden"}
          </button>

          <div className="text-center text-[14px] text-[var(--color-app-text-secondary)] pt-2">
            Noch keinen Account?{" "}
            <Link
              to="/register"
              className="text-[var(--color-brand-500)] font-semibold hover:underline"
              data-testid="link-register"
            >
              Registrieren
            </Link>
          </div>

          <div className="pt-6 mt-6 border-t border-[var(--color-app-border)] text-center text-[12px] text-[var(--color-app-text-tertiary)]">
            Login mit Google / Apple folgt
          </div>
        </form>
      </div>
    </div>
  );
}
