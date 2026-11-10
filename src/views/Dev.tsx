import React, { useMemo, useState } from "react";
import { useApp } from "../core/store";
import type { ID, Ticket, TicketStatus } from "../core/types";
import { navigate } from "../core/router";
import { relativeTime, swatchBg } from "../core/utils";
import { Icon } from "../ui/icons";
import {
  Avatar,
  AvatarStack,
  DatePicker,
  MenuItem,
  Popover,
  PriorityPill,
  UserPicker,
  usePopover,
} from "../ui/primitives";

const COLUMNS: { key: TicketStatus; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "Ready" },
  { key: "in-progress", label: "In progress" },
  { key: "review", label: "In review" },
  { key: "done", label: "Done" },
];

function StatusPill({ status }: { status: AgentSessionStatus | TicketStatus }) {
  const map: Record<string, string> = {
    backlog: "status-on-hold",
    todo: "status-on-hold",
    "in-progress": "status-on-track",
    review: "status-at-risk",
    done: "status-on-track",
    running: "status-on-track",
    waiting: "status-at-risk",
    failed: "status-off-track",
  };
  return <span className={`status-pill ${map[status] ?? "status-on-hold"}`}>{status.replace("-", " ")}</span>;
}
type AgentSessionStatus = "running" | "waiting" | "done" | "failed";

function SessionTrace({ sessionId }: { sessionId: ID }) {
  const { state, dispatch } = useApp();
  const session = state.agentSessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const agent = state.users.find((u) => u.id === session.teammateId);
  return (
    <div className="stat-card" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <Avatar user={agent} size={24} />
        <span style={{ fontWeight: 500 }} className="grow truncate">
          {session.title}
        </span>
        <StatusPill status={session.status} />
      </div>
      <div className="small weak">
        {session.prompt}
      </div>
      <div className="col" style={{ gap: 2 }}>
        {session.steps.map((step, i) => (
          <div className="run-step" key={step.id}>
            <span className={`run-dot${step.at ? " done" : i === session.steps.findIndex((s) => !s.at) ? " active" : ""}`}>
              {step.at ? <Icon name="check" size={10} /> : i + 1}
            </span>
            <span style={step.at ? undefined : { color: "var(--color-text-weak)" }}>
              {step.label}
              {step.detail && <span className="small weak"> — {step.detail}</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="row small weak" style={{ gap: 12 }}>
        <span>{Math.round(session.durationSec / 60)}m {session.durationSec % 60}s</span>
        <span>{session.tokens.toLocaleString()} tokens</span>
        {session.status === "running" && (
          <>
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: "session/stop", id: session.id })}>
              Stop
            </button>
          </>
        )}
      </div>
      {session.artifacts.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {session.artifacts.map((a) => (
            <span className="chip" key={a.name} style={{ height: 22 }}>
              <Icon name={a.kind === "test" ? "check-circle" : a.kind === "doc" ? "files" : "link"} size={11} />
              {a.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TicketPane({ ticketId, onClose }: { ticketId: ID; onClose: () => void }) {
  const { state, dispatch, userById, can } = useApp();
  const ticket = state.tickets.find((t) => t.id === ticketId);
  const [prompt, setPrompt] = useState("Investigate this ticket and propose a fix with tests.");
  const agentPop = usePopover();
  const editable = can("task:edit");
  if (!ticket) return null;
  const space = state.devSpaces.find((s) => s.id === ticket.spaceId);
  const linkedTask = ticket.linkedTaskId ? state.tasks.find((t) => t.id === ticket.linkedTaskId) : null;
  const sessions = state.agentSessions.filter((s) => ticket.agentSessionIds.includes(s.id));
  const agents = state.users.filter((u) => u.isAgent && u.agentStatus === "active");

  return (
    <aside className="pane" style={{ width: 560 }}>
      <div className="pane-header">
        <div className="crumbs">
          <button onClick={() => navigate("/dev")} style={{ color: "inherit" }}>
            {space?.name}
          </button>
          <Icon name="chevron-right" size={11} />
          <span>{ticket.key}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close ticket">
          <Icon name="close" />
        </button>
      </div>
      <div className="pane-body scroll-y">
        <div className="col" style={{ gap: 6 }}>
          <span className="small weak">{ticket.key} · {ticket.sprint}</span>
          <textarea
            className="pane-title"
            rows={2}
            value={ticket.title}
            onChange={(e) => dispatch({ type: "ticket/update", id: ticket.id, patch: { title: e.target.value } })}
            disabled={!editable}
          />
        </div>

        <div className="pane-grid">
          <div className="k"><Icon name="chart" size={13} /> Status</div>
          <div className="v">
            <select
              className="input"
              style={{ height: 30 }}
              value={ticket.status}
              onChange={(e) => dispatch({ type: "ticket/update", id: ticket.id, patch: { status: e.target.value as TicketStatus } })}
            >
              {COLUMNS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="k"><Icon name="person" size={13} /> Assignee</div>
          <div className="v">
            <UserPicker value={ticket.assigneeId} onChange={(id) => dispatch({ type: "ticket/update", id: ticket.id, patch: { assigneeId: id } })}>
              {(open) => (
                <button className="field-hover" onClick={(e) => open(e.currentTarget)}>
                  <Avatar user={userById(ticket.assigneeId)} size={22} />
                  {userById(ticket.assigneeId)?.name ?? <span className="weak">Unassigned</span>}
                </button>
              )}
            </UserPicker>
          </div>
          <div className="k"><Icon name="flag" size={13} /> Priority</div>
          <div className="v">
            <select
              className="input"
              style={{ height: 30, width: 140 }}
              value={ticket.priority ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "ticket/update",
                  id: ticket.id,
                  patch: { priority: (e.target.value || null) as Ticket["priority"] },
                })
              }
            >
              <option value="">None</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="k"><Icon name="chart" size={13} /> Points</div>
          <div className="v">
            <input
              className="input"
              type="number"
              style={{ height: 30, width: 90 }}
              value={ticket.storyPoints ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "ticket/update",
                  id: ticket.id,
                  patch: { storyPoints: e.target.value ? Number(e.target.value) : null },
                })
              }
            />
          </div>
        </div>

        <div className="divider" />
        <div className="pane-section-title">Description</div>
        <textarea
          className="textarea"
          rows={5}
          value={ticket.description}
          onChange={(e) => dispatch({ type: "ticket/update", id: ticket.id, patch: { description: e.target.value } })}
        />

        {linkedTask && (
          <>
            <div className="divider" />
            <div className="pane-section-title">Linked work</div>
            <button
              className="row"
              style={{ gap: 8, textAlign: "left" }}
              onClick={() => navigate(`/task/${linkedTask.id}`)}
            >
              <Icon name="check-circle" size={13} />
              <span className="grow truncate">{linkedTask.name}</span>
              <Avatar user={userById(linkedTask.assigneeId)} size={20} />
            </button>
          </>
        )}

        <div className="divider" />
        <div className="row">
          <div className="pane-section-title">
            <Icon name="sparkle" size={14} /> Agent sessions
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary btn-sm" onClick={(e) => agentPop.openAt(e.currentTarget)}>
            <Icon name="sparkle" size={12} /> Start a session
          </button>
        </div>
        <textarea
          className="textarea"
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should the teammate do?"
        />
        {sessions.length === 0 && (
          <span className="small weak">No agent has worked this ticket yet.</span>
        )}
        {sessions.map((s) => (
          <SessionTrace key={s.id} sessionId={s.id} />
        ))}
      </div>
      {agentPop.open && agentPop.anchor && (
        <Popover anchor={agentPop.anchor} onClose={agentPop.close} width={280} align="end">
          {agents.length === 0 && <div className="menu-label">No active teammates</div>}
          {agents.map((agent) => (
            <MenuItem
              key={agent.id}
              icon={<Icon name="sparkle" size={13} />}
              onClick={() => {
                dispatch({
                  type: "session/start",
                  teammateId: agent.id,
                  ticketId: ticket.id,
                  taskId: ticket.linkedTaskId,
                  prompt,
                });
                agentPop.close();
              }}
            >
              {agent.name}
              <span className="right small">{agent.role?.split("·")[1] ?? ""}</span>
            </MenuItem>
          ))}
        </Popover>
      )}
    </aside>
  );
}

export function DevView() {
  const { state, dispatch, userById, can } = useApp();
  const [spaceId, setSpaceId] = useState<ID>(state.devSpaces[0]?.id ?? "");
  const [tab, setTab] = useState<"board" | "releases" | "sessions">("board");
  const [openTicket, setOpenTicket] = useState<ID | null>(null);
  const [dragging, setDragging] = useState<ID | null>(null);
  const space = state.devSpaces.find((s) => s.id === spaceId);
  const tickets = useMemo(
    () => state.tickets.filter((t) => t.spaceId === spaceId),
    [state.tickets, spaceId]
  );
  const sessions = state.agentSessions.filter((s) =>
    tickets.some((t) => t.id === s.ticketId)
  );
  const releases = state.releases.filter((r) => r.spaceId === spaceId);

  return (
    <div className="page" style={{ flexDirection: "row" }}>
      <div
        style={{
          width: 236,
          minWidth: 236,
          borderRight: "1px solid var(--color-border)",
          background: "var(--color-background-medium)",
          padding: 10,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div className="side-group-header" style={{ padding: "2px 6px 6px" }}>
          <span>Spaces</span>
        </div>
        {state.devSpaces.map((s) => (
          <button
            key={s.id}
            className={`side-item${spaceId === s.id ? " active" : ""}`}
            onClick={() => setSpaceId(s.id)}
          >
            <span
              className="mini-project-icon"
              style={{ background: swatchBg(s.color), width: 18, height: 18, fontSize: 9 }}
            >
              {s.key.slice(0, 1)}
            </span>
            <span className="side-label">{s.name}</span>
            <span className="side-count">
              {state.tickets.filter((t) => t.spaceId === s.id && t.status !== "done").length}
            </span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="side-item" onClick={() => navigate("/ai-teammates")}>
          <span className="side-icon"><Icon name="sparkle" size={14} /></span>
          <span className="side-label">AI teammates</span>
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="page-header">
          <div className="page-header-row">
            <h1 className="page-title">
              <Icon name="key" size={20} /> {space?.name ?? "Dev"}
            </h1>
            <span className="chip">{space?.key}</span>
            <div className="page-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => navigate("/dev/settings")} title="Branch naming and release automation">
                <Icon name="settings" size={14} /> Settings
              </button>
              <div className="segmented">
                {(["board", "releases", "sessions"] as const).map((t) => (
                  <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                    {t === "board" ? "Board" : t === "releases" ? "Releases" : "Agent sessions"}
                  </button>
                ))}
              </div>
              {can("task:create") && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    dispatch({ type: "ticket/create", spaceId, title: "New ticket" });
                  }}
                >
                  <Icon name="plus" size={14} /> New ticket
                </button>
              )}
            </div>
          </div>
          <p className="page-subtitle">{space?.description}</p>
        </div>

        {tab === "board" && (
          <div className="page-scroll" style={{ padding: "8px 20px 32px", overflowX: "auto" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minHeight: "100%" }}>
              {COLUMNS.map((col) => {
                const list = tickets.filter((t) => t.status === col.key);
                return (
                  <div
                    key={col.key}
                    className="board-col"
                    style={{
                      background: "var(--color-background-medium)",
                      width: 296,
                      minWidth: 296,
                      maxHeight: "100%",
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const id = e.dataTransfer.getData("text/ticket-id");
                      if (id) dispatch({ type: "ticket/update", id, patch: { status: col.key } });
                      setDragging(null);
                    }}
                  >
                    <div className="board-col-head">
                      <span>{col.label}</span>
                      <span className="count">{tickets.filter((t) => t.status === col.key).length}</span>
                    </div>
                    <div className="board-col-body">
                      {list.map((ticket) => (
                        <div
                          key={ticket.id}
                          className={`card${dragging === ticket.id ? " dragging" : ""}`}
                          style={{ gap: 6 }}
                          draggable
                          onDragStart={(e) => {
                            setDragging(ticket.id);
                            e.dataTransfer.setData("text/ticket-id", ticket.id);
                          }}
                          onClick={() => setOpenTicket(ticket.id)}
                        >
                          <div className="row small weak" style={{ gap: 6 }}>
                            <span className="mono">{ticket.key}</span>
                            {ticket.agentSessionIds.length > 0 && (
                              <span className="ai-badge" style={{ height: 15, fontSize: 9 }}>
                                <Icon name="sparkle" size={8} /> agent
                              </span>
                            )}
                          </div>
                          <div className="card-title" style={{ fontSize: 13 }}>{ticket.title}</div>
                          <div className="card-meta">
                            {ticket.priority && <PriorityPill priority={ticket.priority} />}
                            {ticket.storyPoints != null && <span className="chip" style={{ height: 18 }}>{ticket.storyPoints} pts</span>}
                            <div style={{ flex: 1 }} />
                            <Avatar user={userById(ticket.assigneeId)} size={18} />
                          </div>
                        </div>
                      ))}
                      {list.length === 0 && <div className="small weak" style={{ padding: 6 }}>Empty</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "releases" && (
          <div className="page-scroll">
            <div style={{ padding: "8px 24px 48px", maxWidth: 900 }}>
              {releases.map((rel) => {
                const relTickets = state.tickets.filter((t) => rel.ticketIds.includes(t.id));
                const done = relTickets.filter((t) => t.status === "done").length;
                return (
                  <div key={rel.id} className="stat-card" style={{ marginBottom: 12 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <Icon name="rocket" size={15} />
                      <span style={{ fontWeight: 500 }}>{rel.name}</span>
                      <span className="chip" style={{ height: 20 }}>{rel.version}</span>
                      <span className={`status-pill ${rel.status === "shipped" || rel.status === "ready" ? "status-on-track" : rel.status === "in-progress" ? "status-at-risk" : "status-on-hold"}`}>
                        {rel.status}
                      </span>
                      <div style={{ flex: 1 }} />
                      <span className="small weak">{rel.date}</span>
                      {rel.status !== "shipped" && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => dispatch({ type: "release/update", id: rel.id, patch: { status: "shipped" } })}
                        >
                          Mark shipped
                        </button>
                      )}
                    </div>
                    <div className="row small weak" style={{ gap: 8 }}>
                      <span>{done}/{relTickets.length} tickets done</span>
                      <div className="bar-track" style={{ maxWidth: 220 }}>
                        <div className="bar-fill" style={{ width: `${relTickets.length ? (done / relTickets.length) * 100 : 0}%` }} />
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {relTickets.map((t) => (
                        <button key={t.id} className="chip" onClick={() => { setTab("board"); setOpenTicket(t.id); }}>
                          {t.key}
                        </button>
                      ))}
                      <div style={{ flex: 1 }} />
                      <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: "release/generateNotes", id: rel.id })}>
                        <Icon name="sparkle" size={13} /> {rel.notes ? "Regenerate notes" : "Generate release notes"}
                      </button>
                    </div>
                    {rel.notes && <pre className="release-notes">{rel.notes}</pre>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "sessions" && (
          <div className="page-scroll">
            <div style={{ padding: "8px 24px 48px", maxWidth: 860 }}>
              {sessions.length === 0 && <span className="small weak">No agent sessions in this space.</span>}
              {sessions.map((s) => <SessionTrace key={s.id} sessionId={s.id} />)}
            </div>
          </div>
        )}
      </div>

      {openTicket && <TicketPane ticketId={openTicket} onClose={() => setOpenTicket(null)} />}
    </div>
  );
}
