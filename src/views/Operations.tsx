import React, { useMemo, useState } from "react";
import { useApp } from "../core/store";
import type { ClientNote, ClientStage, ID, TableView } from "../core/types";
import { navigate } from "../core/router";
import {
  downloadFile,
  formatDue,
  formatFullDate,
  formatMoney,
  relativeTime,
  swatchBg,
  todayISO,
} from "../core/utils";
import { Icon } from "../ui/icons";
import {
  Avatar,
  AvatarStack,
  EmptyState,
  MenuItem,
  Popover,
  PriorityPill,
  ProgressBar,
  UserPicker,
  usePopover,
} from "../ui/primitives";

/* ============================================================ service desk */
export function ServiceDeskView() {
  const { state, dispatch, userById, can } = useApp();
  const [queueId, setQueueId] = useState<ID>(state.serviceQueues[0]?.id ?? "");
  const [selected, setSelected] = useState<ID | null>(null);
  const [tab, setTab] = useState<"queue" | "knowledge">("queue");
  const queue = state.serviceQueues.find((q) => q.id === queueId);
  const tickets = state.serviceTickets.filter((t) => t.queueId === queueId);
  const open = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
  const breached = open.filter((t) => t.slaDueAt < todayISO());
  const ticket = tickets.find((t) => t.id === selected) ?? null;

  return (
    <div className="page" style={{ flexDirection: "row" }}>
      <div style={{ width: 236, minWidth: 236, borderRight: "1px solid var(--color-border)", background: "var(--color-background-medium)", padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="side-group-header" style={{ padding: "2px 6px 6px" }}>
          <span>Queues</span>
        </div>
        {state.serviceQueues.map((q) => {
          const qOpen = state.serviceTickets.filter((t) => t.queueId === q.id && t.status !== "resolved" && t.status !== "closed").length;
          return (
            <button
              key={q.id}
              className={`side-item${queueId === q.id && tab === "queue" ? " active" : ""}`}
              onClick={() => { setQueueId(q.id); setTab("queue"); }}
            >
              <span className="side-icon"><Icon name="inbox" size={14} /></span>
              <span className="side-label">{q.name}</span>
              <span className="side-count">{qOpen}</span>
            </button>
          );
        })}
        <div className="side-group-header" style={{ padding: "12px 6px 6px" }}>
          <span>Knowledge</span>
        </div>
        <button className={`side-item${tab === "knowledge" ? " active" : ""}`} onClick={() => setTab("knowledge")}>
          <span className="side-icon">
            <Icon name="files" size={14} />
          </span>
          <span className="side-label">Articles</span>
          <span className="side-count">{state.kbArticles.length}</span>
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="page-header">
          <div className="page-header-row">
            <h1 className="page-title">
              <Icon name="help" size={20} /> {tab === "queue" ? queue?.name : "Knowledge base"}
            </h1>
            {tab === "queue" && (
              <span className="chip">
                <Icon name="clock" size={11} /> {queue?.slaHours}h SLA
              </span>
            )}
            <div className="page-actions">
              {tab === "queue" && (
                <button
                  className="btn btn-primary"
                  disabled={!can("task:create")}
                  onClick={() =>
                    dispatch({
                      type: "service/update",
                      id: tickets[0]?.id ?? "",
                      patch: {},
                    })
                  }
                  title="Demo: creating a service ticket uses the intake form"
                  onClickCapture={() => navigate(`/project/${queue?.projectId}/form`)}
                >
                  <Icon name="plus" size={14} /> New request
                </button>
              )}
            </div>
          </div>
          <p className="page-subtitle">
            {tab === "queue"
              ? `${open.length} open · ${breached.length} past SLA · ${tickets.length} total`
              : `${state.kbArticles.length} articles · ${state.kbArticles.reduce((n, a) => n + a.views, 0).toLocaleString()} views`}
          </p>
        </div>

        <div className="page-scroll">
          {tab === "queue" && (
            <div style={{ padding: "8px 24px 48px", maxWidth: 1000 }}>
              <div className="list-head" style={{ borderRadius: 6 }}>
                <div className="col" style={{ width: 84 }}>Ticket</div>
                <div className="col" style={{ flex: 1 }}>Subject</div>
                <div className="col" style={{ width: 110 }}>Requester</div>
                <div className="col" style={{ width: 110 }}>Assignee</div>
                <div className="col" style={{ width: 96 }}>SLA</div>
                <div className="col" style={{ width: 100 }}>Status</div>
              </div>
              {tickets.map((t) => {
                const late = t.slaDueAt < todayISO() && t.status !== "resolved" && t.status !== "closed";
                return (
                  <div
                    key={t.id}
                    className="row"
                    style={{ gap: 8, padding: "10px 10px", borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                    onClick={() => setSelected(t.id)}
                  >
                    <span className="small mono weak" style={{ width: 84 }}>{t.key}</span>
                    <span className="grow truncate" style={{ fontWeight: 500 }}>{t.title}</span>
                    <span style={{ width: 110 }}>
                      <Avatar user={userById(t.requesterId)} size={22} />
                    </span>
                    <span style={{ width: 110 }}>
                      <Avatar user={userById(t.assigneeId)} size={22} />
                    </span>
                    <span className={`small ${late ? "due overdue" : "weak"}`} style={{ width: 96 }}>
                      {late ? "Breached" : formatDue(t.slaDueAt)}
                    </span>
                    <span style={{ width: 100 }}>
                      <span className={`status-pill ${t.status === "resolved" || t.status === "closed" ? "status-on-track" : t.status === "waiting" ? "status-at-risk" : "status-on-hold"}`}>
                        {t.status}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "knowledge" && (
            <div style={{ padding: "8px 24px 48px", maxWidth: 900 }}>
              {state.kbArticles.map((a) => (
                <div key={a.id} className="stat-card" style={{ marginBottom: 10 }}>
                  <div className="row">
                    <Icon name="files" size={14} />
                    <span style={{ fontWeight: 500 }}>{a.title}</span>
                    <div style={{ flex: 1 }} />
                    <span className="small weak">{a.views.toLocaleString()} views</span>
                  </div>
                  <p className="small" style={{ margin: 0, lineHeight: "20px" }}>{a.body}</p>
                  <div className="row" style={{ gap: 6 }}>
                    {a.tags.map((tag) => (
                      <span className="chip" key={tag} style={{ height: 20 }}>#{tag}</span>
                    ))}
                    <div style={{ flex: 1 }} />
                    <span className="small weak">updated {relativeTime(a.updatedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {ticket && (
        <aside className="pane" style={{ width: 520 }}>
          <div className="pane-header">
            <div className="crumbs">
              <span>{queue?.name}</span>
              <Icon name="chevron-right" size={11} />
              <span>{ticket.key}</span>
            </div>
            <button className="icon-btn" onClick={() => setSelected(null)}>
              <Icon name="close" />
            </button>
          </div>
          <div className="pane-body scroll-y">
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{ticket.title}</h2>
            <div className="row" style={{ gap: 8 }}>
              <span className={`status-pill ${ticket.status === "resolved" ? "status-on-track" : ticket.status === "waiting" ? "status-at-risk" : "status-on-hold"}`}>
                {ticket.status}
              </span>
              {ticket.priority && <PriorityPill priority={ticket.priority} />}
              <span className={`small ${ticket.slaDueAt < todayISO() ? "due overdue" : "weak"}`}>
                SLA {formatDue(ticket.slaDueAt)}
              </span>
            </div>
            <div className="pane-grid">
              <div className="k">Requester</div>
              <div className="v">
                <span className="row" style={{ gap: 6 }}>
                  <Avatar user={userById(ticket.requesterId)} size={20} />
                  {userById(ticket.requesterId)?.name}
                </span>
              </div>
              <div className="k">Assignee</div>
              <div className="v">
                <UserPicker value={ticket.assigneeId} onChange={(id) => dispatch({ type: "service/update", id: ticket.id, patch: { assigneeId: id } })}>
                  {(openPicker) => (
                    <button className="field-hover" onClick={(e) => openPicker(e.currentTarget)}>
                      <Avatar user={userById(ticket.assigneeId)} size={20} />
                      {userById(ticket.assigneeId)?.name ?? <span className="weak">Unassigned</span>}
                    </button>
                  )}
                </UserPicker>
              </div>
              <div className="k">Status</div>
              <div className="v">
                <select
                  className="input"
                  style={{ height: 30 }}
                  value={ticket.status}
                  onChange={(e) => dispatch({ type: "service/update", id: ticket.id, patch: { status: e.target.value as typeof ticket.status } })}
                >
                  {["new", "triage", "waiting", "resolved", "closed"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="divider" />
            <div className="pane-section-title">Request</div>
            <p style={{ margin: 0, lineHeight: "21px" }}>{ticket.body}</p>
            <div className="divider" />
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const project = state.projects.find((p) => p.id === queue?.projectId);
                if (!project) return;
                dispatch({
                  type: "task/create",
                  patch: {
                    name: ticket.title,
                    notes: ticket.body,
                    projectId: project.id,
                    assigneeId: ticket.assigneeId ?? state.currentUserId,
                  },
                });
                dispatch({ type: "service/update", id: ticket.id, patch: { status: "triage" } });
              }}
            >
              <Icon name="check-circle" size={13} /> Create task from request
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}

/* ================================================================== agency */
const CLIENT_STAGE_ORDER: ClientStage[] = ["lead", "proposal", "active", "renewal", "churned"];
const CLIENT_STAGE_LABEL: Record<ClientStage, string> = {
  lead: "Lead",
  proposal: "Proposal",
  active: "Active",
  renewal: "Up for renewal",
  churned: "Churned",
};

/** CRM pipeline: clients by stage, ARR per column, stage changes inline. */
function ClientPipeline({ onOpen }: { onOpen: (id: ID) => void }) {
  const { state, dispatch, userById, can } = useApp();
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div className="page-header">
        <div className="page-header-row">
          <h1 className="page-title">
            <Icon name="board" size={20} /> Client pipeline
          </h1>
        </div>
        <p className="page-subtitle">{money(state.clients.reduce((n, c) => n + c.arr, 0))} ARR across {state.clients.length} clients</p>
      </div>
      <div className="board-wrap">
        {CLIENT_STAGE_ORDER.map((stage) => {
          const list = state.clients.filter((c) => (c.stage ?? "active") === stage);
          return (
            <div className="board-col" key={stage}>
              <div className="board-col-head">
                <span>{CLIENT_STAGE_LABEL[stage]}</span>
                <span className="count">{list.length}</span>
                <span className="small weak mono" style={{ marginLeft: "auto" }}>{money(list.reduce((n, c) => n + c.arr, 0))}</span>
              </div>
              <div className="board-col-body">
                {list.map((c) => (
                  <div className="card" key={c.id}>
                    <button className="card-title" onClick={() => onOpen(c.id)}>
                      {c.name}
                    </button>
                    <div className="card-meta">
                      <Avatar user={userById(c.ownerId)} size={20} />
                      <span className="mono">{money(c.arr)}</span>
                      <span className={`status-pill ${c.health === "healthy" ? "status-on-track" : c.health === "watch" ? "status-at-risk" : "status-off-track"}`}>
                        {c.health.replace("-", " ")}
                      </span>
                    </div>
                    <select
                      className="input"
                      aria-label={`Stage for ${c.name}`}
                      value={c.stage ?? "active"}
                      disabled={!can("task:edit")}
                      onChange={(e) => dispatch({ type: "client/update", id: c.id, patch: { stage: e.target.value as ClientStage } })}
                    >
                      {CLIENT_STAGE_ORDER.map((st) => (
                        <option key={st} value={st}>
                          Move to {CLIENT_STAGE_LABEL[st]}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AgencyView() {
  const { state, dispatch, userById, can } = useApp();
  const [clientId, setClientId] = useState<ID>(state.clients[0]?.id ?? "");
  const [tab, setTab] = useState<"overview" | "contacts" | "portals" | "activity">("overview");
  const [board, setBoard] = useState(false);
  const [noteKind, setNoteKind] = useState<ClientNote["kind"]>("note");
  const [noteText, setNoteText] = useState("");
  const client = state.clients.find((c) => c.id === clientId);
  const contacts = state.contacts.filter((c) => c.clientId === clientId);
  const portals = state.portals.filter((p) => p.clientId === clientId);
  const projPop = usePopover();
  const [activePortal, setActivePortal] = useState<ID | null>(portals[0]?.id ?? null);

  if (!client) return <div className="page" />;
  const healthClass =
    client.health === "healthy" ? "status-on-track" : client.health === "watch" ? "status-at-risk" : "status-off-track";

  return (
    <div className="page" style={{ flexDirection: "row" }}>
      <div style={{ width: 236, minWidth: 236, borderRight: "1px solid var(--color-border)", background: "var(--color-background-medium)", padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        <button className={`side-item${board ? " active" : ""}`} onClick={() => setBoard(true)}>
          <span className="side-icon">
            <Icon name="board" size={14} />
          </span>
          <span className="side-label">Pipeline</span>
        </button>
        <div className="side-group-header" style={{ padding: "2px 6px 6px" }}>
          <span>Clients</span>
        </div>
        {state.clients.map((c) => (
          <button
            key={c.id}
            className={`side-item${clientId === c.id ? " active" : ""}`}
            onClick={() => { setClientId(c.id); setTab("overview"); setBoard(false); }}
          >
            <span className="side-icon">
              <span className="swatch dot" style={{ background: c.health === "healthy" ? "var(--color-success-background-strong)" : c.health === "watch" ? "var(--swatch-yellow-solid)" : "var(--color-danger-background-strong)" }} />
            </span>
            <span className="side-label">{c.name}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div className="small weak" style={{ padding: 6 }}>
          {state.portals.filter((p) => p.status === "live").length} live portals ·{" "}
          {state.clients.reduce((n, c) => n + c.arr, 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} ARR
        </div>
      </div>

      {board ? (
        <ClientPipeline onOpen={(id) => { setClientId(id); setBoard(false); setTab("overview"); }} />
      ) : (
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="page-header">
          <div className="page-header-row">
            <h1 className="page-title">
              <Icon name="briefcase" size={20} /> {client.name}
            </h1>
            <select
              className="input"
              aria-label="Stage"
              value={client.stage ?? "active"}
              disabled={!can("task:edit")}
              onChange={(e) => dispatch({ type: "client/update", id: client.id, patch: { stage: e.target.value as ClientStage } })}
            >
              {CLIENT_STAGE_ORDER.map((st) => (
                <option key={st} value={st}>
                  {CLIENT_STAGE_LABEL[st]}
                </option>
              ))}
            </select>
            <span className={`status-pill ${healthClass}`}>{client.health.replace("-", " ")}</span>
            <div className="page-actions">
              <span className="chip">{client.industry}</span>
              <span className="chip">
                {client.arr.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} ARR
              </span>
            </div>
          </div>
          <p className="page-subtitle">
            Client since {client.since} · {contacts.length} contacts · {portals.length} portals
          </p>
        </div>

        <div className="tabs" style={{ padding: "8px 24px 0" }}>
          {(["overview", "activity", "contacts", "portals"] as const).map((t) => (
            <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="page-scroll">
          <div style={{ padding: "16px 24px 48px", maxWidth: 1000 }}>
            {tab === "activity" && (
              <div className="col" style={{ gap: 12, maxWidth: 720 }}>
                {can("task:edit") && (
                  <form
                    className="composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!noteText.trim()) return;
                      dispatch({ type: "clientNote/add", clientId: client.id, kind: noteKind, text: noteText });
                      setNoteText("");
                    }}
                  >
                    <div className="input-wrap">
                      <textarea
                        placeholder={`Log a ${noteKind} with ${client.name}…`}
                        value={noteText}
                        maxLength={10000}
                        onChange={(e) => setNoteText(e.target.value)}
                      />
                      <div className="composer-tools">
                        <select className="input" aria-label="Kind" value={noteKind} onChange={(e) => setNoteKind(e.target.value as ClientNote["kind"])}>
                          <option value="note">Note</option>
                          <option value="call">Call</option>
                          <option value="email">Email</option>
                          <option value="meeting">Meeting</option>
                        </select>
                        <div style={{ flex: 1 }} />
                        <button className="btn btn-primary btn-sm" type="submit" disabled={!noteText.trim()}>
                          Log activity
                        </button>
                      </div>
                    </div>
                  </form>
                )}
                {state.clientNotes.filter((n) => n.clientId === client.id).length === 0 && (
                  <span className="small weak">No activity logged yet.</span>
                )}
                {state.clientNotes
                  .filter((n) => n.clientId === client.id)
                  .map((n) => (
                    <div className="comment" key={n.id}>
                      <Avatar user={userById(n.authorId)} size={28} />
                      <div className="comment-body">
                        <div className="comment-head">
                          <span className="comment-author">{userById(n.authorId)?.name}</span>
                          <span className="chip" style={{ height: 18 }}>{n.kind}</span>
                          <span>{relativeTime(n.createdAt)}</span>
                          {(n.authorId === state.currentUserId || can("workspace:admin")) && (
                            <button className="icon-btn sm" aria-label="Delete activity" onClick={() => dispatch({ type: "clientNote/delete", id: n.id })}>
                              <Icon name="trash" size={12} />
                            </button>
                          )}
                        </div>
                        <div className="comment-text">{n.text}</div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
            {tab === "overview" && (
              <div className="grid-cards" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                <div className="stat-card">
                  <h4>Engagements</h4>
                  {portals.map((p) => (
                    <div key={p.id} className="row" style={{ gap: 8, padding: "5px 0" }}>
                      <span className="grow truncate">{p.name}</span>
                      <span className={`status-pill ${p.status === "live" ? "status-on-track" : "status-on-hold"}`}>{p.status}</span>
                    </div>
                  ))}
                </div>
                <div className="stat-card">
                  <h4>Team</h4>
                  <AvatarStack users={["u-maya", "u-jordan", "u-priya"].map((id) => userById(id))} size={26} />
                  <span className="small weak">Agency pod for this account</span>
                </div>
                <div className="stat-card">
                  <h4>Primary contact</h4>
                  {contacts.filter((c) => c.primary).map((c) => (
                    <div key={c.id} className="col">
                      <span style={{ fontWeight: 500 }}>{c.name}</span>
                      <span className="small weak">{c.title}</span>
                      <span className="small weak">{c.email}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "contacts" && (
              <div>
                <div className="list-head" style={{ borderRadius: 6 }}>
                  <div className="col" style={{ flex: 1 }}>Contact</div>
                  <div className="col" style={{ width: 200 }}>Email</div>
                  <div className="col" style={{ width: 160 }}>Title</div>
                  <div className="col" style={{ width: 90 }}>Access</div>
                </div>
                {contacts.map((c) => (
                  <div key={c.id} className="row" style={{ gap: 8, padding: "10px", borderBottom: "1px solid var(--color-border)" }}>
                    <span className="grow">{c.name}</span>
                    <span className="small weak" style={{ width: 200 }}>{c.email}</span>
                    <span className="small weak" style={{ width: 160 }}>{c.title}</span>
                    <span style={{ width: 90 }}>
                      <span className="chip" style={{ height: 20 }}>{c.primary ? "Admin" : "Guest"}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {tab === "portals" && (
              <div style={{ display: "flex", gap: 20 }}>
                <div style={{ flex: 1 }}>
                  {portals.map((p) => (
                    <button
                      key={p.id}
                      className={`agent-card${activePortal === p.id ? " selected" : ""}`}
                      style={{ marginBottom: 10, borderColor: activePortal === p.id ? "var(--color-selected-border)" : undefined }}
                      onClick={() => setActivePortal(p.id)}
                    >
                      <div className="row">
                        <Icon name="globe" size={14} />
                        <span style={{ fontWeight: 500 }}>{p.name}</span>
                        <div style={{ flex: 1 }} />
                        <span className={`status-pill ${p.status === "live" ? "status-on-track" : "status-on-hold"}`}>{p.status}</span>
                      </div>
                      <div className="row small weak" style={{ gap: 8 }}>
                        <span>{p.projectIds.length} projects shared</span>
                        <span>·</span>
                        <span>published {relativeTime(p.lastPublishedAt)}</span>
                      </div>
                    </button>
                  ))}
                  {portals.length === 0 && <span className="small weak">No portals for this client.</span>}
                </div>
                <div style={{ width: 320 }}>
                  {portals
                    .filter((p) => p.id === activePortal)
                    .map((p) => (
                      <div className="stat-card" key={p.id}>
                        <h4>{p.name}</h4>
                        <div className="small weak">Shared projects</div>
                        {p.projectIds.map((id) => {
                          const project = state.projects.find((x) => x.id === id);
                          return (
                            <div key={id} className="row small" style={{ gap: 6, padding: "3px 0" }}>
                              <span className="swatch" style={{ background: swatchBg(project?.color) }} />
                              <span className="grow truncate">{project?.name}</span>
                            </div>
                          );
                        })}
                        <button className="btn btn-secondary btn-sm" onClick={(e) => projPop.openAt(e.currentTarget)}>
                          <Icon name="plus" size={12} /> Add project
                        </button>
                        <div className="divider" />
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={!can("task:create")}
                          onClick={() => dispatch({ type: "portal/publish", id: p.id })}
                        >
                          <Icon name="paper-plane" size={12} /> Publish portal
                        </button>
                        <span className="small weak">
                          Contacts see only the projects listed here — nothing else in the workspace.
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {projPop.open && projPop.anchor && activePortal && (
        <Popover anchor={projPop.anchor} onClose={projPop.close} width={280} align="end">
          {state.projects.map((p) => {
            const portal = state.portals.find((x) => x.id === activePortal);
            return (
              <MenuItem
                key={p.id}
                checked={portal?.projectIds.includes(p.id)}
                onClick={() =>
                  dispatch({ type: "portal/toggleProject", id: activePortal, projectId: p.id })
                }
              >
                <span className="swatch" style={{ background: swatchBg(p.color) }} />
                {p.name}
              </MenuItem>
            );
          })}
        </Popover>
      )}
    </div>
  );
}

/* ================================================================== tables */
export function TablesView() {
  const { state, dispatch, userById } = useApp();
  const [tableId, setTableId] = useState<ID>(state.tables[0]?.id ?? "");
  const table = state.tables.find((t) => t.id === tableId);
  const [editing, setEditing] = useState<string | null>(null);
  const blankView = (): TableView => ({ id: "all", name: "All records", filters: {}, sortField: null, sortDir: "asc", hiddenFieldIds: [], groupBy: null });
  const [view, setView] = useState<TableView>(blankView);
  const [filterField, setFilterField] = useState<ID>("");
  const fieldsPop = usePopover();

  if (!table) return <div className="page" />;

  const display = (fid: ID, raw: string) => {
    const f = table.fields.find((x) => x.id === fid);
    return f?.type === "people" ? userById(raw)?.name ?? "" : raw;
  };
  const visibleFields = table.fields.filter((f) => !view.hiddenFieldIds.includes(f.id));
  const records = table.records
    .filter((r) =>
      Object.entries(view.filters).every(([fid, q]) => !q || display(fid, r.values[fid] ?? "").toLowerCase().includes(q.toLowerCase()))
    )
    .sort((x, y) => {
      if (!view.sortField) return 0;
      const f = table.fields.find((ff) => ff.id === view.sortField);
      const a = display(view.sortField, x.values[view.sortField] ?? "");
      const b = display(view.sortField, y.values[view.sortField] ?? "");
      const cmp = f?.type === "number" || f?.type === "currency" ? Number(a || 0) - Number(b || 0) : a.localeCompare(b);
      return view.sortDir === "asc" ? cmp : -cmp;
    });
  const groups: [string, typeof records][] = view.groupBy
    ? Array.from(
        records.reduce((m, r) => {
          const k = display(view.groupBy as ID, r.values[view.groupBy as ID] ?? "") || "—";
          (m.get(k) ?? m.set(k, []).get(k)!).push(r);
          return m;
        }, new Map<string, typeof records>())
      )
    : [["", records]];
  const views = table.views ?? [];
  const dirty = view.id === "all" ? JSON.stringify({ ...view, id: "", name: "" }) !== JSON.stringify({ ...blankView(), id: "", name: "" }) : JSON.stringify(view) !== JSON.stringify(views.find((v) => v.id === view.id));

  const exportCsv = () => {
    const header = table.fields.map((f) => f.name).join(",");
    const rows = table.records.map((r) =>
      table.fields
        .map((f) => {
          const v = r.values[f.id] ?? "";
          if (f.type === "people") return userById(v)?.name ?? "";
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(",")
    );
    downloadFile(`${table.name.replace(/\s+/g, "-").toLowerCase()}.csv`, [header, ...rows].join("\n"), "text/csv");
  };

  return (
    <div className="page" style={{ flexDirection: "row" }}>
      <div style={{ width: 220, minWidth: 220, borderRight: "1px solid var(--color-border)", background: "var(--color-background-medium)", padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="side-group-header" style={{ padding: "2px 6px 6px" }}><span>Tables</span></div>
        {state.tables.map((t) => (
          <button key={t.id} className={`side-item${tableId === t.id ? " active" : ""}`} onClick={() => setTableId(t.id)}>
            <span className="side-icon"><Icon name={t.icon} size={14} /></span>
            <span className="side-label">{t.name}</span>
            <span className="side-count">{t.records.length}</span>
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="page-header">
          <div className="page-header-row">
            <h1 className="page-title">
              <Icon name={table.icon} size={20} /> {table.name}
            </h1>
            <div className="page-actions">
              <button className="btn btn-secondary" onClick={exportCsv}>
                <Icon name="download" size={13} /> Export CSV
              </button>
              <button className="btn btn-primary" onClick={() => dispatch({ type: "table/recordAdd", tableId: table.id })}>
                <Icon name="plus" size={14} /> Add record
              </button>
            </div>
          </div>
          <p className="page-subtitle">
            {table.description} · {records.length === table.records.length ? `${table.records.length} records` : `${records.length} of ${table.records.length} records`}
          </p>
          <div className="tabs" style={{ padding: "10px 0 0" }}>
            {[blankView(), ...views].map((v) => (
              <button key={v.id} className={`tab${view.id === v.id ? " active" : ""}`} onClick={() => setView({ ...v })}>
                {v.name}
              </button>
            ))}
          </div>
          <div className="row table-toolbar">
            <select className="input" aria-label="Filter field" value={filterField} onChange={(e) => setFilterField(e.target.value)}>
              <option value="">Filter by…</option>
              {table.fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {filterField && (
              <input
                className="input"
                aria-label="Filter value"
                placeholder="contains…"
                value={view.filters[filterField] ?? ""}
                onChange={(e) => setView({ ...view, filters: { ...view.filters, [filterField]: e.target.value } })}
              />
            )}
            {Object.entries(view.filters)
              .filter(([, q]) => q)
              .map(([fid, q]) => (
                <button key={fid} className="chip active" onClick={() => { const f = { ...view.filters }; delete f[fid]; setView({ ...view, filters: f }); }}>
                  {table.fields.find((f) => f.id === fid)?.name}: {q} <Icon name="close" size={10} />
                </button>
              ))}
            <select className="input" aria-label="Sort by" value={view.sortField ?? ""} onChange={(e) => setView({ ...view, sortField: e.target.value || null })}>
              <option value="">No sort</option>
              {table.fields.map((f) => (
                <option key={f.id} value={f.id}>
                  Sort: {f.name}
                </option>
              ))}
            </select>
            {view.sortField && (
              <button className="chip" onClick={() => setView({ ...view, sortDir: view.sortDir === "asc" ? "desc" : "asc" })}>
                <Icon name="sort" size={11} /> {view.sortDir === "asc" ? "Ascending" : "Descending"}
              </button>
            )}
            <select className="input" aria-label="Group by" value={view.groupBy ?? ""} onChange={(e) => setView({ ...view, groupBy: e.target.value || null })}>
              <option value="">No grouping</option>
              {table.fields
                .filter((f) => f.type === "select" || f.type === "people" || f.type === "text")
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    Group: {f.name}
                  </option>
                ))}
            </select>
            <button className="chip" onClick={(e) => fieldsPop.openAt(e.currentTarget)}>
              <Icon name="eye" size={11} /> Fields{view.hiddenFieldIds.length ? ` (${view.hiddenFieldIds.length} hidden)` : ""}
            </button>
            <div style={{ flex: 1 }} />
            {dirty && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const name = view.id === "all" ? prompt("Name this view")?.trim() : view.name;
                  if (!name) return;
                  const saved = { ...view, id: view.id === "all" ? `tv-${Date.now().toString(36)}` : view.id, name };
                  dispatch({ type: "table/viewSave", tableId: table.id, view: saved });
                  setView(saved);
                }}
              >
                {view.id === "all" ? "Save as view" : "Save view"}
              </button>
            )}
            {view.id !== "all" && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  dispatch({ type: "table/viewDelete", tableId: table.id, viewId: view.id });
                  setView(blankView());
                }}
              >
                Delete view
              </button>
            )}
          </div>
          {fieldsPop.open && fieldsPop.anchor && (
            <Popover anchor={fieldsPop.anchor} onClose={fieldsPop.close} width={220}>
              {table.fields.map((f) => {
                const hidden = view.hiddenFieldIds.includes(f.id);
                return (
                  <button
                    key={f.id}
                    className="menu-item"
                    aria-pressed={!hidden}
                    onClick={() =>
                      setView({ ...view, hiddenFieldIds: hidden ? view.hiddenFieldIds.filter((x) => x !== f.id) : [...view.hiddenFieldIds, f.id] })
                    }
                  >
                    <Icon name={hidden ? "lock" : "check"} size={13} /> {f.name}
                  </button>
                );
              })}
            </Popover>
          )}
        </div>
        <div className="page-scroll">
          <div style={{ padding: "8px 24px 48px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {visibleFields.map((f) => (
                    <th
                      key={f.id}
                      style={{
                        textAlign: f.type === "number" || f.type === "currency" ? "right" : "left",
                        padding: "10px",
                        borderBottom: "1px solid var(--color-border)",
                        color: "var(--color-text-weak)",
                        fontWeight: 600,
                        fontSize: 10,
                        letterSpacing: "0.09em",
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                        background: "var(--color-background-medium)",
                      }}
                    >
                      {f.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(([groupValue, rows]) => (
                  <React.Fragment key={groupValue || "all"}>
                    {view.groupBy && (
                      <tr className="table-group">
                        <td colSpan={visibleFields.length}>
                          <b>{groupValue}</b> <span className="weak">· {rows.length}</span>
                        </td>
                      </tr>
                    )}
                {rows.map((r) => (
                  <tr key={r.id} className="table-row">
                    {visibleFields.map((f) => {
                      const key = `${r.id}:${f.id}`;
                      const value = r.values[f.id] ?? "";
                      const isEditing = editing === key;
                      return (
                        <td
                          key={f.id}
                          style={{
                            padding: "4px 6px",
                            borderBottom: "1px solid var(--color-border)",
                            verticalAlign: "middle",
                            textAlign:
                              f.type === "number" || f.type === "currency" ? "right" : "left",
                          }}
                          onDoubleClick={() => setEditing(key)}
                        >
                          {isEditing ? (
                            f.type === "select" ? (
                              <select
                                className="input"
                                style={{ height: 28 }}
                                autoFocus
                                value={value}
                                onChange={(e) => {
                                  dispatch({ type: "table/recordUpdate", tableId: table.id, recordId: r.id, fieldId: f.id, value: e.target.value });
                                  setEditing(null);
                                }}
                              >
                                <option value="">—</option>
                                {(f.options ?? []).map((o) => (
                                  <option key={o} value={o}>{o}</option>
                                ))}
                              </select>
                            ) : f.type === "people" ? (
                              <UserPicker
                                value={value || null}
                                onChange={(id) => {
                                  dispatch({ type: "table/recordUpdate", tableId: table.id, recordId: r.id, fieldId: f.id, value: id ?? "" });
                                  setEditing(null);
                                }}
                              >
                                {(open) => (
                                  <button className="input" style={{ height: 28 }} onClick={(e) => open(e.currentTarget)}>
                                    {userById(value)?.name ?? "Select"}
                                  </button>
                                )}
                              </UserPicker>
                            ) : (
                              <input
                                className="input"
                                style={{ height: 28 }}
                                autoFocus
                                type={f.type === "number" || f.type === "currency" ? "number" : f.type === "date" ? "date" : "text"}
                                defaultValue={value}
                                onBlur={(e) => {
                                  dispatch({ type: "table/recordUpdate", tableId: table.id, recordId: r.id, fieldId: f.id, value: e.target.value });
                                  setEditing(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                              />
                            )
                          ) : (
                            <button
                              className="cell-value"
                              style={{ width: "100%", textAlign: "left", minHeight: 26 }}
                              onClick={() => setEditing(key)}
                            >
                              {f.type === "people" ? (
                                <span className="row" style={{ gap: 6 }}>
                                  <Avatar user={userById(value)} size={18} />
                                  {userById(value)?.name ?? <span className="weak">—</span>}
                                </span>
                              ) : f.type === "select" && value ? (
                                <span className="tag-pill" style={{ background: "var(--color-selected-background)", color: "var(--color-selected-text)" }}>{value}</span>
                              ) : f.type === "currency" && value ? (
                                <span className="mono">{formatMoney(value)}</span>
                              ) : f.type === "date" && value ? (
                                <span className="mono">{formatFullDate(value)}</span>
                              ) : value ? (
                                <span className="truncate">{value}</span>
                              ) : (
                                <span className="weak">—</span>
                              )}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            <div className="small weak" style={{ marginTop: 10 }}>
              Click a cell to edit · double-click to focus · changes save immediately
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =================================================================== pages */
export function PagesView() {
  const { state, dispatch, userById } = useApp();
  const [pageId, setPageId] = useState<ID>(state.pages[0]?.id ?? "");
  const page = state.pages.find((p) => p.id === pageId);
  const [filter, setFilter] = useState("");
  const pages = state.pages.filter((p) => p.title.toLowerCase().includes(filter.toLowerCase()));
  const [collapsed, setCollapsed] = useState<Set<ID>>(new Set());
  // select a page right after creating it
  const known = React.useRef(new Set(state.pages.map((p) => p.id)));
  React.useEffect(() => {
    const fresh = state.pages.find((p) => !known.current.has(p.id) && p.authorId === state.currentUserId);
    known.current = new Set(state.pages.map((p) => p.id));
    if (fresh) setPageId(fresh.id);
  }, [state.pages, state.currentUserId]);
  const childrenOf = (parent: ID | null) =>
    state.pages
      .filter((p) => (p.parentId ?? null) === parent)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
  const trail: typeof state.pages = [];
  for (let cur = page; cur; cur = state.pages.find((p) => p.id === cur?.parentId)) {
    trail.unshift(cur);
    if (trail.length > 32) break;
  }
  const renderTree = (parent: ID | null, depth: number): React.ReactNode =>
    childrenOf(parent).map((p) => {
      const kids = childrenOf(p.id);
      const open = !collapsed.has(p.id);
      return (
        <React.Fragment key={p.id}>
          <div className="page-tree-row" style={{ paddingLeft: depth * 14 }}>
            <button
              className={`side-caret${open ? "" : " closed"}`}
              style={{ visibility: kids.length ? "visible" : "hidden" }}
              aria-label={open ? "Collapse" : "Expand"}
              onClick={() => {
                const next = new Set(collapsed);
                open ? next.add(p.id) : next.delete(p.id);
                setCollapsed(next);
              }}
            >
              <Icon name="chevron-down" size={11} />
            </button>
            <button className={`side-item${pageId === p.id ? " active" : ""}`} onClick={() => setPageId(p.id)}>
              <span className="side-icon">
                <Icon name="files" size={14} />
              </span>
              <span className="side-label">{p.title || "Untitled"}</span>
              {p.starred && <Icon name="star" size={11} filled />}
            </button>
            <button
              className="icon-btn sm page-tree-add"
              title="Add a subpage"
              aria-label={`Add a page inside ${p.title || "Untitled"}`}
              onClick={() => {
                dispatch({ type: "page/create", title: "Untitled page", parentId: p.id });
                const next = new Set(collapsed);
                next.delete(p.id);
                setCollapsed(next);
              }}
            >
              <Icon name="plus" size={11} />
            </button>
          </div>
          {open && renderTree(p.id, depth + 1)}
        </React.Fragment>
      );
    });
  const descendants = (id: ID): Set<ID> => {
    const out = new Set<ID>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of state.pages) if (p.parentId && out.has(p.parentId) && !out.has(p.id)) (out.add(p.id), (grew = true));
    }
    return out;
  };

  return (
    <div className="page" style={{ flexDirection: "row" }}>
      <div style={{ width: 250, minWidth: 250, borderRight: "1px solid var(--color-border)", background: "var(--color-background-medium)", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="row">
          <span style={{ fontWeight: 500 }}>Pages</span>
          <div style={{ flex: 1 }} />
          <button
            className="icon-btn sm"
            onClick={() => {
              dispatch({ type: "page/create", title: "Untitled page" });
            }}
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
        <input className="input" style={{ height: 28 }} placeholder="Search pages" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {filter
          ? pages.map((p) => (
              <button key={p.id} className={`side-item${pageId === p.id ? " active" : ""}`} onClick={() => setPageId(p.id)}>
                <span className="side-icon"><Icon name="files" size={14} /></span>
                <span className="side-label">{p.title || "Untitled"}</span>
                {p.starred && <Icon name="star" size={11} filled />}
              </button>
            ))
          : renderTree(null, 0)}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {!page && <EmptyState icon="files" title="No page selected" description="Create a page to capture decisions and context." />}
        {page && (
          <>
            <div className="page-header">
              <div className="row" style={{ gap: 8 }}>
                <nav className="page-trail small" aria-label="Page location">
                  <span className="weak">{state.projects.find((p) => p.id === page.projectId)?.name ?? "Workspace"}</span>
                  {trail.map((p) => (
                    <React.Fragment key={p.id}>
                      <Icon name="chevron-right" size={10} />
                      <button className={p.id === page.id ? "" : "weak"} onClick={() => setPageId(p.id)}>
                        {p.title || "Untitled"}
                      </button>
                    </React.Fragment>
                  ))}
                  <span className="weak">· edited {relativeTime(page.updatedAt)}</span>
                </nav>
                <div style={{ flex: 1 }} />
                <select
                  className="input"
                  aria-label="Move page"
                  value={page.parentId ?? ""}
                  onChange={(e) => dispatch({ type: "page/move", id: page.id, parentId: e.target.value || null })}
                  title="Move this page"
                >
                  <option value="">Top level</option>
                  {state.pages
                    .filter((p) => !descendants(page.id).has(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        Inside “{p.title || "Untitled"}”
                      </option>
                    ))}
                </select>
                {(page.authorId === state.currentUserId) && (
                  <button
                    className="icon-btn"
                    title="Delete page (subpages move up a level)"
                    aria-label="Delete page"
                    onClick={() => {
                      if (!confirm(`Delete “${page.title || "Untitled"}”? Its subpages move up a level.`)) return;
                      dispatch({ type: "page/delete", id: page.id });
                      setPageId(page.parentId ?? state.pages.find((p) => p.id !== page.id)?.id ?? "");
                    }}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                )}
                <AvatarStack users={page.collaboratorIds.map((id) => userById(id))} size={24} />
                <button
                  className="icon-btn"
                  title={page.starred ? "Unstar" : "Star"}
                  onClick={() => dispatch({ type: "page/update", id: page.id, patch: { starred: !page.starred } })}
                >
                  <Icon name="star" size={15} filled={page.starred} />
                </button>
              </div>
            </div>
            <div className="page-scroll">
              <div style={{ padding: "8px 24px 64px", maxWidth: 760 }}>
                <input
                  className="pane-title"
                  style={{ fontSize: 28, fontWeight: 600, marginBottom: 12 }}
                  value={page.title}
                  onChange={(e) => dispatch({ type: "page/update", id: page.id, patch: { title: e.target.value } })}
                />
                <textarea
                  className="textarea"
                  style={{ minHeight: 420, border: "1px solid transparent", background: "transparent", fontSize: 15, lineHeight: "24px", padding: 0 }}
                  value={page.body}
                  placeholder="Write the page. Supports plain text with markdown-style headings."
                  onChange={(e) => dispatch({ type: "page/update", id: page.id, patch: { body: e.target.value } })}
                />
                <div className="divider" />
                <div className="row small weak" style={{ gap: 10 }}>
                  <span>{page.body.split(/\s+/).filter(Boolean).length} words</span>
                  <span>{page.body.length} characters</span>
                  <span>Draft</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ========================================================= status templates */
export function StatusTemplatesView() {
  const { state, dispatch, toast } = useApp();
  const [projectId, setProjectId] = useState<ID>(state.projects[0]?.id ?? "");
  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <h1 className="page-title">
            <Icon name="align" size={22} /> Status templates
          </h1>
          <div className="page-actions">
            <select className="input" style={{ width: 240 }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="page-subtitle">Reusable status updates with placeholders resolved from the project.</p>
      </div>
      <div className="page-scroll">
        <div style={{ padding: "8px 24px 48px", maxWidth: 900 }}>
          {state.statusTemplates.map((t) => (
            <div key={t.id} className="stat-card" style={{ marginBottom: 12 }}>
              <div className="row">
                <span className={`status-pill status-${t.state}`}>{t.state.replace("-", " ")}</span>
                <span style={{ fontWeight: 500 }}>{t.name}</span>
                <div style={{ flex: 1 }} />
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    dispatch({
                      type: "status/create",
                      projectId,
                      title: t.title,
                      text: t.body,
                      state: t.state,
                    });
                    toast("Status posted from template", "View project", () => navigate(`/project/${projectId}/dashboard`));
                  }}
                >
                  Use template
                </button>
              </div>
              <div style={{ fontWeight: 500 }}>{t.title}</div>
              <div className="small" style={{ whiteSpace: "pre-wrap", lineHeight: "20px" }}>{t.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { MenuItem, Popover };
