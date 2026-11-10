import React, { useEffect, useState } from "react";
import { useApp, type ServerMe } from "../core/store";
import { BRAND } from "../core/brand";
import { navigate } from "../core/router";
import { WaypointLogo, Icon } from "../ui/icons";

/* Screens shown before (or instead of) the workspace in server mode. */

const DEMO_ACCOUNTS = [
  { email: "maya.chen@northwind.co", label: "Maya Chen", role: "Owner" },
  { email: "alex.rivera@northwind.co", label: "Alex Rivera", role: "Admin" },
  { email: "priya.nair@northwind.co", label: "Priya Nair", role: "Member" },
  { email: "lucas@agency.partner", label: "Lucas Meyer", role: "Guest" },
];

function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <WaypointLogo size={28} />
          <span>{BRAND.name}</span>
        </div>
        <h1 id="auth-title" className="auth-title">
          {title}
        </h1>
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
      </section>
      <p className="auth-foot">{BRAND.tagline}</p>
    </main>
  );
}

export function Splash() {
  return (
    <main className="auth-page" aria-busy="true">
      <div className="auth-brand pulse">
        <WaypointLogo size={34} />
        <span>{BRAND.name}</span>
      </div>
    </main>
  );
}

export function LoginScreen() {
  const { api, signedIn } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { status, data } = await api<{ me?: ServerMe; error?: string; message?: string }>("/api/login", {
        method: "POST",
        json: { email, password, code: needCode ? code : undefined },
      });
      if (status === 200 && data.me) {
        // re-read the session so the cookie-backed identity is authoritative
        const s = await api<ServerMe>("/api/session");
        signedIn(s.data);
        return;
      }
      if (data.error === "two_factor_required") {
        setNeedCode(true);
        setError(null);
        return;
      }
      setError(data.message ?? "Sign-in failed. Try again.");
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Sign in" subtitle="Use your work email. Your workspace admin controls who has access.">
      <form className="auth-form" onSubmit={submit} noValidate>
        <label className="auth-label">
          Email
          <input
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </label>
        <label className="auth-label">
          Password
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            maxLength={200}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {needCode && (
          <label className="auth-label">
            Authentication code
            <input
              className="input mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123 456"
              value={code}
              maxLength={7}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            <span className="small weak">Open your authenticator app — codes change every 30 seconds.</span>
          </label>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>
          {busy ? "Signing in…" : needCode ? "Verify and sign in" : "Sign in"}
        </button>
      </form>
      <div className="auth-demo">
        <div className="small weak">Demo accounts · password <code>waypoint-demo</code></div>
        <div className="auth-demo-grid">
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.email}
              type="button"
              className="chip"
              onClick={() => {
                setEmail(a.email);
                setPassword("waypoint-demo");
                setNeedCode(false);
              }}
            >
              {a.label} <span className="weak">· {a.role}</span>
            </button>
          ))}
        </div>
      </div>
    </AuthFrame>
  );
}

/** Mandatory when the workspace requires 2FA and this person hasn't set it up. */
export function EnrollScreen({ onDone }: { onDone?: () => void }) {
  const { api, signedIn, logout, me } = useApp();
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ secret: string; otpauth: string }>("/api/2fa/setup", { method: "POST", json: {} }).then(({ status, data }) => {
      if (status === 200) setSetup(data);
      else setError("Couldn't start setup. Reload to try again.");
    });
  }, [api]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const { status, data } = await api<ServerMe & { message?: string }>("/api/2fa/enable", { method: "POST", json: { code } });
    if (status !== 200) return setError(data.message ?? "That code didn't work.");
    signedIn(data);
    onDone?.();
  };

  return (
    <AuthFrame
      title="Set up two-factor sign-in"
      subtitle={`${me?.twoFactorRequired ? "Your workspace requires it. " : ""}Add ${BRAND.name} to an authenticator app (1Password, Google Authenticator, Authy…), then enter the 6-digit code it shows.`}
    >
      {setup ? (
        <form className="auth-form" onSubmit={verify}>
          <div className="auth-secret">
            <span className="small weak">Setup key</span>
            <code className="mono">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
            <a className="small" href={setup.otpauth}>
              Open in authenticator app
            </a>
          </div>
          <label className="auth-label">
            6-digit code
            <input className="input mono" inputMode="numeric" value={code} maxLength={7} onChange={(e) => setCode(e.target.value)} autoFocus />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="btn btn-primary auth-submit" type="submit">
            Turn on two-factor sign-in
          </button>
        </form>
      ) : (
        <p className="small weak">{error ?? "Preparing…"}</p>
      )}
      <button className="btn btn-ghost btn-sm" onClick={logout} style={{ marginTop: 12 }}>
        Sign out
      </button>
    </AuthFrame>
  );
}

export function JoinScreen({ inviteId }: { inviteId: string }) {
  const { api, signedIn } = useApp();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== confirm) return setError("The passwords don't match.");
    const { status, data } = await api<{ message?: string }>("/api/invites/accept", { method: "POST", json: { inviteId, password } });
    if (status !== 200) return setError(data.message ?? "This invitation can't be used.");
    const s = await api<ServerMe>("/api/session");
    navigate("/home");
    signedIn(s.data);
  };

  return (
    <AuthFrame title="Join your team" subtitle="Choose a password to finish accepting the invitation.">
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-label">
          Password
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        <label className="auth-label">
          Confirm password
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="btn btn-primary auth-submit" type="submit">
          Create account
        </button>
      </form>
    </AuthFrame>
  );
}

/* ------------------------------------------------------------ public form */

interface PublicForm {
  id: string;
  title: string;
  description: string;
  fields: { id: string; label: string; type: string; required?: boolean; options?: string[] }[];
  token: string;
}

export function PublicFormView({ formId }: { formId: string }) {
  const [form, setForm] = useState<PublicForm | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [trap, setTrap] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "missing" | "sent" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/public/forms/${encodeURIComponent(formId)}`)
      .then(async (r) => {
        if (r.status !== 200) return setState("missing");
        setForm(await r.json());
        setState("ready");
      })
      .catch(() => setState("missing"));
  }, [formId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const missing = form.fields.find((f) => f.required && !values[f.id]?.trim());
    if (missing) {
      setMessage(`“${missing.label}” is required.`);
      return;
    }
    const r = await fetch(`/api/public/forms/${form.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "waypoint" },
      body: JSON.stringify({ token: form.token, values, website: trap }),
    });
    if (r.status === 201) return setState("sent");
    const data = await r.json().catch(() => ({}));
    setMessage(data.message ?? "Couldn't send. Try again in a moment.");
  };

  if (state === "loading") return <Splash />;
  if (state === "missing")
    return (
      <AuthFrame title="Form unavailable" subtitle="This form isn't accepting responses. Ask whoever shared the link." >
        <span />
      </AuthFrame>
    );
  if (state === "sent")
    return (
      <AuthFrame title="Thanks — we got it" subtitle="Your request was added to the team's queue.">
        <Icon name="check-circle" size={28} />
      </AuthFrame>
    );
  return (
    <AuthFrame title={form!.title} subtitle={form!.description}>
      <form className="auth-form" onSubmit={submit} noValidate>
        {form!.fields.map((f) => (
          <label key={f.id} className="auth-label">
            {f.label}
            {f.required && <span className="weak"> *</span>}
            {f.type === "long-text" || f.type === "textarea" ? (
              <textarea className="input" rows={4} maxLength={5000} value={values[f.id] ?? ""} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} />
            ) : f.options?.length ? (
              <select className="input" value={values[f.id] ?? ""} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}>
                <option value="">Choose…</option>
                {f.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input className="input" type={f.type === "date" ? "date" : "text"} maxLength={500} value={values[f.id] ?? ""} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} />
            )}
          </label>
        ))}
        {/* honeypot: hidden from people, filled in by bots */}
        <label className="auth-honeypot" aria-hidden="true">
          Website
          <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </label>
        {message && <p className="auth-error" role="alert">{message}</p>}
        <button className="btn btn-primary auth-submit" type="submit">
          Submit
        </button>
      </form>
    </AuthFrame>
  );
}
