import React, { useCallback, useEffect, useState } from "react";
import { useApp, type ServerMe } from "../core/store";
import { relativeTime } from "../core/utils";
import { Icon } from "../ui/icons";
import { Avatar, Modal } from "../ui/primitives";

interface SessionRow {
  id: string;
  userId: string;
  createdAt: number;
  lastSeen: number;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
  live: boolean;
}

export function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /node|undici/i.test(ua) ? "API client" : "Browser";
  const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** Sessions list with revoke — the user's own, or the whole workspace for admins. */
export function SessionsList({ all = false }: { all?: boolean }) {
  const { api, userById, toast } = useApp();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const load = useCallback(() => {
    api<{ sessions: SessionRow[] }>(`/api/sessions${all ? "?all=1" : ""}`).then(({ status, data }) => {
      if (status === 200) setRows(data.sessions);
    });
  }, [api, all]);
  useEffect(load, [load]);
  if (!rows) return <p className="small weak">Loading sessions…</p>;
  return (
    <div className="audit-list" role="table" aria-label="Active sessions">
      {rows.map((s) => {
        const u = userById(s.userId);
        return (
          <div key={s.id} className="audit-row" role="row">
            {all && <Avatar user={u} size={24} />}
            <div className="col grow" style={{ minWidth: 0 }} role="cell">
              <span className="truncate">
                {all && <b>{u?.name ?? "Unknown"} · </b>}
                {describeAgent(s.userAgent)}
                {s.current && <span className="chip" style={{ height: 18, marginLeft: 6 }}>this device</span>}
                {s.live && !s.current && <span className="chip" style={{ height: 18, marginLeft: 6 }}>online</span>}
              </span>
              <span className="small weak">
                {s.ip ?? "unknown address"} · signed in {relativeTime(new Date(s.createdAt).toISOString())} · active {relativeTime(new Date(s.lastSeen).toISOString())}
              </span>
            </div>
            {!s.current && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  const r = await api(`/api/sessions/${s.id}`, { method: "DELETE" });
                  toast(r.status === 200 ? "Session signed out" : "Couldn't sign that session out");
                  load();
                }}
              >
                Sign out
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AccountModal({ onClose }: { onClose: () => void }) {
  const { user, mode, me, api, signedIn, toast, logout } = useApp();
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [msg, setMsg] = useState<string | null>(null);

  if (mode !== "server") {
    return (
      <Modal title="Account & security" icon={<Icon name="lock" size={16} />} onClose={onClose}>
        <div className="row" style={{ gap: 12, marginBottom: 12 }}>
          <Avatar user={user} size={40} />
          <div className="col">
            <b>{user.name}</b>
            <span className="small weak">{user.email}</span>
          </div>
        </div>
        <div className="callout">
          You're running in local mode — everything is stored in this browser. Start the Waypoint server (<code>npm run server</code>)
          to get real sign-in, two-factor authentication, live collaboration and session management.
        </div>
      </Modal>
    );
  }

  const enable = async () => {
    const r = await api<ServerMe & { message?: string }>("/api/2fa/enable", { method: "POST", json: { code } });
    if (r.status !== 200) return setMsg(r.data.message ?? "That code didn't work.");
    signedIn(r.data);
    setSetup(null);
    setCode("");
    setMsg(null);
    toast("Two-factor sign-in is on");
  };
  const disable = async () => {
    const r = await api<ServerMe & { message?: string }>("/api/2fa/disable", { method: "POST", json: { code } });
    if (r.status !== 200) return setMsg(r.data.message ?? "That code didn't work.");
    signedIn(r.data);
    setCode("");
    setMsg(null);
    toast("Two-factor sign-in is off");
  };
  const changePassword = async () => {
    const r = await api<{ message?: string }>("/api/password", { method: "POST", json: pw });
    if (r.status !== 200) return setMsg(r.data.message ?? "Couldn't change your password.");
    setPw({ current: "", next: "" });
    setMsg(null);
    toast("Password changed — other sessions were signed out");
  };

  return (
    <Modal title="Account & security" icon={<Icon name="lock" size={16} />} onClose={onClose} wide>
      <div className="account-grid">
        <section>
          <h4 className="section-label">Two-factor sign-in</h4>
          {me?.twoFactorEnabled ? (
            <div className="col" style={{ gap: 8 }}>
              <span className="row small" style={{ gap: 6 }}>
                <Icon name="check-circle" size={14} /> On — you'll enter a code from your authenticator app when signing in.
              </span>
              {!me.twoFactorRequired && (
                <div className="row" style={{ gap: 8 }}>
                  <input className="input mono" placeholder="Current code" value={code} maxLength={7} onChange={(e) => setCode(e.target.value)} />
                  <button className="btn btn-secondary btn-sm" onClick={disable}>
                    Turn off
                  </button>
                </div>
              )}
              {me.twoFactorRequired && <span className="small weak">Required by your workspace.</span>}
            </div>
          ) : setup ? (
            <div className="col" style={{ gap: 8 }}>
              <div className="auth-secret">
                <span className="small weak">Setup key</span>
                <code className="mono">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
                <a className="small" href={setup.otpauth}>
                  Open in authenticator app
                </a>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <input className="input mono" placeholder="6-digit code" value={code} maxLength={7} onChange={(e) => setCode(e.target.value)} />
                <button className="btn btn-primary btn-sm" onClick={enable}>
                  Verify
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const r = await api<{ secret: string; otpauth: string }>("/api/2fa/setup", { method: "POST", json: {} });
                if (r.status === 200) setSetup(r.data);
              }}
            >
              <Icon name="lock" size={13} /> Set up two-factor sign-in
            </button>
          )}

          <h4 className="section-label" style={{ marginTop: 20 }}>
            Password
          </h4>
          <div className="col" style={{ gap: 8, maxWidth: 320 }}>
            <input className="input" type="password" autoComplete="current-password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <input className="input" type="password" autoComplete="new-password" placeholder="New password (10+ characters)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <button className="btn btn-secondary btn-sm" disabled={!pw.current || pw.next.length < 10} onClick={changePassword}>
              Change password
            </button>
          </div>
          {msg && (
            <p className="auth-error" role="alert" style={{ marginTop: 10 }}>
              {msg}
            </p>
          )}
        </section>
        <section>
          <h4 className="section-label">Where you're signed in</h4>
          <SessionsList />
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={logout}>
            <Icon name="external" size={13} /> Sign out of this device
          </button>
        </section>
      </div>
    </Modal>
  );
}

const WHATS_NEW = [
  ["Live collaboration", "Changes from teammates appear instantly, with presence on tasks and projects."],
  ["Server-enforced access", "Sign-in, two-factor authentication, session management and an audit log."],
  ["Approvals", "Single or multi-approver sign-off, with notes and a full history."],
  ["Critical path", "Forecast finish, slack, conflicts, dependency arrows and auto-scheduling."],
  ["Smarter automations", "Conditions, schedules, a 30-day dry run and loop protection."],
  ["Workload & capacity", "Hours per person per week and AI-suggested rebalancing."],
  ["Risk radar & goals", "Explainable project risk and goals that update themselves."],
  ["Plain-English search", "Type “overdue high priority for Priya” and get filters."],
  ["Recurring tasks & templates", "Repeat work on a schedule; start tasks from a template."],
  ["AI teammate review", "Budgets, injection screening and one-click revert of agent work."],
] as const;

export function WhatsNewModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="What's new in Waypoint" icon={<Icon name="sparkle" size={16} />} onClose={onClose}>
      <ul className="whats-new">
        {WHATS_NEW.map(([title, body]) => (
          <li key={title}>
            <b>{title}</b>
            <span className="weak">{body}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
