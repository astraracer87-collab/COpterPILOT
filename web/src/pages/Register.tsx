import { useState, type FormEvent } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Passwort muss mindestens 8 Zeichen haben");
      return;
    }
    setSubmitting(true);
    try {
      await register(email, password, name || undefined);
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message || "Registrierung fehlgeschlagen");
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
            Account erstellen
          </h1>
          <p className="text-[14px] text-[var(--color-app-text-secondary)] mt-1">
            Kostenlos. Direkt einsatzbereit für deinen ersten Pre-Flight Check.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-5 pb-8 space-y-4 flex-1">
          <div>
            <label className="label" htmlFor="name">Name <span className="text-[var(--color-app-text-tertiary)] font-normal">(optional)</span></label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-name"
            />
          </div>
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
              autoComplete="new-password"
              minLength={8}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="input-password"
            />
            <div className="text-[12px] text-[var(--color-app-text-tertiary)] mt-1">
              Mindestens 8 Zeichen
            </div>
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
            data-testid="button-register"
          >
            {submitting ? "Wird erstellt …" : "Account erstellen"}
          </button>

          <div className="text-center text-[14px] text-[var(--color-app-text-secondary)] pt-2">
            Bereits einen Account?{" "}
            <Link
              to="/login"
              className="text-[var(--color-brand-500)] font-semibold hover:underline"
              data-testid="link-login"
            >
              Anmelden
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
