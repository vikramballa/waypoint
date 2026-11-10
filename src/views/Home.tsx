import React, { useMemo } from "react";
import { useApp } from "../core/store";
import type { ID } from "../core/types";
import { navigate } from "../core/router";
import { goalProgress, myTasks, projectStats, unreadCount } from "../core/selectors";
import {
  addDays,
  dowName,
  formatDue,
  relativeTime,
  swatchBg,
  todayISO,
} from "../core/utils";
import { Icon } from "../ui/icons";
import { Avatar, AvatarStack, Checkbox, ProgressBar, TaskCheckbox } from "../ui/primitives";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeView({
  onOpenTask,
  onCreateProject,
  onCreateTask,
}: {
  onOpenTask: (id: ID) => void;
  onCreateProject: () => void;
  onCreateTask: () => void;
}) {
  const { state, dispatch, userById, user, can } = useApp();
  const buckets = useMemo(() => myTasks(state), [state]);
  const recentProjects = state.recentlyViewed
    .filter((v) => v.type === "project")
    .map((v) => state.projects.find((p) => p.id === v.id))
    .filter(Boolean)
    .slice(0, 3);
  const upcoming = [...buckets.today, ...buckets.upcoming].slice(0, 6);
  const goals = state.goals.filter((g) => !g.parentId).slice(0, 3);
  const unread = unreadCount(state);
  const week = Array.from({ length: 7 }, (_, i) => addDays(todayISO(), i));
  const feed = [...state.activities]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 6);
  const maxWeek = Math.max(
    1,
    ...week.map(
      (d) =>
        state.tasks.filter(
          (t) =>
            t.dueDate === d &&
            !t.completed &&
            t.assigneeId === state.currentUserId
        ).length
    )
  );

  return (
    <div className="page">
      <div className="page-scroll">
        <div style={{ padding: "24px 24px 64px", maxWidth: 1240 }}>
          <div className="row" style={{ gap: 12, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 500, margin: 0 }}>
              {greeting()}, {user.name.split(" ")[0]}
            </h1>
            <span className="chip">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
          <p className="page-subtitle" style={{ marginBottom: 16 }}>
            {buckets.today.length} task{buckets.today.length === 1 ? "" : "s"} due today ·{" "}
            {unread} unread notification{unread === 1 ? "" : "s"}
          </p>

          <div className="row" style={{ gap: 8, marginBottom: 20 }}>
            <button className="btn btn-primary" onClick={onCreateTask}>
              <Icon name="plus" size={14} /> Create task
            </button>
            {can("project:create") && (
              <>
                <button className="btn btn-secondary" onClick={onCreateProject}>
                  <Icon name="board" size={14} /> New project
                </button>
                <button className="btn btn-secondary" onClick={() => navigate("/goals")}>
                  <Icon name="target" size={14} /> Set a goal
                </button>
              </>
            )}
          </div>

          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            {/* ------------------------------------------------ left column */}
            <div style={{ flex: "2 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="stat-card">
                <div className="row">
                  <h4 style={{ flex: 1, margin: 0 }}>My tasks</h4>
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate("/my-tasks")}>
                    See all <Icon name="arrow-right" size={12} />
                  </button>
                </div>
                {upcoming.length === 0 && (
                  <span className="small weak">Nothing due this week. Nice work.</span>
                )}
                {upcoming.map((task) => (
                  <div
                    key={task.id}
                    className="row"
                    style={{
                      gap: 8,
                      padding: "7px 0",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <TaskCheckbox task={task} />
                    <button
                      className="grow truncate"
                      style={{ textAlign: "left" }}
                      onClick={() => onOpenTask(task.id)}
                    >
                      {task.name}
                    </button>
                    {state.projects.find((p) => p.id === task.projectId) && (
                      <span
                        className="swatch dot"
                        title={state.projects.find((p) => p.id === task.projectId)?.name}
                        style={{
                          background: swatchBg(
                            state.projects.find((p) => p.id === task.projectId)?.color
                          ),
                        }}
                      />
                    )}
                    <Avatar user={userById(task.assigneeId)} size={20} />
                    <span
                      className={`due small ${
                        task.dueDate && task.dueDate < todayISO() ? "overdue" : ""
                      }`}
                    >
                      {task.dueDate ? formatDue(task.dueDate) : "No date"}
                    </span>
                  </div>
                ))}
              </div>

              <div>
                <div className="row" style={{ marginBottom: 8 }}>
                  <h4 style={{ margin: 0, fontSize: 13, color: "var(--color-text-weak)", flex: 1 }}>
                    Recent projects
                  </h4>
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate("/portfolios")}>
                    Portfolios
                  </button>
                </div>
                <div className="grid-cards" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", padding: 0 }}>
                  {recentProjects.map((project) => {
                    if (!project) return null;
                    const stats = projectStats(state, project.id);
                    return (
                      <button
                        key={project.id}
                        className="stat-card"
                        style={{ textAlign: "left", cursor: "pointer" }}
                        onClick={() => navigate(`/project/${project.id}/list`)}
                      >
                        <div className="row">
                          <span
                            className="mini-project-icon"
                            style={{
                              background: swatchBg(project.color),
                              color: `var(--swatch-${project.color}-fg)`,
                              width: 24,
                              height: 24,
                              fontSize: 11,
                            }}
                          >
                            {project.name.slice(0, 1)}
                          </span>
                          <span className="grow truncate" style={{ fontWeight: 500 }}>
                            {project.name}
                          </span>
                          <Icon name="arrow-up-right" size={13} />
                        </div>
                        <ProgressBar percent={stats.percent} />
                        <div className="row small weak">
                          <span>
                            {stats.done}/{stats.total} tasks
                          </span>
                          <div style={{ flex: 1 }} />
                          <AvatarStack
                            users={project.memberIds.slice(0, 3).map((id) => userById(id))}
                            size={20}
                          />
                        </div>
                      </button>
                    );
                  })}
                  <button
                    className="stat-card"
                    style={{ alignItems: "center", justifyContent: "center", cursor: "pointer", minHeight: 118 }}
                    onClick={onCreateProject}
                  >
                    <Icon name="plus-circle" size={22} />
                    <span className="small">Create project</span>
                  </button>
                </div>
              </div>

              <div className="stat-card">
                <div className="row">
                  <h4 style={{ flex: 1, margin: 0 }}>Goals</h4>
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate("/goals")}>
                    See all <Icon name="arrow-right" size={12} />
                  </button>
                </div>
                {goals.map((goal) => (
                  <div key={goal.id} style={{ padding: "6px 0" }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="grow truncate">{goal.name}</span>
                      <span className="small weak mono">{goalProgress(goal)}%</span>
                    </div>
                    <ProgressBar percent={goalProgress(goal)} />
                  </div>
                ))}
              </div>
            </div>

            {/* ----------------------------------------------- right column */}
            <div style={{ flex: "1 1 0", minWidth: 280, display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="stat-card">
                <div className="row">
                  <h4 style={{ flex: 1, margin: 0 }}>Inbox</h4>
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate("/inbox")}>
                    Open
                  </button>
                </div>
                {state.notifications.slice(0, 4).map((n) => (
                  <button
                    key={n.id}
                    className="row"
                    style={{ gap: 8, padding: "6px 0", textAlign: "left" }}
                    onClick={() => {
                      dispatch({ type: "notification/read", id: n.id });
                      if (n.taskId) onOpenTask(n.taskId);
                    }}
                  >
                    <Avatar user={userById(n.actorId)} size={22} />
                    <span className="grow small truncate">{n.text}</span>
                    {!n.read && (
                      <span
                        className="swatch dot"
                        style={{ background: "var(--color-primary-icon)", width: 6, height: 6 }}
                      />
                    )}
                  </button>
                ))}
                {state.notifications.length === 0 && (
                  <span className="small weak">No notifications</span>
                )}
              </div>

              <div className="stat-card">
                <h4>This week</h4>
                <div className="row" style={{ gap: 6, alignItems: "flex-end", height: 96 }}>
                  {week.map((day) => {
                    const count = state.tasks.filter(
                      (t) =>
                        t.dueDate === day &&
                        !t.completed &&
                        t.assigneeId === state.currentUserId
                    ).length;
                    return (
                      <div key={day} className="col" style={{ flex: 1, alignItems: "center", gap: 4 }}>
                        <span className="small weak mono">{count || ""}</span>
                        <div
                          style={{
                            width: "100%",
                            height: `${(count / maxWeek) * 56}px`,
                            minHeight: count ? 6 : 2,
                            background: count
                              ? "var(--color-primary-background-strong)"
                              : "var(--color-border)",
                            borderRadius: 3,
                            transition: "height 300ms var(--ease-out)",
                          }}
                          title={`${count} tasks`}
                        />
                        <span className="small weak">{dowName(day)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="stat-card">
                <h4>Recent activity</h4>
                {feed.map((a) => {
                  const actor = userById(a.actorId);
                  const task = state.tasks.find((t) => t.id === a.taskId);
                  return (
                    <div className="row small" key={a.id} style={{ gap: 8, padding: "4px 0" }}>
                      <Avatar user={actor} size={20} />
                      <span className="grow truncate">
                        <b style={{ fontWeight: 500 }}>{actor?.name}</b>{" "}
                        {a.type === "completed" ? "completed" : "updated"}{" "}
                        {task?.name ?? "a task"}
                      </span>
                      <span className="weak">{relativeTime(a.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
