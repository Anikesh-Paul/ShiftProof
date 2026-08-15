import {
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type FormEvent,
} from "react";
import { Navigate } from "react-router-dom";
import { Button } from "../components/Button";
import { useAuth } from "../lib/auth";
import { getErrorMessage } from "../lib/errors";
import "./LoginPage.css";

const DEMO_ACCOUNTS = [
  {
    role: "Staff",
    email: "staff@shiftproof.demo",
    password: "DemoStaff123!",
  },
  {
    role: "Manager",
    email: "manager@shiftproof.demo",
    password: "DemoManager123!",
  },
] as const;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LoginPage() {
  const { user, role, loading, login, error, clearError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [brandPhotoLoaded, setBrandPhotoLoaded] = useState(false);
  const brandPhotoRef = useRef<HTMLImageElement>(null);

  const message = localError || error;

  const [errorShown, setErrorShown] = useState<string | null>(null);
  const [errorExiting, setErrorExiting] = useState(false);

  useEffect(() => {
    const img = brandPhotoRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setBrandPhotoLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (message) {
      setErrorShown(message);
      setErrorExiting(false);
      return;
    }
    if (errorShown && !errorExiting) {
      if (prefersReducedMotion()) {
        setErrorShown(null);
        setErrorExiting(false);
      } else {
        setErrorExiting(true);
      }
    }
  }, [message, errorShown, errorExiting]);

  function onErrorExitEnd(e: AnimationEvent<HTMLDivElement>) {
    if (!errorExiting) return;
    if (e.animationName && e.animationName !== "toast-out") return;
    setErrorShown(null);
    setErrorExiting(false);
  }

  if (!loading && user) {
    if (role === "manager") return <Navigate to="/manager" replace />;
    if (role === "staff") return <Navigate to="/staff" replace />;
    return <Navigate to="/no-role" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    setLocalError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setLocalError(getErrorMessage(err, "Login failed"));
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo(account: (typeof DEMO_ACCOUNTS)[number]) {
    clearError();
    setLocalError(null);
    setEmail(account.email);
    setPassword(account.password);
  }

  const formLocked = submitting || loading;

  return (
    <div className="login-page">
      <aside className="login-brand" aria-label="ShiftProof">
        <div className="login-brand-media" aria-hidden="true">
          <img
            ref={brandPhotoRef}
            className={
              brandPhotoLoaded
                ? "login-brand-photo is-loaded"
                : "login-brand-photo"
            }
            src="/login-brand.jpg"
            alt=""
            width={900}
            height={1200}
            decoding="async"
            fetchPriority="high"
            onLoad={() => setBrandPhotoLoaded(true)}
          />
          <div className="login-brand-scrim" />
        </div>
        <div className="login-brand-copy">
          <h1 className="login-brand-name">ShiftProof</h1>
          <span className="login-brand-rule" aria-hidden="true" />
          <p className="login-brand-title">
            Prove the café opened ready.
          </p>
        </div>
      </aside>

      <main className="login-panel">
        <div className="login-panel-inner">
          <header className="login-header">
            <h2 className="login-heading">Sign in</h2>
          </header>

          {errorShown ? (
            <div
              className="error-banner"
              data-enter={!errorExiting ? "true" : undefined}
              data-exit={errorExiting ? "true" : undefined}
              role="alert"
              onAnimationEnd={onErrorExitEnd}
            >
              {errorShown}
            </div>
          ) : null}

          <form className="login-form" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={formLocked}
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={formLocked}
                enterKeyHint="go"
              />
            </div>
            <Button
              type="submit"
              fullWidth
              loading={submitting}
              disabled={formLocked}
            >
              Sign in
            </Button>
          </form>

          <div className="login-demo">
            <p className="login-demo-label">Demo</p>
            <div
              className="login-demo-row"
              role="group"
              aria-label="Demo accounts"
            >
              {DEMO_ACCOUNTS.map((account) => {
                const selected = email === account.email;
                return (
                  <button
                    key={account.email}
                    type="button"
                    className={
                      selected
                        ? "login-demo-chip is-selected"
                        : "login-demo-chip"
                    }
                    onClick={() => fillDemo(account)}
                    disabled={formLocked}
                    aria-pressed={selected}
                    title={account.email}
                  >
                    <span className="login-demo-role">{account.role}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
