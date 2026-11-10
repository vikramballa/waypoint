import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../core/store";
import type { FieldDef, ID, Task } from "../core/types";
import { navigate } from "../core/router";
import { subtasksOf } from "../core/selectors";
import {
  diffDays,
  dueState,
  formatDue,
  formatFullDate,
  relativeTime,
  todayISO,
} from "../core/utils";
import { Icon } from "../ui/icons";
import { AgentRunReview, ApprovalPanel, AttachmentsSection, EstimateField, PresenceAvatars, RecurrenceField } from "./TaskExtras";
import {
  AutoGrowTextarea,
  Avatar,
  Checkbox,
  ConfirmButton,
  DatePicker,
  FieldEditor,
  FieldValueView,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  PriorityPill,
  TagPill,
  UserPicker,
  usePopover,
  TaskCheckbox,
  ApprovalMark,
  approvalLabel,
} from "../ui/primitives";

function ActivityFeed({ task }: { task: Task }) {
  const { state, userById, dispatch, user } = useApp();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const items = useMemo(() => {
    const comments = state.comments
      .filter((c) => c.taskId === task.id)
      .map((c) => ({ kind: "comment" as const, at: c.createdAt, data: c }));
    const acts = state.activities
      .filter((a) => a.taskId === task.id && a.type !== "comment")
      .map((a) => ({ kind: "activity" as const, at: a.createdAt, data: a }));
    return [...comments, ...acts].sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [state.comments, state.activities, task.id]);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    dispatch({ type: "comment/create", taskId: task.id, text: value });
    setText("");
  };

  const describe = (a: (typeof items)[number]) => {
    if (a.kind === "comment") return null;
    const { type, from, to, detail } = a.data;
    switch (type) {
      case "created":
        return "created this task";
      case "completed":
        return "completed this task";
      case "uncompleted":
        return "marked this task incomplete";
      case "assigned":
        return `assigned this task to ${to}`;
      case "due-date":
        return `changed the due date to ${to ? formatDue(to) : "none"}`;
      case "section":
        return `moved this task to ${to}`;
      case "priority":
        return `set priority to ${to}`;
      case "description":
        return "updated the description";
      case "attachment":
        return `attached ${detail}`;
      case "field":
        return `changed ${detail}`;
      case "moved-project":
        return `moved this task to ${to}`;
      case "duplicated":
        return "duplicated this task";
      case "rule":
        return detail ?? "an automation ran";
      case "dependency":
        return detail ?? "changed a dependency";
      case "approval":
        return `${detail ?? "decided on"} this task`;
      default:
        return "updated this task";
    }
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="pane-section-title">
        <Icon name="comment" size={14} /> Activity
      </div>
      <div className="composer">
        <Avatar user={user} size={28} />
        <div className="input-wrap">
          <textarea
            ref={inputRef}
            placeholder="Add a comment…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-tools">
            <button className="icon-btn sm" title="Mention someone">
              <Icon name="person" size={13} />
            </button>
            <button className="icon-btn sm" title="Attach a file">
              <Icon name="paperclip" size={13} />
            </button>
            <button className="icon-btn sm" title="Add emoji">
              <Icon name="sparkle" size={13} />
            </button>
            <div style={{ flex: 1 }} />
            <button
              className="btn btn-primary btn-sm"
              disabled={!text.trim()}
              onClick={submit}
            >
              Comment
            </button>
          </div>
        </div>
      </div>

      <div className="col" style={{ gap: 2, marginTop: 6 }}>
        {items.map((item) => {
          if (item.kind === "activity") {
            const actor = userById(item.data.actorId);
            return (
              <div className="activity" key={item.data.id}>
                <Avatar user={actor} size={20} />
                <span>
                  <b>{actor?.name ?? "Someone"}</b> {describe(item)} ·{" "}
                  {relativeTime(item.at)}
                </span>
              </div>
            );
          }
          const c = item.data;
          const author = userById(c.authorId);
          const liked = c.likeUserIds.includes(state.currentUserId);
          return (
            <div className="comment" key={c.id}>
              <Avatar user={author} size={28} />
              <div className="comment-body">
                <div className="comment-head">
                  <span className="comment-author">{author?.name ?? "Unknown"}</span>
                  <span>{relativeTime(c.createdAt)}</span>
                </div>
                <div className="comment-text">{c.text}</div>
                <div className="comment-actions">
                  <button
                    className="icon-btn"
                    title="Like"
                    style={liked ? { color: "var(--color-danger-icon)" } : undefined}
                    onClick={() => dispatch({ type: "comment/like", id: c.id })}
                  >
                    <Icon name="heart" size={13} filled={liked} />
                  </button>
                  {c.likeUserIds.length > 0 && (
                    <span className="like-count">
                      <Icon name="heart" size={11} filled /> {c.likeUserIds.length}
                    </span>
                  )}
                  <button
                    className="icon-btn"
                    title="Reply"
                    onClick={() => {
                      setText(`@${author?.name.split(" ")[0]} `);
                      inputRef.current?.focus();
                    }}
                  >
                    <Icon name="comment" size={13} />
                  </button>
                  {c.authorId === state.currentUserId && (
                    <button
                      className="icon-btn"
                      title="Delete comment"
                      onClick={() => dispatch({ type: "comment/delete", id: c.id })}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DependencyPicker({
  task,
  kind,
  children,
}: {
  task: Task;
  kind: "blocked-by" | "blocking";
  children: (open: (el: Element) => void) => React.ReactNode;
}) {
  const { state, dispatch } = useApp();
  const pop = usePopover();
  const [q, setQ] = useState("");
  const linked = kind === "blocked-by" ? task.blockedByIds : task.blockingIds;
  const candidates = state.tasks.filter(
    (t) =>
      t.id !== task.id &&
      !t.parentId &&
      t.name.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <>
      {children((el) => pop.openAt(el))}
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={300}>
          <div style={{ padding: 4 }}>
            <MenuLabel>{kind === "blocked-by" ? "Blocked by" : "Blocking"}</MenuLabel>
            <input
              className="input"
              autoFocus
              placeholder="Search tasks…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ margin: "4px 4px 6px", width: "calc(100% - 8px)" }}
            />
            <div style={{ maxHeight: 260, overflowY: "auto" }}>
              {candidates.slice(0, 40).map((t) => (
                <button
                  key={t.id}
                  className="menu-item"
                  onClick={() => {
                    dispatch({ type: "task/toggleDependency", id: task.id, otherId: t.id, kind });
                  }}
                >
                  <span className="menu-check">
                    {linked.includes(t.id) && <Icon name="check" size={13} />}
                  </span>
                  <span className="grow truncate">{t.name}</span>
                  {t.completed && <span className="small weak">Done</span>}
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

export function TaskPane({
  taskId,
  onClose,
  onOpenTask,
}: {
  taskId: ID;
  onClose: () => void;
  onOpenTask: (id: ID) => void;
}) {
  const { state, dispatch, userById, toast, user, undo, can } = useApp();
  const task = state.tasks.find((t) => t.id === taskId);
  const [title, setTitle] = useState(task?.name ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [width, setWidth] = useState(600);
  const menuPop = usePopover();
  const subPop = usePopover();
  const tagPop = usePopover();
  const initialNotes = useRef(task?.notes ?? "");

  useEffect(() => {
    setTitle(task?.name ?? "");
    setNotes(task?.notes ?? "");
    initialNotes.current = task?.notes ?? "";
  }, [taskId, task?.name]);

  if (!task) {
    return (
      <aside className="pane">
        <div className="pane-header">
          <div className="crumbs">Task not found</div>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </aside>
    );
  }

  const project = state.projects.find((p) => p.id === task.projectId);
  const section = state.sections.find((s) => s.id === task.sectionId);
  const assignee = userById(task.assigneeId);
  const subs = subtasksOf(state, task.id);
  const siblingTasks = state.tasks.filter((t) => t.projectId === task.projectId);
  const fields = state.fields.filter(
    (f) =>
      f.id !== "fld-priority" &&
      (project?.fieldIds.includes(f.id) || task.customFields[f.id] != null)
  );
  const due = dueState(task.dueDate, task.completed);
  const watching = task.followerIds.includes(state.currentUserId);
  const liked = task.likeUserIds.includes(state.currentUserId);
  const agentAssignee = state.users.find((u) => u.id === task.assigneeId && u.isAgent);
  const taskRuns = agentAssignee
    ? state.agentRuns.filter((r) => r.taskId === task.id && r.teammateId === agentAssignee.id)
    : [];
  const liveRun = taskRuns.find((r) => r.status === "running" || r.status === "queued");
  const recentRun =
    liveRun ??
    taskRuns.find(
      (r) =>
        r.status === "done" &&
        r.finishedAt &&
        Date.now() - new Date(r.finishedAt).getTime() < 15 * 60 * 1000
    );
  const activeRun = recentRun;
  const runIsLive = Boolean(liveRun);

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== task.name) dispatch({ type: "task/rename", id: task.id, name: next });
  };
  const commitNotes = () => {
    if (notes !== initialNotes.current) {
      initialNotes.current = notes;
      dispatch({ type: "task/update", id: task.id, patch: { notes } });
    }
  };

  return (
    <aside className="pane" style={{ width, minWidth: 380, maxWidth: "70vw" }}>
      <div
        className="pane-grip"
        onMouseDown={(e) => {
          const startX = e.clientX;
          const startW = width;
          const onMove = (ev: MouseEvent) =>
            setWidth(Math.max(380, Math.min(window.innerWidth * 0.7, startW - (ev.clientX - startX))));
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }}
      />
      <div className="pane-header">
        <div className="crumbs">
          <PresenceAvatars taskId={task.id} />
          {project && (
            <button
              className="row"
              style={{ gap: 6, color: "inherit" }}
              onClick={() => navigate(`/project/${project.id}/list`)}
            >
              <span
                className="swatch"
                style={{ background: `var(--swatch-${project.color}-bg)` }}
              />
              {project.name}
            </button>
          )}
          {section && (
            <>
              <Icon name="chevron-right" size={11} />
              <span>{section.name}</span>
            </>
          )}
          {task.parentId && (
            <>
              <Icon name="chevron-right" size={11} />
              <button
                style={{ color: "inherit" }}
                onClick={() => onOpenTask(task.parentId as string)}
              >
                {state.tasks.find((t) => t.id === task.parentId)?.name}
              </button>
            </>
          )}
        </div>
        <button className="icon-btn" title="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="pane-body scroll-y">
        {!can("task:edit", task.projectId) && (
          <div
            className="row small"
            style={{
              gap: 8,
              padding: "8px 10px",
              borderRadius: 8,
              background: "var(--color-warning-background)",
              color: "var(--color-warning-text)",
              border: "1px solid var(--color-warning-border)",
            }}
          >
            <Icon name="lock" size={13} />
            Read-only: your role on this project does not allow edits.
          </div>
        )}
        <div className="pane-title-row">
          <TaskCheckbox task={task} size={20} undoToast />
          <AutoGrowTextarea
            className="pane-title"
            value={title}
            onChange={setTitle}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
          />
        </div>

        {task.approvalStatus && <ApprovalPanel taskId={task.id} />}
        <AgentRunReview taskId={task.id} />

        <div className="pane-grid">
          <div className="k">
            <Icon name="person" size={13} /> Assignee
          </div>
          <div className="v">
            <UserPicker
              value={task.assigneeId}
              onChange={(id) => dispatch({ type: "task/setAssignee", id: task.id, userId: id })}
            >
              {(open) => (
                <button className="field-hover" onClick={(e) => open(e.currentTarget)}>
                  {assignee ? (
                    <>
                      <Avatar user={assignee} size={22} />
                      {assignee.name}
                      {assignee.isAgent && <span className="ai-badge">AI</span>}
                    </>
                  ) : (
                    <span className="weak">Assign to…</span>
                  )}
                </button>
              )}
            </UserPicker>
          </div>

          <div className="k">
            <Icon name="calendar" size={13} /> Due date
          </div>
          <div className="v">
            <DatePicker
              value={task.dueDate}
              withTime
              time={task.dueTime}
              onTimeChange={(t) =>
                dispatch({ type: "task/update", id: task.id, patch: { dueTime: t }, silent: true })
              }
              onChange={(iso) => dispatch({ type: "task/setDue", id: task.id, dueDate: iso })}
            >
              {(open) => (
                <button
                  className={`field-hover due ${due}`}
                  onClick={(e) => open(e.currentTarget)}
                >
                  <Icon name="calendar" size={13} />
                  {task.dueDate ? (
                    <>
                      {formatFullDate(task.dueDate)}
                      {task.dueTime ? ` at ${task.dueTime}` : ""}
                    </>
                  ) : (
                    <span className="weak">Set due date</span>
                  )}
                </button>
              )}
            </DatePicker>
            {task.dueDate && (
              <button
                className="icon-btn sm"
                title="Clear due date"
                onClick={() => dispatch({ type: "task/setDue", id: task.id, dueDate: null })}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>

          <div className="k">
            <Icon name="timeline" size={13} /> Start date
          </div>
          <div className="v">
            <DatePicker
              value={task.startDate}
              onChange={(iso) =>
                dispatch({
                  type: "task/update",
                  id: task.id,
                  patch: { startDate: iso },
                  silent: true,
                })
              }
            >
              {(open) => (
                <button className="field-hover" onClick={(e) => open(e.currentTarget)}>
                  <Icon name="timeline" size={13} />
                  {task.startDate ? (
                    formatFullDate(task.startDate)
                  ) : (
                    <span className="weak">Set start date</span>
                  )}
                </button>
              )}
            </DatePicker>
          </div>

          <div className="k">
            <Icon name="flag" size={13} /> Priority
          </div>
          <div className="v">
            <PriorityPicker task={task} />
          </div>

          <div className="k">
            <Icon name="board" size={13} /> Projects
          </div>
          <div className="v">
            <ProjectPicker task={task} />
          </div>

          <div className="k">
            <Icon name="layout-list" size={13} /> Section
          </div>
          <div className="v">
            <SectionPicker task={task} />
          </div>

          {fields.map((field) => (
            <FieldRow key={field.id} field={field} task={task} />
          ))}

          <div className="k">
            <Icon name="tag" size={13} /> Tags
          </div>
          <div className="v">
            <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
              {task.tagIds.map((id) => {
                const tag = state.tags.find((t) => t.id === id);
                return tag ? (
                  <button
                    key={id}
                    onClick={() => dispatch({ type: "task/toggleTag", id: task.id, tagId: id })}
                    title="Remove tag"
                  >
                    <TagPill name={tag.name} color={tag.color} />
                  </button>
                ) : null;
              })}
              <button
                className="chip outline"
                style={{ height: 22 }}
                onClick={(e) => tagPop.openAt(e.currentTarget)}
              >
                <Icon name="plus" size={11} /> Add tag
              </button>
            </div>
          </div>

          <div className="k">
            <Icon name="users" size={13} /> Collaborators
          </div>
          <div className="v">
            <div className="row" style={{ gap: 2 }}>
              {task.followerIds.map((id) => {
                const u = userById(id);
                return u ? <Avatar key={id} user={u} size={22} ring /> : null;
              })}
              <button
                className="icon-btn sm"
                title="Add collaborator"
                onClick={(e) => subPop.openAt(e.currentTarget)}
              >
                <Icon name="plus" size={12} />
              </button>
            </div>
          </div>

          <div className="k">
            <Icon name="refresh" size={13} /> Repeats
          </div>
          <div className="v">
            <RecurrenceField task={task} editable={can("task:edit", task.projectId)} />
          </div>

          <div className="k">
            <Icon name="clock" size={13} /> Estimate (h)
          </div>
          <div className="v">
            <EstimateField key={task.id} task={task} editable={can("task:edit", task.projectId)} />
          </div>

          <div className="k">
            <Icon name="lock" size={13} /> Dependencies
          </div>
          <div className="v" style={{ flexWrap: "wrap", gap: 6 }}>
            <DependencyPicker task={task} kind="blocked-by">
              {(open) => (
                <button className="dep-pill" onClick={(e) => open(e.currentTarget)}>
                  <span className="dot" style={{ background: "var(--color-danger-icon)" }} />
                  Blocked by {task.blockedByIds.length || "…"}
                </button>
              )}
            </DependencyPicker>
            <DependencyPicker task={task} kind="blocking">
              {(open) => (
                <button className="dep-pill" onClick={(e) => open(e.currentTarget)}>
                  <span className="dot" style={{ background: "var(--color-primary-icon)" }} />
                  Blocking {task.blockingIds.length || "…"}
                </button>
              )}
            </DependencyPicker>
          </div>
        </div>

        {(task.blockedByIds.length > 0 || task.blockingIds.length > 0) && (
          <div className="col" style={{ gap: 4 }}>
            {task.blockedByIds.map((id) => {
              const dep = state.tasks.find((t) => t.id === id);
              if (!dep) return null;
              return (
                <div className="row small" key={id} style={{ gap: 8 }}>
                  <Icon name="lock" size={12} />
                  <button
                    className="grow truncate"
                    style={{ textAlign: "left" }}
                    onClick={() => onOpenTask(dep.id)}
                  >
                    {dep.name}
                  </button>
                  <span className={dep.completed ? "due" : "due overdue"}>
                    {dep.completed ? "Done" : dep.dueDate ? formatDue(dep.dueDate) : "No date"}
                  </span>
                  <button
                    className="icon-btn sm"
                    onClick={() =>
                      dispatch({
                        type: "task/toggleDependency",
                        id: task.id,
                        otherId: dep.id,
                        kind: "blocked-by",
                      })
                    }
                  >
                    <Icon name="close" size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="divider" />

        <div className="col" style={{ gap: 6 }}>
          <div className="pane-section-title">
            <Icon name="align" size={14} /> Description
          </div>
          <AutoGrowTextarea
            className="notes"
            value={notes}
            placeholder="What is this task about? Add context, links and acceptance criteria…"
            onChange={setNotes}
            onBlur={commitNotes}
          />
        </div>

        {activeRun && agentAssignee && (
          <div
            className="stat-card"
            style={{ gap: 6, borderColor: "var(--color-selected-border)", background: "var(--color-selected-background)" }}
          >
            <div className="row" style={{ gap: 8 }}>
              <Avatar user={agentAssignee} size={22} />
              <span style={{ fontWeight: 500 }}>
                {runIsLive
                  ? `${agentAssignee.name} is working on this`
                  : `${agentAssignee.name} finished a run`}
              </span>
              <span className="ai-badge">AI run</span>
              <div style={{ flex: 1 }} />
              {runIsLive ? (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => dispatch({ type: "agent/runCancel", runId: activeRun.id })}
                >
                  Stop
                </button>
              ) : (
                <span className="small weak">
                  {activeRun.steps.filter((s) => s.at).length}/{activeRun.steps.length} steps
                </span>
              )}
            </div>
            {activeRun.steps.map((step, i) => {
              const applied = Boolean(step.at);
              const active = runIsLive && !applied && i === activeRun.cursor;
              return (
                <div className="run-step" key={step.id}>
                  <span className={`run-dot${applied ? " done" : active ? " active" : ""}`}>
                    {applied ? <Icon name="check" size={10} /> : i + 1}
                  </span>
                  <span style={applied ? undefined : { color: "var(--color-text-weak)" }}>
                    {step.label}
                    {step.detail && <span className="small weak"> — {step.detail}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="divider" />

        <div className="col" style={{ gap: 6 }}>
          <div className="row">
            <div className="pane-section-title">
              <Icon name="subtask" size={14} /> Subtasks
            </div>
            <span className="small weak">
              {subs.filter((s) => s.completed).length}/{subs.length}
            </span>
            <div style={{ flex: 1 }} />
            <button
              className="icon-btn sm"
              title="Add subtask"
              onClick={() =>
                dispatch({
                  type: "task/create",
                  patch: { name: "New subtask", parentId: task.id, projectId: task.projectId },
                })
              }
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
          {subs.map((sub) => (
            <div className={`subtask-row${sub.completed ? " done" : ""}`} key={sub.id}>
              <TaskCheckbox task={sub} size={14} />
              <button className="name" onClick={() => onOpenTask(sub.id)}>
                {sub.name}
              </button>
              <Avatar user={userById(sub.assigneeId)} size={20} />
              {sub.dueDate && <span className="small weak">{formatDue(sub.dueDate)}</span>}
            </div>
          ))}
          <div className="row" style={{ gap: 8, padding: "6px 8px" }}>
            <Checkbox checked={false} onChange={() => {}} size={14} />
            <input
              className="input"
              style={{ border: 0, background: "transparent", padding: 0 }}
              placeholder="Add subtask…"
              value={subtaskDraft}
              onChange={(e) => setSubtaskDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && subtaskDraft.trim()) {
                  dispatch({
                    type: "task/create",
                    patch: {
                      name: subtaskDraft.trim(),
                      parentId: task.id,
                      projectId: task.projectId,
                    },
                  });
                  setSubtaskDraft("");
                }
              }}
            />
          </div>
        </div>

        <div className="divider" />

        <AttachmentsSection task={task} />

        <div className="divider" />
        <ActivityFeed task={task} />
      </div>

      <div className="pane-footer">
        <button
          className="icon-btn"
          title="Like this task"
          style={liked ? { color: "var(--color-danger-icon)" } : undefined}
          onClick={() => dispatch({ type: "task/toggleLike", id: task.id })}
        >
          <Icon name="heart" size={15} filled={liked} />
        </button>
        {task.likeUserIds.length > 0 && (
          <span className="small weak">{task.likeUserIds.length}</span>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() =>
            dispatch({ type: "task/toggleFollower", id: task.id, userId: state.currentUserId })
          }
          title={watching ? "Stop watching" : "Watch task"}
        >
          <Icon name="eye" size={14} />
          {watching ? "Watching" : "Watch"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            dispatch({
              type: "task/create",
              patch: { name: "New subtask", parentId: task.id, projectId: task.projectId },
            });
          }}
        >
          <Icon name="subtask" size={14} /> Subtask
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => toast("Share dialog")}>
          <Icon name="users" size={14} /> Share
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="icon-btn"
          title="More actions"
          onClick={(e) => menuPop.openAt(e.currentTarget)}
        >
          <Icon name="dots" size={16} />
        </button>
      </div>

      {tagPop.open && tagPop.anchor && (
        <Popover anchor={tagPop.anchor} onClose={tagPop.close} width={220}>
          <MenuLabel>Tags</MenuLabel>
          {state.tags.map((tag) => (
            <MenuItem
              key={tag.id}
              checked={task.tagIds.includes(tag.id)}
              onClick={() => dispatch({ type: "task/toggleTag", id: task.id, tagId: tag.id })}
            >
              <span
                className="swatch dot"
                style={{ background: `var(--swatch-${tag.color}-bg)` }}
              />
              {tag.name}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            icon={<Icon name="plus" size={13} />}
            onClick={() => {
              const name = prompt("Tag name");
              if (name)
                dispatch({ type: "tag/create", name, color: "blue" });
              tagPop.close();
            }}
          >
            Create tag
          </MenuItem>
        </Popover>
      )}

      {subPop.open && subPop.anchor && (
        <Popover anchor={subPop.anchor} onClose={subPop.close} width={240}>
          <MenuLabel>Collaborators</MenuLabel>
          {state.users.map((u) => (
            <MenuItem
              key={u.id}
              checked={task.followerIds.includes(u.id)}
              onClick={() =>
                dispatch({ type: "task/toggleFollower", id: task.id, userId: u.id })
              }
            >
              <Avatar user={u} size={20} /> {u.name}
            </MenuItem>
          ))}
        </Popover>
      )}

      {menuPop.open && menuPop.anchor && (
        <Popover anchor={menuPop.anchor} onClose={menuPop.close} width={240} align="end">
          <MenuItem
            icon={<Icon name="copy" size={14} />}
            onClick={() => {
              dispatch({ type: "task/duplicate", id: task.id });
              menuPop.close();
            }}
          >
            Duplicate task
          </MenuItem>
          <MenuItem
            icon={<Icon name="link" size={14} />}
            onClick={() => {
              navigator.clipboard?.writeText(`${location.origin}/#/task/${task.id}`);
              toast("Task link copied");
              menuPop.close();
            }}
          >
            Copy task link
          </MenuItem>
          <MenuItem
            icon={<Icon name="milestone" size={14} />}
            onClick={() => {
              dispatch({ type: "task/update", id: task.id, patch: { milestone: !task.milestone } });
              menuPop.close();
            }}
          >
            {task.milestone ? "Remove milestone" : "Convert to milestone"}
          </MenuItem>
          {can("task:edit", task.projectId) && (
            <MenuItem
              icon={<Icon name="approval" size={14} />}
              onClick={() => {
                const toApproval = !task.approvalStatus;
                dispatch({
                  type: "task/update",
                  id: task.id,
                  patch: { approvalStatus: toApproval ? "pending" : undefined },
                });
                toast(toApproval ? "Converted to an approval — the assignee decides" : "Converted to a regular task");
                menuPop.close();
              }}
            >
              {task.approvalStatus ? "Convert to regular task" : "Convert to approval"}
            </MenuItem>
          )}
          {can("task:edit", task.projectId) && task.projectId && !task.parentId && (
            <MenuItem
              icon={<Icon name="copy" size={14} />}
              onClick={() => {
                const name = prompt("Template name", task.name);
                if (name?.trim()) {
                  dispatch({ type: "taskTemplate/create", name: name.trim(), fromTaskId: task.id });
                  toast("Saved as a template for this project");
                }
                menuPop.close();
              }}
            >
              Save as template
            </MenuItem>
          )}
          <MenuItem
            icon={<Icon name="arrow-up-right" size={14} />}
            onClick={() => {
              navigate(`/task/${task.id}`);
              menuPop.close();
            }}
          >
            Open as page
          </MenuItem>
          <MenuSeparator />
          <ConfirmButton
            label="Delete task"
            confirmLabel="Click again to delete"
            icon={<Icon name="trash" size={14} />}
            onConfirm={() => {
              dispatch({ type: "task/delete", id: task.id });
              onClose();
              toast("Task deleted", "Undo", undo);
            }}
          />
        </Popover>
      )}
    </aside>
  );
}

function FieldRow({ field, task }: { field: FieldDef; task: Task }) {
  const { state, dispatch } = useApp();
  return (
    <>
      <div className="k">{field.name}</div>
      <div className="v">
        <FieldEditor
          field={field}
          value={task.customFields[field.id] ?? null}
          onChange={(v) =>
            dispatch({ type: "task/setField", id: task.id, fieldId: field.id, value: v })
          }
        >
          {(open) => (
            <button className="field-hover" onClick={(e) => open(e.currentTarget)}>
              <FieldValueView
                field={field}
                value={task.customFields[field.id] ?? null}
                state={state}
              />
            </button>
          )}
        </FieldEditor>
      </div>
    </>
  );
}

function PriorityPicker({ task }: { task: Task }) {
  const { dispatch } = useApp();
  const pop = usePopover();
  return (
    <>
      <button className="field-hover" onClick={(e) => pop.openAt(e.currentTarget)}>
        {task.priority ? (
          <PriorityPill priority={task.priority} />
        ) : (
          <span className="weak">Set priority</span>
        )}
      </button>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={180}>
          {(["high", "medium", "low"] as const).map((p) => (
            <MenuItem
              key={p}
              checked={task.priority === p}
              onClick={() => {
                dispatch({ type: "task/setPriority", id: task.id, priority: p });
                pop.close();
              }}
            >
              <PriorityPill priority={p} />
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              dispatch({ type: "task/setPriority", id: task.id, priority: null });
              pop.close();
            }}
          >
            Clear
          </MenuItem>
        </Popover>
      )}
    </>
  );
}

function ProjectPicker({ task }: { task: Task }) {
  const { state, dispatch } = useApp();
  const pop = usePopover();
  const project = state.projects.find((p) => p.id === task.projectId);
  return (
    <>
      <button className="field-hover" onClick={(e) => pop.openAt(e.currentTarget)}>
        {project ? (
          <>
            <span
              className="swatch"
              style={{ background: `var(--swatch-${project.color}-bg)` }}
            />
            {project.name}
          </>
        ) : (
          <span className="weak">Add to project</span>
        )}
      </button>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={260}>
          <MenuLabel>Projects</MenuLabel>
          {state.projects.map((p) => (
            <MenuItem
              key={p.id}
              checked={p.id === task.projectId}
              onClick={() => {
                dispatch({ type: "task/move", id: task.id, projectId: p.id });
                pop.close();
              }}
            >
              <span
                className="swatch"
                style={{ background: `var(--swatch-${p.color}-bg)` }}
              />
              {p.name}
            </MenuItem>
          ))}
        </Popover>
      )}
    </>
  );
}

function SectionPicker({ task }: { task: Task }) {
  const { state, dispatch } = useApp();
  const pop = usePopover();
  const section = state.sections.find((s) => s.id === task.sectionId);
  const sections = state.sections.filter((s) => s.projectId === task.projectId);
  return (
    <>
      <button className="field-hover" onClick={(e) => pop.openAt(e.currentTarget)}>
        {section ? section.name : <span className="weak">No section</span>}
      </button>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={220}>
          {sections.map((s) => (
            <MenuItem
              key={s.id}
              checked={s.id === task.sectionId}
              onClick={() => {
                dispatch({ type: "task/move", id: task.id, sectionId: s.id });
                pop.close();
              }}
            >
              {s.name}
            </MenuItem>
          ))}
        </Popover>
      )}
    </>
  );
}

