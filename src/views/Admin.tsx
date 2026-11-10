import React, { useState } from "react";
import { useApp } from "../core/store";
import type { ID, ProjectRole, WorkspaceRole } from "../core/types";
import {
  PROJECT_PERMISSION_MATRIX,
  PROJECT_ROLE_DESCRIPTION,
  PROJECT_ROLES,
  ROLE_LABEL,
  WORKSPACE_PERMISSION_MATRIX,
  WORKSPACE_ROLE_DESCRIPTION,
  WORKSPACE_ROLES,
  effectiveProjectRole,
  projectMatrixValue,
  workspaceMatrixValue,
} from "../core/rbac";
import { plural, relativeTime, swatchBg } from "../core/utils";
import { Icon } from "../ui/icons";
import { Avatar, EmptyState, MenuItem, Popover, usePopover } from "../ui/primitives";
import { SessionsList } from "./Account";

function RoleSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="input"
      style={{ height: 28, width: 128, fontSize: 12 }}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {ROLE_LABEL[o as ProjectRole | WorkspaceRole] ?? o}
        </option>
      ))}
    </select>
  );
}

export function AdminView() {
  const { state, dispatch, can, user, userById, toast } = useApp();
  const [tab, setTab] = useState<"members" | "permissions" | "invites" | "access" | "audit" | "security">(() =>
    window.location.hash.includes("tab=security") ? "security" : "members"
  );
  const { mode, api } = useApp();
  const [lastSeen, setLastSeen] = useState<Record<string, number>>({});
  React.useEffect(() => {
    if (mode !== "server") return;
    api<{ sessions: { userId: string; lastSeen: number }[] }>("/api/sessions?all=1").then(({ status, data }) => {
      if (status !== 200) return;
      const map: Record<string, number> = {};
      for (const s of data.sessions) map[s.userId] = Math.max(map[s.userId] ?? 0, s.lastSeen);
      setLastSeen(map);
    });
  }, [mode, api]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "guest" | "admin">("member");
  const [scopeProject, setScopeProject] = useState<ID | "">("");
  const [openProject, setOpenProject] = useState<ID>(state.projects[0]?.id ?? "");
  const addMemberPop = usePopover();

  if (!can("workspace:admin")) {
    return (
      <div className="page">
        <EmptyState
          icon="lock"
          title="Admin access required"
          description={`${user.name} has the ${user.workspaceRole} role. Ask a workspace admin for access, or switch persona from the account menu.`}
        />
      </div>
    );
  }

  const humans = state.users.filter((u) => !u.isAgent);
  const agents = state.users.filter((u) => u.isAgent);
  const project = state.projects.find((p) => p.id === openProject);

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <h1 className="page-title">
            <Icon name="lock" size={22} /> Admin console
          </h1>
          <div className="page-actions">
            <span className="chip">{humans.length} people</span>
            <span className="chip">{agents.length} agents</span>
            <span className="chip">{state.projects.length} projects</span>
          </div>
        </div>
        <p className="page-subtitle">
          Workspace roles control what people can do; project roles control where. Agents inherit
          a role per project and act only under their own granted scopes.
        </p>
      </div>

      <div className="tabs" style={{ padding: "8px 24px 0" }}>
        {(
          [
            ["members", "Members"],
            ["permissions", "Roles & permissions"],
            ["invites", "Invitations"],
            ["access", "Project access"],
            ["audit", "Audit log"],
            ["security", "Security & data"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={`tab${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="page-scroll">
        <div style={{ padding: "16px 24px 64px", maxWidth: 1100 }}>
          {tab === "members" && (
            <>
              <div className="list-head" style={{ borderRadius: 6 }}>
                <div className="col" style={{ flex: 1 }}>Person</div>
                <div className="col" style={{ width: 170 }}>Workspace role</div>
                <div className="col" style={{ width: 160 }}>Teams</div>
                <div className="col" style={{ width: 120 }}>Projects</div>
                <div className="col" style={{ width: 120 }}>Last active</div>
                <div className="col" style={{ width: 92 }} />
              </div>
              {humans.map((u) => {
                const wifi = u.workspaceRole ?? "member";
                const member = state.projects.filter((p) => p.memberIds.includes(u.id)).length;
                return (
                  <div
                    key={u.id}
                    className="row"
                    style={{ gap: 8, padding: "10px", borderBottom: "1px solid var(--color-border)" }}
                  >
                    <div className="row grow" style={{ gap: 10, minWidth: 0 }}>
                      <Avatar user={u} size={30} />
                      <div className="col" style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 500 }} className="truncate">
                          {u.name}
                          {u.id === state.currentUserId && (
                            <span className="chip" style={{ height: 18, marginLeft: 6 }}>you</span>
                          )}
                        </span>
                        <span className="small weak truncate">{u.email}</span>
                      </div>
                    </div>
                    <div style={{ width: 170 }}>
                      <RoleSelect
                        value={wifi}
                        options={
                          user.workspaceRole === "owner"
                            ? WORKSPACE_ROLES
                            : WORKSPACE_ROLES.filter((r) => r !== "owner")
                        }
                        disabled={
                          u.id === state.currentUserId ||
                          (wifi === "owner" && user.workspaceRole !== "owner")
                        }
                        onChange={(v) => {
                          dispatch({ type: "workspace/setRole", userId: u.id, role: v as WorkspaceRole });
                          toast(`${u.name} is now ${ROLE_LABEL[v as WorkspaceRole]}`, "Undo", () => {
                            dispatch({ type: "workspace/setRole", userId: u.id, role: wifi });
                          });
                        }}
                      />
                    </div>
                    <div className="small weak" style={{ width: 160 }}>
                      {u.teamIds.map((id) => state.teams.find((t) => t.id === id)?.name).join(", ") || "—"}
                    </div>
                    <div className="small weak" style={{ width: 120 }}>{plural(member, "project")}</div>
                    <div className="small weak" style={{ width: 120 }}>
                      {lastSeen[u.id] ? relativeTime(new Date(lastSeen[u.id]).toISOString()) : "—"}
                    </div>
                    <div style={{ width: 92 }}>
                      {u.id !== state.currentUserId && <ViewAsButton userId={u.id} name={u.name} />}
                    </div>
                  </div>
                );
              })}

              <h3 style={{ fontSize: 14, fontWeight: 500, margin: "24px 0 8px" }}>AI teammates</h3>
              {agents.map((a) => (
                <div key={a.id} className="row" style={{ gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--color-border)" }}>
                  <Avatar user={a} size={28} />
                  <span className="grow">{a.name}</span>
                  <span className="small weak">{a.agentStatus}</span>
                  <span className="chip" style={{ height: 20 }}>no workspace role</span>
                  <span className="small weak" style={{ width: 120 }}>
                    {state.projects.filter((p) => (a.projectIds ?? []).includes(p.id)).length} projects
                  </span>
                  <span className="small weak" style={{ width: 120 }}>{a.runCount ?? 0} runs</span>
                </div>
              ))}
            </>
          )}

          {tab === "permissions" && (
            <>
              <h3 style={{ fontSize: 14, fontWeight: 500, margin: "4px 0 10px" }}>Workspace roles</h3>
              <div className="grid-cards" style={{ gridTemplateColumns: "repeat(4, 1fr)", padding: 0, marginBottom: 24 }}>
                {WORKSPACE_ROLES.map((r) => (
                  <div key={r} className="stat-card">
                    <div className="row" style={{ gap: 6 }}>
                      <span className="chip" style={{ alignSelf: "flex-start" }}>
                        {ROLE_LABEL[r]}
                      </span>
                      <span className="small weak">
                        {plural(
                          humans.filter((u) => (u.workspaceRole ?? "member") === r).length,
                          "person",
                          "people"
                        )}
                      </span>
                    </div>
                    <span className="small weak" style={{ lineHeight: "18px" }}>
                      {WORKSPACE_ROLE_DESCRIPTION[r]}
                    </span>
                  </div>
                ))}
              </div>

              <div className="matrix">
                <div className="matrix-row matrix-head">
                  <div className="matrix-label">Permission</div>
                  {WORKSPACE_ROLES.map((r) => (
                    <div key={r}>{ROLE_LABEL[r]}</div>
                  ))}
                </div>
                {WORKSPACE_PERMISSION_MATRIX.map((p) => (
                  <div className="matrix-row" key={p.permission}>
                    <div className="matrix-label">
                      <span>{p.label}</span>
                      <span className="small weak">{p.description}</span>
                    </div>
                    {WORKSPACE_ROLES.map((r) => (
                      <div key={r} className="matrix-cell">
                        {workspaceMatrixValue(r, p.permission) ? (
                          <Icon name="check" size={14} style={{ color: "var(--color-success-text)" }} />
                        ) : (
                          <span className="matrix-dash">—</span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <h3 style={{ fontSize: 14, fontWeight: 500, margin: "28px 0 10px" }}>Project roles</h3>
              <div className="grid-cards" style={{ gridTemplateColumns: "repeat(4, 1fr)", padding: 0, marginBottom: 24 }}>
                {PROJECT_ROLES.map((r) => (
                  <div key={r} className="stat-card">
                    <span className="chip" style={{ alignSelf: "flex-start" }}>
                      {ROLE_LABEL[r]}
                    </span>
                    <span className="small weak" style={{ lineHeight: "18px" }}>
                      {PROJECT_ROLE_DESCRIPTION[r]}
                    </span>
                  </div>
                ))}
              </div>
              <div className="matrix">
                <div className="matrix-row matrix-head">
                  <div className="matrix-label">Permission</div>
                  {PROJECT_ROLES.map((r) => (
                    <div key={r}>{ROLE_LABEL[r]}</div>
                  ))}
                </div>
                {PROJECT_PERMISSION_MATRIX.map((p) => (
                  <div className="matrix-row" key={p.permission}>
                    <div className="matrix-label">
                      <span>{p.label}</span>
                      <span className="small weak">{p.description}</span>
                    </div>
                    {PROJECT_ROLES.map((r) => (
                      <div key={r} className="matrix-cell">
                        {projectMatrixValue(r, p.permission) ? (
                          <Icon name="check" size={14} style={{ color: "var(--color-success-text)" }} />
                        ) : (
                          <span className="matrix-dash">—</span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <p className="small weak" style={{ marginTop: 12, maxWidth: 720 }}>
                Admins get owner access to every project. Guests only see projects they are invited to
                and default to viewer. AI teammates never inherit workspace powers.
              </p>
            </>
          )}

          {tab === "invites" && (
            <>
              <div className="stat-card" style={{ gap: 10 }}>
                <h4>Invite someone</h4>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <RoleSelect
                    value={role}
                    options={["member", "guest", "admin"]}
                    onChange={(v) => setRole(v as typeof role)}
                  />
                  <select className="input" style={{ width: 190, height: 28, fontSize: 12 }} value={scopeProject} onChange={(e) => setScopeProject(e.target.value)}>
                    <option value="">No project access</option>
                    {state.projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    disabled={!email.includes("@")}
                    onClick={() => {
                      dispatch({
                        type: "invite/create",
                        email: email.trim(),
                        role,
                        projectIds: scopeProject ? [scopeProject] : [],
                      });
                      setEmail("");
                      toast("Invitation sent");
                    }}
                  >
                    Send invite
                  </button>
                </div>
                <span className="small weak">
                  Guests only get the projects you list. Everything else stays invisible to them.
                </span>
              </div>

              <div style={{ marginTop: 16 }}>
                <div className="list-head" style={{ borderRadius: 6 }}>
                  <div className="col" style={{ flex: 1 }}>Email</div>
                  <div className="col" style={{ width: 120 }}>Role</div>
                  <div className="col" style={{ width: 150 }}>Projects</div>
                  <div className="col" style={{ width: 110 }}>Status</div>
                  <div className="col" style={{ width: 120 }}>Sent</div>
                  <div className="col" style={{ width: 150 }} />
                </div>
                {state.invites.length === 0 && <div className="small weak" style={{ padding: 12 }}>No invitations yet.</div>}
                {state.invites.map((inv) => (
                  <div key={inv.id} className="row" style={{ gap: 8, padding: "10px", borderBottom: "1px solid var(--color-border)" }}>
                    <span className="grow truncate">{inv.email}</span>
                    <span style={{ width: 120 }} className="small">{ROLE_LABEL[inv.role]}</span>
                    <span style={{ width: 150 }} className="small weak truncate">
                      {inv.projectIds.map((id) => state.projects.find((p) => p.id === id)?.name).join(", ") || "—"}
                    </span>
                    <span style={{ width: 110 }}>
                      <span className={`status-pill ${inv.status === "accepted" ? "status-on-track" : inv.status === "revoked" ? "status-off-track" : "status-on-hold"}`}>
                        {inv.status}
                      </span>
                    </span>
                    <span style={{ width: 120 }} className="small weak">{relativeTime(inv.createdAt)}</span>
                    <div className="row" style={{ width: 150, gap: 6 }}>
                      {inv.status === "sent" && (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => dispatch({ type: "invite/accept", id: inv.id })}>
                            Accept
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: "invite/revoke", id: inv.id })}>
                            Revoke
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "audit" && <AuditLog />}
          {tab === "security" && <SecurityPanel />}

          {tab === "access" && (
            <div style={{ display: "flex", gap: 20 }}>
              <div style={{ width: 250, minWidth: 250 }} className="col">
                <div className="small weak" style={{ marginBottom: 6 }}>Projects</div>
                {state.projects.map((p) => (
                  <button
                    key={p.id}
                    className={`side-item${openProject === p.id ? " active" : ""}`}
                    onClick={() => setOpenProject(p.id)}
                  >
                    <span className="side-icon">
                      <span className="swatch" style={{ background: swatchBg(p.color) }} />
                    </span>
                    <span className="side-label">{p.name}</span>
                    <span className="side-count">{p.memberIds.length}</span>
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {project && (
                  <>
                    <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                      <span style={{ fontWeight: 500 }}>{project.name}</span>
                      <span className="chip">
                        <Icon name={project.privacy === "private" ? "lock" : "globe"} size={11} />
                        {project.privacy}
                      </span>
                      <div style={{ flex: 1 }} />
                      <button className="btn btn-secondary btn-sm" onClick={(e) => addMemberPop.openAt(e.currentTarget)}>
                        <Icon name="plus" size={12} /> Add member
                      </button>
                    </div>
                    <div className="list-head" style={{ borderRadius: 6 }}>
                      <div className="col" style={{ flex: 1 }}>Member</div>
                      <div className="col" style={{ width: 150 }}>Project role</div>
                      <div className="col" style={{ width: 160 }}>Effective access</div>
                      <div className="col" style={{ width: 70 }} />
                    </div>
                    {project.memberIds.map((id) => {
                      const u = userById(id);
                      if (!u) return null;
                      const explicit = project.roles?.[id];
                      const effective = effectiveProjectRole(state, project, id);
                      return (
                        <div key={id} className="row" style={{ gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--color-border)" }}>
                          <div className="row grow" style={{ gap: 8 }}>
                            <Avatar user={u} size={24} />
                            <span className="truncate">{u.name}</span>
                            {u.isAgent && <span className="ai-badge">AI</span>}
                          </div>
                          <div style={{ width: 150 }}>
                            <RoleSelect
                              value={explicit ?? (u.isAgent ? "editor" : "editor")}
                              options={PROJECT_ROLES}
                              onChange={(v) =>
                                dispatch({ type: "project/setRole", projectId: project.id, userId: id, role: v as ProjectRole })
                              }
                            />
                          </div>
                          <div className="small weak" style={{ width: 160 }}>
                            {effective ? ROLE_LABEL[effective] : "no access"}
                          </div>
                          <div style={{ width: 70 }}>
                            <button
                              className="icon-btn sm"
                              title="Remove from project"
                              onClick={() => dispatch({ type: "project/removeMember", projectId: project.id, userId: id })}
                            >
                              <Icon name="close" size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    <p className="small weak" style={{ marginTop: 10 }}>
                      People without an explicit role fall back to: admins → owner, guests → no access,
                      members on public projects → editor.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {addMemberPop.open && addMemberPop.anchor && project && (
        <Popover anchor={addMemberPop.anchor} onClose={addMemberPop.close} width={280} align="end">
          {state.users
            .filter((u) => !project.memberIds.includes(u.id))
            .map((u) => (
              <MenuItem
                key={u.id}
                icon={<Avatar user={u} size={20} />}
                onClick={() => {
                  dispatch({ type: "project/setRole", projectId: project.id, userId: u.id, role: "editor" });
                  addMemberPop.close();
                }}
              >
                {u.name}
              </MenuItem>
            ))}
          <div className="menu-label">Already in the project: {project.memberIds.length}</div>
        </Popover>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ audit log */
type AuditFilter = "all" | "denied" | "access" | "impersonation" | "deletions";
const AUDIT_FILTERS: [AuditFilter, string][] = [
  ["all", "All events"],
  ["denied", "Blocked attempts"],
  ["access", "Roles & access"],
  ["impersonation", "View as"],
  ["deletions", "Deletions"],
];

function matchesAudit(filter: AuditFilter, action: string, outcome: string) {
  switch (filter) {
    case "denied":
      return outcome === "denied";
    case "access":
      return /setRole|Member|invite|agent\//.test(action) || action === "project/update";
    case "impersonation":
      return action === "impersonate";
    case "deletions":
      return /delete/.test(action);
    default:
      return true;
  }
}

function AuditLog() {
  const { state, userById } = useApp();
  const [filter, setFilter] = useState<AuditFilter>("all");
  const rows = state.auditLog.filter((e) => matchesAudit(filter, e.action, e.outcome));
  const denied = state.auditLog.filter((e) => e.outcome === "denied").length;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {AUDIT_FILTERS.map(([key, label]) => (
          <button
            key={key}
            className={`chip${filter === key ? " active" : ""}`}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
            {key === "denied" && denied > 0 && <span className="audit-count">{denied}</span>}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span className="small weak">
          Role changes, sharing, deletions, approvals, “View as” sessions and blocked attempts. Kept on this device, newest first.
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon="lock"
          title={state.auditLog.length ? "Nothing matches this filter" : "No security events yet"}
          description="Changing a role, sharing a project or using “View as” will show up here."
        />
      ) : (
        <div className="audit-list" role="table" aria-label="Audit log">
          {rows.map((e) => {
            const actor = userById(e.actorId);
            const via = e.viaId ? userById(e.viaId) : null;
            return (
              <div key={e.id} className={`audit-row ${e.outcome}`} role="row">
                <Avatar user={actor} size={24} />
                <div className="col grow" style={{ minWidth: 0 }} role="cell">
                  <span className="truncate">
                    <b>{actor?.name ?? "Unknown"}</b> {e.detail.charAt(0).toLowerCase() + e.detail.slice(1)}
                  </span>
                  {via && <span className="small weak">via {via.name}'s “View as” session</span>}
                </div>
                <span className={`audit-outcome ${e.outcome}`} role="cell">
                  {e.outcome === "denied" ? "Blocked" : "Allowed"}
                </span>
                <time className="small weak" dateTime={e.at} title={new Date(e.at).toLocaleString()} role="cell">
                  {relativeTime(e.at)}
                </time>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------- view as (reason) */
function ViewAsButton({ userId, name }: { userId: string; name: string }) {
  const { dispatch, toast, state } = useApp();
  const pop = usePopover();
  const [reason, setReason] = useState("");
  const minutes = state.security?.impersonationMinutes ?? 30;
  return (
    <>
      <button className="btn btn-ghost btn-sm" title="View the workspace as this person" onClick={(e) => pop.openAt(e.currentTarget)}>
        View as
      </button>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={300} align="end">
          <form
            className="col"
            style={{ gap: 8, padding: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length < 3) return;
              dispatch({ type: "impersonate", userId, reason: reason.trim() });
              toast(`Viewing as ${name} for up to ${minutes} minutes`);
              pop.close();
            }}
          >
            <b className="small">Why are you viewing as {name.split(" ")[0]}?</b>
            <input
              className="input"
              autoFocus
              placeholder="e.g. Support ticket 4821"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <span className="small weak">
              Recorded in the audit log and shared with {name.split(" ")[0]}. Ends automatically after {minutes} minutes.
            </span>
            <button className="btn btn-primary btn-sm" type="submit" disabled={reason.trim().length < 3}>
              Start viewing
            </button>
          </form>
        </Popover>
      )}
    </>
  );
}

/* ---------------------------------------------------- security & data (IT) */
function SecurityPanel() {
  const { state, dispatch, toast, mode, api, can, resetWorkspace } = useApp();
  const policy = state.security;
  const [domains, setDomains] = useState(policy.inviteDomains.join(", "));
  const fileRef = React.useRef<HTMLInputElement>(null);
  const isOwner = can("billing:manage");

  const exportBackup = async () => {
    let json: string;
    if (mode === "server") {
      const res = await fetch("/api/export", { credentials: "same-origin" });
      if (!res.ok) return toast("Only admins can export");
      json = await res.text();
    } else {
      json = JSON.stringify(state, null, 2);
    }
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `waypoint-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Backup downloaded");
  };

  const importBackup = async (file: File) => {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return toast("That file isn't a Waypoint backup");
    }
    if (!confirm("Replace the entire workspace with this backup? This can't be undone.")) return;
    if (mode === "server") {
      const r = await api<{ message?: string }>("/api/import", { method: "POST", body: text, headers: { "content-type": "application/json" } });
      toast(r.status === 200 ? "Backup restored" : r.data.message ?? "Import failed");
    } else {
      dispatch({ type: "data/import", state: parsed as typeof state });
      toast("Backup restored");
    }
  };

  return (
    <div className="settings-stack" style={{ padding: 0 }}>
      <section className="stat-card">
        <h4>Security policy</h4>
        <div className="setting-row">
          <div className="col">
            <span style={{ fontWeight: 550 }}>Require two-factor sign-in</span>
            <span className="small weak">Everyone must set up an authenticator app before they can work.</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Require two-factor sign-in"
            aria-checked={policy.requireTwoFactor}
            className={`switch${policy.requireTwoFactor ? " on" : ""}`}
            onClick={() => dispatch({ type: "workspace/security", patch: { requireTwoFactor: !policy.requireTwoFactor } })}
          />
        </div>
        <div className="setting-row">
          <div className="col">
            <span style={{ fontWeight: 550 }}>Session length</span>
            <span className="small weak">Idle sessions sign out after this many hours.</span>
          </div>
          <select
            className="input"
            aria-label="Session length"
            value={policy.sessionHours}
            onChange={(e) => dispatch({ type: "workspace/security", patch: { sessionHours: Number(e.target.value) } })}
          >
            {[1, 4, 8, 12, 24, 72, 168].map((h) => (
              <option key={h} value={h}>
                {h < 24 ? `${h} hours` : `${h / 24} day${h === 24 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div className="col">
            <span style={{ fontWeight: 550 }}>“View as” time limit</span>
            <span className="small weak">Admin impersonation ends automatically.</span>
          </div>
          <select
            className="input"
            aria-label="View as time limit"
            value={policy.impersonationMinutes}
            onChange={(e) => dispatch({ type: "workspace/security", patch: { impersonationMinutes: Number(e.target.value) } })}
          >
            {[5, 15, 30, 60, 120].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div className="col" style={{ flex: 1 }}>
            <span style={{ fontWeight: 550 }}>Allowed invite domains</span>
            <span className="small weak">Only these email domains can be invited. Leave empty to allow any.</span>
          </div>
          <form
            className="row"
            style={{ gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              dispatch({ type: "workspace/security", patch: { inviteDomains: domains.split(/[,\s]+/).filter(Boolean) } });
              toast("Invite domains saved");
            }}
          >
            <input className="input" aria-label="Allowed invite domains" placeholder="northwind.co" value={domains} onChange={(e) => setDomains(e.target.value)} />
            <button className="btn btn-secondary btn-sm" type="submit">
              Save
            </button>
          </form>
        </div>
      </section>

      <section className="stat-card">
        <h4>Signed-in sessions</h4>
        {mode === "server" ? (
          <SessionsList all />
        ) : (
          <p className="small weak">Sessions are managed by the Waypoint server. Run <code>npm run server</code> to enable sign-in.</p>
        )}
      </section>

      <section className="stat-card">
        <h4>Backups</h4>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" onClick={exportBackup}>
            <Icon name="download" size={13} /> Download backup (JSON)
          </button>
          {isOwner && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                <Icon name="refresh" size={13} /> Restore from backup…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importBackup(f);
                  e.target.value = "";
                }}
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => confirm("Reset everything to the demo workspace?") && resetWorkspace()}
              >
                Reset to demo data
              </button>
            </>
          )}
        </div>
        <span className="small weak">
          Backups include projects, tasks, comments, goals and settings — never passwords or sessions. Restoring replaces the workspace for everyone and is recorded in the audit log.
        </span>
      </section>
    </div>
  );
}
