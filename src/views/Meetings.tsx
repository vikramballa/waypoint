import React, { useState } from "react";
import { useApp } from "../core/store";
import type { ID } from "../core/types";
import { navigate } from "../core/router";
import { meetingInsight } from "../core/ai";
import { formatDue, formatDateTime, relativeTime } from "../core/utils";
import { Icon } from "../ui/icons";
import { Avatar, EmptyState, MenuItem, Popover, usePopover } from "../ui/primitives";

export function MeetingsView() {
  const { state, dispatch, userById } = useApp();
  const [selected, setSelected] = useState<ID | null>(state.meetings[0]?.id ?? null);
  const meeting = state.meetings.find((m) => m.id === selected) ?? null;
  const projPop = usePopover();

  return (
    <div className="page" style={{ flexDirection: "row" }}>
      <div
        style={{
          width: 280,
          minWidth: 280,
          borderRight: "1px solid var(--color-border)",
          background: "var(--color-background-medium)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="row" style={{ padding: "12px 12px 8px" }}>
          <span style={{ fontWeight: 500 }}>Meetings</span>
          <div style={{ flex: 1 }} />
          <button
            className="icon-btn sm"
            title="Record a meeting"
            onClick={() => {
              const title = prompt("Meeting title", "Weekly sync");
              if (title) {
                dispatch({ type: "meeting/create", title });
                setSelected(null);
              }
            }}
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
        <div className="scroll-y" style={{ padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {state.meetings.map((m) => (
            <button
              key={m.id}
              className={`side-item${selected === m.id ? " active" : ""}`}
              style={{ height: "auto", padding: "8px 8px", alignItems: "flex-start" }}
              onClick={() => setSelected(m.id)}
            >
              <span className="side-icon" style={{ marginTop: 2 }}>
                <Icon name="messages" size={14} />
              </span>
              <span className="col" style={{ minWidth: 0, gap: 2 }}>
                <span className="truncate" style={{ fontWeight: 500 }}>
                  {m.title}
                </span>
                <span className="small weak">
                  {relativeTime(m.startedAt)} · {m.durationMin}m
                </span>
              </span>
            </button>
          ))}
          {state.meetings.length === 0 && (
            <span className="small weak" style={{ padding: 8 }}>
              No meetings recorded yet.
            </span>
          )}
        </div>
        <div style={{ padding: 10, borderTop: "1px solid var(--color-border)" }} className="small weak">
          Transcripts are captured by the desktop app's meeting integration and
          summarised locally.
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {!meeting && (
          <EmptyState
            icon="messages"
            title="No meeting selected"
            description="Record a meeting to get a summary and action items."
          />
        )}
        {meeting && (
          <>
            <div className="page-header">
              <div className="page-header-row">
                <h1 className="page-title">
                  <Icon name="messages" size={20} /> {meeting.title}
                </h1>
                <div className="page-actions">
                  <span className="ai-badge">
                    <Icon name="sparkle" size={10} /> AI notes
                  </span>
                  <button className="chip" onClick={(e) => projPop.openAt(e.currentTarget)}>
                    <Icon name="board" size={12} />
                    {state.projects.find((p) => p.id === meeting.projectId)?.name ?? "No project"}
                  </button>
                </div>
              </div>
              <p className="page-subtitle">
                {formatDateTime(meeting.startedAt)} · {meetingInsight(meeting, state)}
              </p>
            </div>

            <div className="page-scroll">
              <div style={{ padding: "12px 24px 64px", maxWidth: 1000 }}>
                <div className="stat-card">
                  <div className="row">
                    <h4 style={{ margin: 0 }}>Summary</h4>
                    <span className="ai-badge">
                      <Icon name="sparkle" size={10} /> generated
                    </span>
                  </div>
                  <p style={{ margin: 0, lineHeight: "22px" }}>{meeting.summary}</p>
                  <div className="row" style={{ gap: 6 }}>
                    {meeting.attendeeIds.map((id) => (
                      <Avatar key={id} user={userById(id)} size={22} ring />
                    ))}
                  </div>
                </div>

                <div className="stat-card" style={{ marginTop: 16 }}>
                  <div className="row">
                    <h4 style={{ margin: 0 }}>Action items</h4>
                    <span className="small weak">
                      {meeting.actionItems.filter((a) => a.created).length}/
                      {meeting.actionItems.length} created as tasks
                    </span>
                  </div>
                  {meeting.actionItems.length === 0 && (
                    <span className="small weak">No action items detected.</span>
                  )}
                  {meeting.actionItems.map((item) => (
                    <div
                      className="row"
                      key={item.id}
                      style={{ gap: 8, padding: "6px 0", borderBottom: "1px solid var(--color-border)" }}
                    >
                      <Icon name="check-circle" size={13} />
                      <span className="grow">{item.text}</span>
                      <Avatar user={userById(item.assigneeId)} size={20} />
                      {item.created ? (
                        <span className="chip" style={{ height: 22 }}>
                          <Icon name="check" size={11} /> Task created
                        </span>
                      ) : (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            dispatch({
                              type: "meeting/actionToTask",
                              meetingId: meeting.id,
                              actionItemId: item.id,
                            })
                          }
                        >
                          Create task
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="stat-card" style={{ marginTop: 16 }}>
                  <h4>Transcript</h4>
                  {meeting.transcript.map((line) => {
                    const speaker = userById(line.speakerId);
                    return (
                      <div className="transcript-line" key={line.id}>
                        <span className="transcript-time">{line.at}</span>
                        <Avatar user={speaker} size={20} />
                        <span>
                          <b>{speaker?.name.split(" ")[0] ?? "Speaker"}</b>{" "}
                          <span className="weak">{line.text}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {projPop.open && projPop.anchor && meeting && (
        <Popover anchor={projPop.anchor} onClose={projPop.close} width={240} align="end">
          {state.projects.map((p) => (
            <MenuItem
              key={p.id}
              checked={meeting.projectId === p.id}
              onClick={() => {
                projPop.close();
                navigate(`/project/${p.id}/overview`);
              }}
            >
              {p.name}
            </MenuItem>
          ))}
        </Popover>
      )}
    </div>
  );
}

export function WorkloadView() {
  const { state, userById } = useApp();
  const [weeks, setWeeks] = useState(4);
  const filterPop = usePopover();
  const [projectIds, setProjectIds] = useState<ID[]>([]);
  const allProjects = state.projects.map((p) => p.id);
  const scope = projectIds.length ? projectIds : allProjects;

  const today = new Date();
  const weekStarts = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i * 7);
    return d.toISOString().slice(0, 10);
  });
  const people = state.users.filter((u) => !u.isAgent);
  const cellCount = (userId: ID, weekStart: string) => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    const endIso = end.toISOString().slice(0, 10);
    return state.tasks.filter(
      (t) =>
        t.assigneeId === userId &&
        !t.completed &&
        t.projectId &&
        scope.includes(t.projectId) &&
        t.dueDate &&
        t.dueDate >= weekStart &&
        t.dueDate <= endIso
    ).length;
  };
  const CAPACITY = 6;
  const total = people.reduce(
    (n, p) => n + weekStarts.reduce((m, w) => m + cellCount(p.id, w), 0),
    0
  );

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <h1 className="page-title">
            <Icon name="users" size={22} /> Workload
          </h1>
          <div className="page-actions">
            <button className="btn btn-secondary" onClick={(e) => filterPop.openAt(e.currentTarget)}>
              <Icon name="filter" size={13} />
              {projectIds.length ? `${projectIds.length} projects` : "All projects"}
            </button>
            <div className="segmented">
              {[2, 4, 8].map((w) => (
                <button key={w} className={weeks === w ? "active" : ""} onClick={() => setWeeks(w)}>
                  {w}w
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="page-subtitle">
          {total} task-weeks across {people.length} people · capacity {CAPACITY}/week
        </p>
      </div>

      <div className="page-scroll">
        <div style={{ padding: "8px 24px 48px", maxWidth: 1200 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `220px repeat(${weeks}, minmax(60px, 1fr)) 90px`,
              gap: 6,
              alignItems: "center",
            }}
          >
            <div className="small weak">Teammate</div>
            {weekStarts.map((w) => (
              <div key={w} className="small weak" style={{ textAlign: "center" }}>
                {formatDue(w)}
              </div>
            ))}
            <div className="small weak" style={{ textAlign: "right" }}>
              Total
            </div>

            {people.map((person) => {
              const cells = weekStarts.map((w) => cellCount(person.id, w));
              const sum = cells.reduce((a, b) => a + b, 0);
              return (
                <React.Fragment key={person.id}>
                  <div className="row" style={{ gap: 8, minWidth: 0 }}>
                    <Avatar user={person} size={22} />
                    <span className="truncate small">{person.name}</span>
                  </div>
                  {cells.map((count, i) => {
                    const ratio = count / CAPACITY;
                    return (
                      <div
                        key={weekStarts[i]}
                        className="heat-cell"
                        title={`${count} tasks due`}
                        style={{
                          background:
                            count === 0
                              ? "var(--color-background-medium)"
                              : ratio > 1
                                ? "var(--color-danger-background-strong)"
                                : ratio > 0.7
                                  ? "var(--swatch-yellow-solid)"
                                  : "var(--color-primary-background-strong)",
                          color: count === 0 ? "var(--color-text-weak)" : "#fff",
                        }}
                      >
                        {count || ""}
                      </div>
                    );
                  })}
                  <div className="small mono" style={{ textAlign: "right" }}>
                    {sum}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          <div className="row small weak" style={{ gap: 16, marginTop: 16 }}>
            <span className="row" style={{ gap: 6 }}>
              <span className="swatch" style={{ background: "var(--color-primary-background-strong)" }} /> within capacity
            </span>
            <span className="row" style={{ gap: 6 }}>
              <span className="swatch" style={{ background: "var(--swatch-yellow-solid)" }} /> near capacity
            </span>
            <span className="row" style={{ gap: 6 }}>
              <span className="swatch" style={{ background: "var(--color-danger-background-strong)" }} /> over capacity
            </span>
            <div style={{ flex: 1 }} />
            <span className="row" style={{ gap: 6 }}>
              <Icon name="sparkle" size={11} /> Ask AI “who is overloaded?” for a summary
            </span>
          </div>
        </div>
      </div>

      {filterPop.open && filterPop.anchor && (
        <Popover anchor={filterPop.anchor} onClose={filterPop.close} width={280} align="end">
          {state.projects.map((p) => (
            <MenuItem
              key={p.id}
              checked={projectIds.includes(p.id)}
              onClick={() =>
                setProjectIds((prev) =>
                  prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]
                )
              }
            >
              {p.name}
            </MenuItem>
          ))}
          <div className="menu-sep" />
          <MenuItem onClick={() => setProjectIds([])}>Clear filter</MenuItem>
        </Popover>
      )}
    </div>
  );
}
