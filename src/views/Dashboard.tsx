import React, { useMemo, useState } from "react";
import { RiskRadar } from "./RiskRadar";
import { useApp } from "../core/store";
import type { ID, Project } from "../core/types";
import {
  completionSeries,
  portfolioRollup,
  projectStats,
  rootTasksOf,
  sectionsOf,
  tasksByAssignee,
  workloadByWeek,
} from "../core/selectors";
import {
  addDays,
  diffDays,
  formatDue,
  groupBy,
  pct,
  relativeTime,
  swatchBg,
  todayISO,
} from "../core/utils";
import { Icon } from "../ui/icons";
import {
  Avatar,
  AvatarStack,
  MenuItem,
  Modal,
  Popover,
  ProgressBar,
  usePopover,
} from "../ui/primitives";

/* ---------------------------------------------------------------- charts */
export function LineChart({
  series,
  height = 160,
  color = "var(--color-primary-background-strong)",
}: {
  series: { date: string; completed: number; created: number }[];
  height?: number;
  color?: string;
}) {
  const width = 560;
  const pad = { top: 12, right: 8, bottom: 20, left: 24 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...series.map((s) => Math.max(s.completed, s.created)));
  const x = (i: number) => pad.left + (i / Math.max(1, series.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const line = (key: "completed" | "created") =>
    series.map((s, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(s[key])}`).join(" ");
  const area =
    `${line("completed")} L${x(series.length - 1)},${pad.top + innerH} L${x(0)},${
      pad.top + innerH
    } Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }} role="img">
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + innerH * t}
          y2={pad.top + innerH * t}
          stroke="var(--color-border)"
          strokeDasharray={t === 1 ? "" : "3 3"}
        />
      ))}
      <path d={area} fill={color} opacity={0.1} />
      <path d={line("created")} fill="none" stroke="var(--color-border-hover)" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d={line("completed")} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
      {series.map((s, i) =>
        i % Math.ceil(series.length / 7) === 0 ? (
          <text
            key={s.date}
            x={x(i)}
            y={height - 4}
            fontSize={9}
            textAnchor="middle"
            fill="var(--color-text-weak)"
          >
            {s.date.slice(5)}
          </text>
        ) : null
      )}
    </svg>
  );
}

export function Donut({
  slices,
  size = 132,
}: {
  slices: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {slices.map((s) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={14}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      </g>
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={18}
        fontWeight={600}
        fill="var(--color-text)"
      >
        {total}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------- status card */
function StatusCard({ project }: { project: Project }) {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [statusState, setStatusState] = useState<Project["status"]["state"]>("on-track");
  const latest = project.statusUpdates[0];

  return (
    <div className="stat-card" style={{ gridColumn: "span 2" }}>
      <div className="row">
        <h4 style={{ flex: 1 }}>Project status</h4>
        <span className={`status-pill status-${project.status.state}`}>
          <span
            className="swatch dot"
            style={{ width: 6, height: 6, background: "currentColor" }}
          />
          {project.status.state === "on-track"
            ? "On track"
            : project.status.state === "at-risk"
              ? "At risk"
              : project.status.state === "off-track"
                ? "Off track"
                : project.status.state === "on-hold"
                  ? "On hold"
                  : "No status"}
        </span>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
          Update status
        </button>
      </div>
      {latest ? (
        <div>
          <div style={{ fontWeight: 500 }}>{latest.title}</div>
          <div className="small weak" style={{ margin: "2px 0 6px" }}>
            {state.users.find((u) => u.id === latest.authorId)?.name} ·{" "}
            {relativeTime(latest.createdAt)}
          </div>
          <div style={{ fontSize: 13, lineHeight: "20px" }}>{latest.text}</div>
        </div>
      ) : (
        <div className="weak small">
          No status updates yet. Share progress with the team.
        </div>
      )}

      {open && (
        <Modal
          title="Update status"
          icon={<Icon name="target" size={16} />}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  dispatch({
                    type: "status/create",
                    projectId: project.id,
                    title: title || "Status update",
                    text,
                    state: statusState,
                  });
                  setOpen(false);
                  setTitle("");
                  setText("");
                }}
              >
                Publish update
              </button>
            </>
          }
        >
          <label className="small weak">Status</label>
          <div className="segmented" style={{ alignSelf: "flex-start" }}>
            {(["on-track", "at-risk", "off-track", "on-hold"] as const).map((s) => (
              <button
                key={s}
                className={statusState === s ? "active" : ""}
                onClick={() => setStatusState(s)}
              >
                {s === "on-track"
                  ? "On track"
                  : s === "at-risk"
                    ? "At risk"
                    : s === "off-track"
                      ? "Off track"
                      : "On hold"}
              </button>
            ))}
          </div>
          <label className="small weak">Title</label>
          <input
            className="input"
            placeholder="What changed since the last update?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label className="small weak">Details</label>
          <textarea
            className="textarea"
            rows={5}
            placeholder="Highlight progress, risks and what you need from the team."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Modal>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- dashboard */
export function ProjectDashboard({ projectId }: { projectId: ID }) {
  const { state, userById } = useApp();
  const project = state.projects.find((p) => p.id === projectId);
  const stats = projectStats(state, projectId);
  const series = completionSeries(state, projectId, 14);
  const assignees = tasksByAssignee(state, [projectId]);
  const sections = sectionsOf(state, projectId);
  const sectionCounts = sections.map((s) => ({
    label: s.name,
    value: state.tasks.filter((t) => t.sectionId === s.id && !t.parentId).length,
    color: swatchBg(s.color ?? project?.color ?? "blue"),
  }));
  const overdue = rootTasksOf(state, projectId)
    .filter((t) => !t.completed && t.dueDate && t.dueDate < todayISO())
    .slice(0, 5);

  if (!project) return null;

  return (
    <div className="page-scroll">
      <div style={{ padding: "16px 24px 48px", maxWidth: 1200 }}>
        <div className="grid-cards" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
          <div className="stat-card">
            <h4>Tasks completed</h4>
            <div className="stat-value">
              {stats.done}
              <span className="weak" style={{ fontSize: 16, fontWeight: 400 }}>
                {" "}
                / {stats.total}
              </span>
            </div>
            <ProgressBar percent={stats.percent} />
          </div>
          <div className="stat-card">
            <h4>Overdue</h4>
            <div className="stat-value" style={{ color: stats.overdue ? "var(--color-danger-text)" : undefined }}>
              {stats.overdue}
            </div>
            <span className="small weak">Open tasks past their due date</span>
          </div>
          <div className="stat-card">
            <h4>Due this week</h4>
            <div className="stat-value">{stats.thisWeek}</div>
            <span className="small weak">Across all sections</span>
          </div>
          <div className="stat-card">
            <h4>Team</h4>
            <div style={{ marginTop: 6 }}>
              <AvatarStack users={project.memberIds.map((id) => userById(id))} size={28} />
            </div>
            <span className="small weak">{project.memberIds.length} members</span>
          </div>
        </div>

        <div
          className="grid-cards"
          style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", marginTop: 16 }}
        >
          <StatusCard project={project} />
          <div className="stat-card">
            <h4>Tasks created vs. completed (14 days)</h4>
            <LineChart series={series} />
            <div className="row small weak" style={{ gap: 16 }}>
              <span className="row" style={{ gap: 6 }}>
                <span style={{ width: 14, height: 2, background: "var(--color-primary-background-strong)" }} />
                Completed
              </span>
              <span className="row" style={{ gap: 6 }}>
                <span style={{ width: 14, height: 2, background: "var(--color-border-hover)" }} />
                Created
              </span>
            </div>
          </div>

          <div className="stat-card">
            <h4>Tasks by assignee</h4>
            {assignees.length === 0 && <span className="small weak">No open tasks</span>}
            {assignees.map((row) => (
              <div className="bar-row" key={row.id}>
                <Avatar user={row.user} size={20} />
                <span style={{ width: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.user?.name ?? "Unassigned"}
                </span>
                <ProgressBar
                  percent={pct(row.count, Math.max(...assignees.map((a) => a.count), 1))}
                />
                <span className="mono small">{row.count}</span>
              </div>
            ))}
          </div>

          <div className="stat-card">
            <h4>Tasks by section</h4>
            <div className="row" style={{ gap: 20 }}>
              <Donut slices={sectionCounts} />
              <div style={{ flex: 1 }}>
                {sectionCounts.map((s) => (
                  <div className="row small" key={s.label} style={{ gap: 8, padding: "3px 0" }}>
                    <span className="swatch dot" style={{ background: s.color }} />
                    <span className="grow truncate">{s.label}</span>
                    <span className="mono weak">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="stat-card" style={{ gridColumn: "span 2" }}>
            <h4>Overdue work needing attention</h4>
            {overdue.length === 0 ? (
              <span className="small weak">Nothing overdue. 🎉</span>
            ) : (
              overdue.map((t) => (
                <div className="row" key={t.id} style={{ padding: "6px 0", gap: 10 }}>
                  <Avatar user={userById(t.assigneeId)} size={20} />
                  <span className="grow truncate">{t.name}</span>
                  <span className="due overdue small">
                    <Icon name="calendar" size={11} />
                    {formatDue(t.dueDate)} · {Math.abs(diffDays(t.dueDate!, todayISO()))}d late
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- reporting */
export function ReportingView() {
  const { state, userById } = useApp();
  const [scope, setScope] = useState<"all" | ID>("all");
  const projects = scope === "all" ? state.projects : state.projects.filter((p) => p.id === scope);
  const ids = projects.map((p) => p.id);
  const rollup = portfolioRollup(state, ids);
  const workload = workloadByWeek(state, ids, 4);
  const pop = usePopover();
  const totals = projects.map((p) => ({ project: p, stats: projectStats(state, p.id) }));

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <h1 className="page-title">
            <Icon name="chart" size={22} /> Reporting
          </h1>
          <div className="page-actions">
            <button className="btn btn-secondary" onClick={(e) => pop.openAt(e.currentTarget)}>
              <Icon name="filter" size={13} />
              {scope === "all" ? "All projects" : projects[0]?.name}
            </button>
          </div>
        </div>
        <p className="page-subtitle">
          Portfolio-level metrics across {projects.length} project
          {projects.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="page-scroll">
        <div style={{ padding: "16px 24px 48px", maxWidth: 1200 }}>
          <div className="grid-cards" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
            <div className="stat-card">
              <h4>Total tasks</h4>
              <div className="stat-value">{rollup.total}</div>
            </div>
            <div className="stat-card">
              <h4>Completed</h4>
              <div className="stat-value">{rollup.done}</div>
              <ProgressBar percent={rollup.percent} />
            </div>
            <div className="stat-card">
              <h4>Overdue</h4>
              <div className="stat-value">{rollup.overdue}</div>
            </div>
            <div className="stat-card">
              <h4>Completion rate</h4>
              <div className="stat-value">{rollup.percent}%</div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <RiskRadar projectIds={ids} />
          </div>

          <div className="grid-cards" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", marginTop: 16 }}>
            <div className="stat-card">
              <h4>Project health</h4>
              {totals.map(({ project, stats }) => (
                <div className="bar-row" key={project.id}>
                  <span
                    className="swatch dot"
                    style={{ background: swatchBg(project.color) }}
                  />
                  <span style={{ width: 150 }} className="truncate">
                    {project.name}
                  </span>
                  <ProgressBar percent={stats.percent} />
                  <span className="mono small">
                    {stats.done}/{stats.total}
                  </span>
                </div>
              ))}
            </div>
            <div className="stat-card">
              <h4>Workload by week</h4>
              {workload.map((week) => (
                <div key={week.weekStart} style={{ marginBottom: 10 }}>
                  <div className="small weak" style={{ marginBottom: 4 }}>
                    Week of {formatDue(week.weekStart)}
                  </div>
                  {week.rows.length === 0 ? (
                    <span className="small weak">No tasks due</span>
                  ) : (
                    week.rows.map((row) => (
                      <div className="bar-row" key={row.userId} style={{ padding: "2px 0" }}>
                        <Avatar user={userById(row.userId)} size={18} />
                        <span style={{ width: 100 }} className="truncate small">
                          {userById(row.userId)?.name}
                        </span>
                        <ProgressBar
                          percent={pct(row.count, Math.max(...week.rows.map((r) => r.count), 1))}
                        />
                        <span className="mono small">{row.count}</span>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={260} align="end">
          <MenuItem checked={scope === "all"} onClick={() => { setScope("all"); pop.close(); }}>
            All projects
          </MenuItem>
          {state.projects.map((p) => (
            <MenuItem
              key={p.id}
              checked={scope === p.id}
              onClick={() => {
                setScope(p.id);
                pop.close();
              }}
            >
              <span className="swatch dot" style={{ background: swatchBg(p.color) }} />
              {p.name}
            </MenuItem>
          ))}
        </Popover>
      )}
    </div>
  );
}
