import React, { useState } from "react";
import { useApp } from "../core/store";
import type { Goal, GoalStatus, ID } from "../core/types";
import { navigate } from "../core/router";
import { goalChildren } from "../core/selectors";
import { goalHealth } from "../core/insights";
import { formatDue, swatchBg, todayISO, diffDays } from "../core/utils";
import { Icon } from "../ui/icons";
import {
  Avatar,
  ConfirmButton,
  MenuItem,
  Modal,
  Popover,
  ProgressBar,
  usePopover,
} from "../ui/primitives";

const STATUS_LABEL: Record<GoalStatus, string> = {
  "on-track": "On track",
  "at-risk": "At risk",
  "off-track": "Off track",
  achieved: "Achieved",
  dropped: "Dropped",
};

function StatusPill({ status }: { status: GoalStatus }) {
  const cls =
    status === "on-track" || status === "achieved"
      ? "status-on-track"
      : status === "at-risk"
        ? "status-at-risk"
        : status === "off-track"
          ? "status-off-track"
          : "status-on-hold";
  return <span className={`status-pill ${cls}`}>{STATUS_LABEL[status]}</span>;
}

function GoalRow({
  goal,
  depth = 0,
  onOpen,
}: {
  goal: Goal;
  depth?: number;
  onOpen: (id: ID) => void;
}) {
  const { state, dispatch, userById } = useApp();
  const children = goalChildren(state, goal.id);
  const health = goalHealth(state, goal);
  const percent = health.progress;
  const owner = userById(goal.ownerId);
  const team = state.teams.find((t) => t.id === goal.teamId);

  return (
    <>
      <div
        className="goal-row"
        style={{ marginLeft: depth * 24, cursor: "pointer" }}
        onClick={() => onOpen(goal.id)}
      >
        <span className="side-caret" style={{ width: 16, flex: "none" }}>
          <Icon name={children.length ? "chevron-down" : "chevron-right"} size={12} />
        </span>
        <div className="col" style={{ flex: 1, minWidth: 0 }}>
          <span className="goal-name truncate">{goal.name}</span>
          <span className="small weak">
            {team?.name} · {goal.metric}
          </span>
        </div>
        <span style={{ width: 44, flex: "none", display: "flex" }}>
          <Avatar user={owner} size={22} />
        </span>
        <span style={{ width: 104, flex: "none", display: "flex" }} title={health.reason}>
          <StatusPill status={health.status} />
        </span>
        <div className="goal-progress">
          <ProgressBar percent={percent} />
          <span className="mono" style={{ width: 34, textAlign: "right" }}>
            {percent}%
          </span>
        </div>
        <span className="small weak" style={{ width: 96, flex: "none", textAlign: "right" }}>
          {goal.dueDate ? formatDue(goal.dueDate) : "No date"}
        </span>
      </div>
      {children.map((child) => (
        <GoalRow key={child.id} goal={child} depth={depth + 1} onOpen={onOpen} />
      ))}
    </>
  );
}

function GoalDetail({ goalId, onClose }: { goalId: ID; onClose: () => void }) {
  const { state, dispatch, userById, user, can } = useApp();
  const goal = state.goals.find((g) => g.id === goalId);
  const statusPop = usePopover();
  const [value, setValue] = useState(goal?.currentValue ?? 0);
  if (!goal) return null;
  const health = goalHealth(state, goal);
  const percent = health.progress;
  const auto = goal.progressSource === "projects";
  const children = goalChildren(state, goal.id);

  return (
    <aside className="pane" style={{ width: 520, minWidth: 420 }}>
      <div className="pane-header">
        <div className="crumbs">
          <button className="row" style={{ gap: 6, color: "inherit" }} onClick={() => navigate("/goals")}>
            <Icon name="target" size={13} /> Goals
          </button>
        </div>
        <button className="icon-btn" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="pane-body scroll-y">
        <input
          className="pane-title"
          style={{ borderRadius: 4 }}
          value={goal.name}
          onChange={(e) => dispatch({ type: "goal/update", id: goal.id, patch: { name: e.target.value } })}
        />
        <div className="row" style={{ gap: 8 }}>
          <button
            onClick={(e) => !auto && statusPop.openAt(e.currentTarget)}
            title={auto ? "Status is computed from linked projects" : "Change status"}
          >
            <StatusPill status={health.status} />
          </button>
          <span className="small weak">
            {state.teams.find((t) => t.id === goal.teamId)?.name}
            {goal.dueDate ? ` · due ${formatDue(goal.dueDate)}` : ""}
          </span>
        </div>
        <div className="pane-grid">
          <div className="k">
            <Icon name="person" size={13} /> Owner
          </div>
          <div className="v">
            <span className="row" style={{ gap: 6 }}>
              <Avatar user={userById(goal.ownerId)} size={20} />
              {userById(goal.ownerId)?.name}
            </span>
          </div>
          <div className="k">
            <Icon name="chart" size={13} /> Progress
          </div>
          <div className="v" style={{ width: "100%" }}>
            <ProgressBar percent={percent} />
            <span className="mono small">{percent}%</span>
          </div>
          <div className="k">
            <Icon name="refresh" size={13} /> Updates
          </div>
          <div className="v col" style={{ alignItems: "flex-start", gap: 4 }}>
            <label className="row small" style={{ gap: 8 }}>
              <button
                type="button"
                role="switch"
                aria-checked={auto}
                aria-label="Update from linked projects"
                className={`switch${auto ? " on" : ""}`}
                style={{ width: 28, height: 16 }}
                disabled={!goal.projectIds.length}
                onClick={() =>
                  dispatch({ type: "goal/update", id: goal.id, patch: { progressSource: auto ? "manual" : "projects" } })
                }
              />
              Automatically from linked projects
            </label>
            <span className="small weak">
              {goal.projectIds.length ? health.reason : "Link a project to this goal to update it automatically."}
            </span>
          </div>
          {!auto && <>
          <div className="k">
            <Icon name="target" size={13} /> Current value
          </div>
          <div className="v">
            <input
              className="input"
              style={{ width: 120, height: 28 }}
              type="number"
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              onBlur={() =>
                dispatch({ type: "goal/update", id: goal.id, patch: { currentValue: value } })
              }
            />
            <span className="small weak">
              / {goal.targetValue} {goal.unit}
            </span>
          </div>
          </>}
        </div>

        <div className="divider" />
        <div className="pane-section-title">Description</div>
        <textarea
          className="textarea"
          rows={4}
          value={goal.description}
          onChange={(e) => dispatch({ type: "goal/update", id: goal.id, patch: { description: e.target.value } })}
        />

        <div className="divider" />
        <div className="pane-section-title">Contributing projects</div>
        {goal.projectIds.map((id) => {
          const project = state.projects.find((p) => p.id === id);
          if (!project) return null;
          return (
            <button
              key={id}
              className="row"
              style={{ gap: 8, padding: "6px 0", textAlign: "left" }}
              onClick={() => navigate(`/project/${id}/list`)}
            >
              <span className="swatch" style={{ background: swatchBg(project.color) }} />
              <span className="grow truncate">{project.name}</span>
              <Icon name="arrow-up-right" size={12} />
            </button>
          );
        })}
        {goal.projectIds.length === 0 && <span className="small weak">No linked projects yet.</span>}

        {children.length > 0 && (
          <>
            <div className="divider" />
            <div className="pane-section-title">Sub-goals</div>
            {children.map((child) => (
              <div key={child.id} className="row" style={{ gap: 8, padding: "4px 0" }}>
                <span className="grow truncate">{child.name}</span>
                <ProgressBar percent={goalHealth(state, child).progress} />
                <span className="mono small">{goalHealth(state, child).progress}%</span>
              </div>
            ))}
          </>
        )}

        {(goal.ownerId === user.id || can("workspace:admin")) && <>
        <div className="divider" />
        <ConfirmButton
          className="btn btn-ghost btn-sm"
          label="Delete goal"
          confirmLabel="Click again to delete"
          icon={<Icon name="trash" size={13} />}
          onConfirm={() => {
            dispatch({ type: "goal/delete", id: goal.id });
            onClose();
          }}
        />
        </>}
      </div>
      {statusPop.open && statusPop.anchor && (
        <Popover anchor={statusPop.anchor} onClose={statusPop.close} width={200}>
          {(Object.keys(STATUS_LABEL) as GoalStatus[]).map((s) => (
            <MenuItem
              key={s}
              checked={goal.status === s}
              onClick={() => {
                dispatch({ type: "goal/update", id: goal.id, patch: { status: s } });
                statusPop.close();
              }}
            >
              {STATUS_LABEL[s]}
            </MenuItem>
          ))}
        </Popover>
      )}
    </aside>
  );
}

export function GoalsView({ onCreate }: { onCreate: () => void }) {
  const { state, can } = useApp();
  const [openId, setOpenId] = useState<ID | null>(null);
  const roots = state.goals.filter((g) => !g.parentId);

  return (
    <div className="page" style={{ flexDirection: "row" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="page-header">
          <div className="page-header-row">
            <h1 className="page-title">
              <Icon name="target" size={22} /> Goals
            </h1>
            <div className="page-actions">
              {can("project:create") && (
                <button className="btn btn-primary" onClick={onCreate}>
                  <Icon name="plus" size={14} /> Create goal
                </button>
              )}
            </div>
          </div>
          <p className="page-subtitle">
            {roots.length} company goals ·{" "}
            {Math.round(
              roots.reduce((n, g) => n + goalHealth(state, g).progress, 0) / Math.max(1, roots.length)
            )}
            % average progress
          </p>
        </div>
        <div className="page-scroll">
          <div style={{ padding: "8px 24px 48px", maxWidth: 1200 }}>
            <div className="list-head" style={{ borderRadius: 4, paddingLeft: 8 }}>
              <div className="col" style={{ width: 16 }} />
              <div className="col" style={{ flex: 1 }}>Goal</div>
              <div className="col" style={{ width: 44 }}>Owner</div>
              <div className="col" style={{ width: 104 }}>Status</div>
              <div className="col" style={{ width: 222 }}>Progress</div>
              <div className="col" style={{ width: 96, justifyContent: "flex-end" }}>Due</div>
            </div>
            {roots.map((goal) => (
              <GoalRow key={goal.id} goal={goal} onOpen={setOpenId} />
            ))}
          </div>
        </div>
      </div>
      {openId && <GoalDetail goalId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
