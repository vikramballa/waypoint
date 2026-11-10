import React, { useState } from "react";
import { useApp } from "../core/store";
import { projectStats } from "../core/selectors";
import { projectRisk } from "../core/insights";
import { navigate } from "../core/router";
import { diffDays, formatDue, swatchBg, todayISO } from "../core/utils";
import type { Portfolio, PortfolioColumn, Project } from "../core/types";
import { Icon } from "../ui/icons";
import { Avatar, Popover, ProgressBar, usePopover } from "../ui/primitives";
import { RiskBadge } from "./RiskRadar";

const COLUMNS: { key: PortfolioColumn; label: string; width: number }[] = [
  { key: "status", label: "Status", width: 110 },
  { key: "risk", label: "Risk", width: 100 },
  { key: "owner", label: "Owner", width: 60 },
  { key: "due", label: "Due", width: 100 },
  { key: "tasks", label: "Tasks", width: 70 },
  { key: "overdue", label: "Overdue", width: 80 },
  { key: "progress", label: "Progress", width: 150 },
];
const DEFAULT_COLUMNS: PortfolioColumn[] = ["status", "owner", "due", "progress"];
const STATUS_LABEL: Record<string, string> = {
  "on-track": "On track",
  "at-risk": "At risk",
  "off-track": "Off track",
  "on-hold": "On hold",
  complete: "Complete",
  none: "No status",
};

export function PortfolioBody({ portfolio }: { portfolio: Portfolio }) {
  const { state, dispatch } = useApp();
  const colPop = usePopover();
  const view = portfolio.view ?? "list";
  const columns = portfolio.columns ?? DEFAULT_COLUMNS;
  const projects = portfolio.projectIds.map((id) => state.projects.find((p) => p.id === id)).filter(Boolean) as Project[];
  const save = (patch: Partial<Portfolio>) => dispatch({ type: "portfolio/update", id: portfolio.id, patch });

  return (
    <div style={{ marginTop: 24 }}>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <div className="segmented" role="tablist" aria-label="Portfolio view">
          {(["list", "board", "timeline"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? "active" : ""} onClick={() => save({ view: v })}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {view === "list" && (
          <button className="chip" onClick={(e) => colPop.openAt(e.currentTarget)}>
            <Icon name="grid" size={12} /> Columns
          </button>
        )}
      </div>

      {view === "list" && (
        <>
          <div className="list-head" style={{ borderRadius: 4 }}>
            <div className="col" style={{ flex: 1 }}>Project</div>
            {COLUMNS.filter((c) => columns.includes(c.key)).map((c) => (
              <div key={c.key} className="col" style={{ width: c.width }}>
                {c.label}
              </div>
            ))}
          </div>
          {projects.map((project) => {
            const stats = projectStats(state, project.id);
            const owner = state.users.find((u) => u.id === project.ownerId);
            const cell: Record<PortfolioColumn, React.ReactNode> = {
              status: <span className={`status-pill status-${project.status.state}`}>{STATUS_LABEL[project.status.state] ?? "No status"}</span>,
              risk: <RiskBadge risk={projectRisk(state, project.id)} />,
              owner: <Avatar user={owner} size={22} />,
              due: <span className="small weak">{project.dueDate ? formatDue(project.dueDate) : "—"}</span>,
              tasks: <span className="small mono">{stats.total}</span>,
              overdue: <span className={`small mono${stats.overdue ? " schedule-late" : ""}`}>{stats.overdue}</span>,
              progress: (
                <span className="row" style={{ gap: 6, width: "100%" }}>
                  <ProgressBar percent={stats.percent} />
                  <span className="small mono">{stats.percent}%</span>
                </span>
              ),
            };
            return (
              <div key={project.id} className="row portfolio-row" onClick={() => navigate(`/project/${project.id}/list`)}>
                <span className="swatch" style={{ background: swatchBg(project.color) }} />
                <span className="grow truncate">{project.name}</span>
                {COLUMNS.filter((c) => columns.includes(c.key)).map((c) => (
                  <span key={c.key} style={{ width: c.width, display: "flex" }}>
                    {cell[c.key]}
                  </span>
                ))}
              </div>
            );
          })}
        </>
      )}

      {view === "board" && (
        <div className="board-wrap" style={{ padding: 0 }}>
          {(["on-track", "at-risk", "off-track", "on-hold", "none"] as const).map((st) => {
            const list = projects.filter((p) => (p.status.state || "none") === st);
            return (
              <div className="board-col" key={st}>
                <div className="board-col-head">
                  <span>{STATUS_LABEL[st]}</span>
                  <span className="count">{list.length}</span>
                </div>
                <div className="board-col-body">
                  {list.map((p) => {
                    const stats = projectStats(state, p.id);
                    return (
                      <div className="card" key={p.id} onClick={() => navigate(`/project/${p.id}/list`)} style={{ cursor: "pointer" }}>
                        <div className="card-top">
                          <span className="swatch" style={{ background: swatchBg(p.color) }} />
                          <span className="card-title">{p.name}</span>
                        </div>
                        <ProgressBar percent={stats.percent} />
                        <div className="card-meta">
                          <Avatar user={state.users.find((u) => u.id === p.ownerId)} size={20} />
                          <span>{stats.percent}% · {p.dueDate ? formatDue(p.dueDate) : "no due date"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "timeline" && <PortfolioTimeline projects={projects} />}

      {colPop.open && colPop.anchor && (
        <Popover anchor={colPop.anchor} onClose={colPop.close} width={200} align="end">
          {COLUMNS.map((c) => {
            const on = columns.includes(c.key);
            return (
              <button
                key={c.key}
                className="menu-item"
                aria-pressed={on}
                onClick={() => save({ columns: on ? columns.filter((x) => x !== c.key) : [...columns, c.key] })}
              >
                <Icon name={on ? "check" : "plus"} size={13} /> {c.label}
              </button>
            );
          })}
        </Popover>
      )}
    </div>
  );
}

function PortfolioTimeline({ projects }: { projects: Project[] }) {
  const { state } = useApp();
  const spans = projects.map((p) => {
    const dated = state.tasks.filter((t) => t.projectId === p.id && (t.startDate || t.dueDate));
    const start = [p.createdAt.slice(0, 10), ...dated.map((t) => t.startDate ?? t.dueDate ?? "")].filter(Boolean).sort()[0];
    const end = p.dueDate ?? dated.map((t) => t.dueDate ?? t.startDate ?? "").filter(Boolean).sort().pop() ?? start;
    return { p, start, end: end < start ? start : end };
  });
  if (!spans.length) return <p className="small weak">Add projects to see them on a timeline.</p>;
  const min = spans.map((s) => s.start).sort()[0];
  const max = spans.map((s) => s.end).sort().pop() as string;
  const total = Math.max(1, diffDays(max, min) + 1);
  const today = todayISO();
  const todayPct = Math.min(100, Math.max(0, (diffDays(today, min) / total) * 100));
  return (
    <div className="portfolio-timeline">
      <div className="small weak row" style={{ justifyContent: "space-between" }}>
        <span>{formatDue(min)}</span>
        <span>{formatDue(max)}</span>
      </div>
      <div className="pt-body">
        <div className="pt-today" style={{ left: `calc(210px + (100% - 210px) * ${todayPct / 100})` }} title="Today" />
        {spans.map(({ p, start, end }) => {
          const left = (diffDays(start, min) / total) * 100;
          const width = Math.max(1.5, ((diffDays(end, start) + 1) / total) * 100);
          const stats = projectStats(state, p.id);
          return (
            <div className="pt-row" key={p.id}>
              <span className="pt-label truncate">{p.name}</span>
              <div className="pt-track">
                <button
                  className="pt-bar"
                  style={{ left: `${left}%`, width: `${width}%`, background: `var(--swatch-${p.color}-solid)` }}
                  title={`${p.name}: ${formatDue(start)} → ${formatDue(end)} · ${stats.percent}% done`}
                  onClick={() => navigate(`/project/${p.id}/timeline`)}
                >
                  <span className="pt-fill" style={{ width: `${stats.percent}%` }} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
