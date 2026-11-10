import React, { useMemo, useState } from "react";
import { useApp } from "../core/store";
import type { ID, ViewKey } from "../core/types";
import { navigate } from "../core/router";
import {
  portfolioRollup,
  projectStats,
  projectTasks,
  sectionsOf,
} from "../core/selectors";
import {
  csvEscape,
  diffDays,
  downloadFile,
  formatDue,
  formatFullDate,
  relativeTime,
  swatchBg,
  swatchFg,
  todayISO,
} from "../core/utils";
import { Icon } from "../ui/icons";
import { PresenceAvatars } from "./TaskExtras";
import { TaskList, AddTaskRow } from "../ui/TaskList";
import {
  Avatar,
  AvatarStack,
  ColorGrid,
  ConfirmButton,
  EmptyState,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Modal,
  Popover,
  ProgressBar,
  usePopover,
} from "../ui/primitives";
import { BoardView } from "./Board";
import { TimelineView } from "./Timeline";
import { CalendarView } from "./CalendarView";
import { ProjectDashboard } from "./Dashboard";
import { ProjectFormTab } from "./Forms";

const TABS: { key: ViewKey; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "align" },
  { key: "list", label: "List", icon: "list" },
  { key: "board", label: "Board", icon: "board" },
  { key: "timeline", label: "Timeline", icon: "timeline" },
  { key: "calendar", label: "Calendar", icon: "calendar" },
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "files", label: "Files", icon: "folder" },
  { key: "messages", label: "Messages", icon: "messages" },
  { key: "form", label: "Form", icon: "form" },
];

export function ProjectView({
  projectId,
  view,
  taskId,
  onOpenTask,
  onOpenInvite,
  onOpenRules,
  onOpenFields,
}: {
  projectId: ID;
  view: ViewKey;
  taskId?: string;
  onOpenTask: (id: ID) => void;
  onOpenInvite: () => void;
  onOpenRules: () => void;
  onOpenFields: () => void;
}) {
  const { state, dispatch, userById, toast } = useApp();
  const project = state.projects.find((p) => p.id === projectId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project?.name ?? "");
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const sharePop = usePopover();
  const menuPop = usePopover();
  const colorPop = usePopover();
  const addTabPop = usePopover();
  const [shareOpen, setShareOpen] = useState(false);

  const sections = useMemo(
    () => (project ? sectionsOf(state, project.id) : []),
    [state, project?.id]
  );

  if (!project) {
    return (
      <div className="page">
        <EmptyState
          icon="folder"
          title="Project not found"
          description="It may have been deleted, or you don't have access to it. Ask a project owner to invite you."
          action={
            <button className="btn btn-primary" onClick={() => navigate("/home")}>
              Back to home
            </button>
          }
        />
      </div>
    );
  }

  const stats = projectStats(state, project.id);
  const team = state.teams.find((t) => t.id === project.teamId);
  const tasks = projectTasks(state, project.id);

  const groups = sections.map((section) => ({
    key: section.id,
    name: section.name,
    sectionId: section.id,
    tasks: tasks.filter((t) => t.sectionId === section.id),
  }));

  const setView = (next: ViewKey) =>
    navigate(`/project/${project.id}/${next}${taskId ? `?task=${taskId}` : ""}`);

  const addSection = () =>
    dispatch({ type: "section/create", projectId: project.id, name: "New section" });

  const exportCsv = () => {
    const header = ["Task", "Assignee", "Due date", "Section", "Completed", "Priority"];
    const rows = tasks.map((t) => [
      t.name,
      userById(t.assigneeId)?.name ?? "",
      t.dueDate ?? "",
      state.sections.find((s) => s.id === t.sectionId)?.name ?? "",
      t.completed ? "yes" : "no",
      t.priority ?? "",
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    downloadFile(`${project.name.replace(/\s+/g, "-").toLowerCase()}.csv`, csv, "text/csv");
    toast("CSV exported");
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <button
            className="row"
            style={{ gap: 8 }}
            onClick={(e) => colorPop.openAt(e.currentTarget)}
            title="Change color"
          >
            <span
              className="mini-project-icon"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: swatchBg(project.color),
                color: swatchFg(project.color),
                fontSize: 13,
              }}
            >
              <Icon name={project.icon} size={15} />
            </span>
          </button>
          {renaming ? (
            <input
              className="title-input"
              autoFocus
              value={name}
              style={{ fontSize: 24, fontWeight: 500, maxWidth: 480 }}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                setRenaming(false);
                if (name.trim()) dispatch({ type: "project/update", id: project.id, patch: { name: name.trim() } });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <h1 className="page-title">
              <button
                style={{ fontSize: "inherit", fontWeight: "inherit" }}
                onClick={() => {
                  setName(project.name);
                  setRenaming(true);
                }}
              >
                {project.name}
              </button>
            </h1>
          )}
          <button
            className="icon-btn"
            title={project.starred ? "Unstar project" : "Star project"}
            onClick={() => dispatch({ type: "project/toggleStar", id: project.id })}
            style={project.starred ? { color: "#e9c300" } : undefined}
          >
            <Icon name="star" size={16} filled={project.starred} />
          </button>
          {project.privacy === "private" && (
            <span className="chip" title="Private project">
              <Icon name="lock" size={11} /> Private
            </span>
          )}
          <div className="page-actions">
            <PresenceAvatars projectId={project.id} />
            <AvatarStack users={project.memberIds.map((id) => userById(id))} size={26} />
            <button className="btn btn-secondary" onClick={() => setShareOpen(true)}>
              <Icon name="users" size={13} /> Share
            </button>
            <button className="icon-btn" onClick={(e) => menuPop.openAt(e.currentTarget)} title="Project actions">
              <Icon name="dots" size={16} />
            </button>
          </div>
        </div>
        <p className="page-subtitle">
          {team?.name} · {stats.done}/{stats.total} tasks complete ·{" "}
          {project.dueDate ? `due ${formatFullDate(project.dueDate)}` : "no due date"}
        </p>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab${view === t.key ? " active" : ""}`}
            onClick={() => setView(t.key)}
          >
            <Icon name={t.icon} size={13} />
            {t.label}
          </button>
        ))}
        <button className="tab" onClick={(e) => addTabPop.openAt(e.currentTarget)} title="Add tab">
          <Icon name="plus" size={13} />
        </button>
      </div>

      {view === "list" && (
        <TaskList
          groups={groups}
          projectId={project.id}
          onOpenTask={onOpenTask}
          onAddSection={addSection}
          toolbarTasks={tasks}
        />
      )}
      {view === "board" && (
        <BoardView projectId={project.id} sections={sections} onOpenTask={onOpenTask} />
      )}
      {view === "timeline" && <TimelineView projectId={project.id} onOpenTask={onOpenTask} />}
      {view === "calendar" && <CalendarView projectId={project.id} onOpenTask={onOpenTask} />}
      {view === "dashboard" && <ProjectDashboard projectId={project.id} />}
      {view === "overview" && (
        <ProjectOverview
          projectId={project.id}
          onOpenTask={onOpenTask}
          onOpenInvite={onOpenInvite}
        />
      )}
      {view === "files" && <ProjectFiles projectId={project.id} onOpenTask={onOpenTask} />}
      {view === "messages" && <ProjectMessages projectId={project.id} />}
      {view === "form" && <ProjectFormTab projectId={project.id} />}

      {shareOpen && (
        <Modal
          title={`Share “${project.name}”`}
          icon={<Icon name="users" size={16} />}
          onClose={() => setShareOpen(false)}
          footer={
            <button className="btn btn-primary" onClick={() => setShareOpen(false)}>
              Done
            </button>
          }
        >
          <label className="small weak">Invite with email</label>
          <input className="input" placeholder="name@company.com" />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={onOpenInvite}>
              <Icon name="link" size={12} /> Copy project link
            </button>
            <span className="small weak">
              {project.privacy === "private"
                ? "Only invited members can access this project."
                : "Anyone in the workspace can access this project."}
            </span>
          </div>
          <div className="divider" />
          <label className="small weak">Members</label>
          {project.memberIds.map((id) => {
            const u = userById(id);
            if (!u) return null;
            return (
              <div className="row" key={id} style={{ gap: 10, padding: "4px 0" }}>
                <Avatar user={u} size={28} />
                <div className="col grow">
                  <span>{u.name}</span>
                  <span className="small weak">{u.email}</span>
                </div>
                <span className="chip">{id === project.ownerId ? "Owner" : "Editor"}</span>
              </div>
            );
          })}
        </Modal>
      )}

      {colorPop.open && colorPop.anchor && (
        <Popover anchor={colorPop.anchor} onClose={colorPop.close} width={220}>
          <MenuLabel>Project color</MenuLabel>
          <div style={{ padding: 8 }}>
            <ColorGrid
              value={project.color}
              onChange={(c) => {
                dispatch({ type: "project/update", id: project.id, patch: { color: c } });
                colorPop.close();
              }}
            />
          </div>
        </Popover>
      )}

      {menuPop.open && menuPop.anchor && (
        <Popover anchor={menuPop.anchor} onClose={menuPop.close} width={250} align="end">
          <MenuItem
            icon={<Icon name="align" size={14} />}
            onClick={() => {
              setName(project.name);
              setRenaming(true);
              menuPop.close();
            }}
          >
            Rename project
          </MenuItem>
          <MenuItem
            icon={<Icon name="lock" size={14} />}
            onClick={() => {
              dispatch({
                type: "project/update",
                id: project.id,
                patch: { privacy: project.privacy === "public" ? "private" : "public" },
              });
              menuPop.close();
            }}
          >
            {project.privacy === "public" ? "Make private" : "Make public"}
          </MenuItem>
          <MenuItem
            icon={<Icon name="zap" size={14} />}
            onClick={() => {
              menuPop.close();
              onOpenRules();
            }}
          >
            Manage automations
          </MenuItem>
          <MenuItem
            icon={<Icon name="grid" size={14} />}
            onClick={() => {
              menuPop.close();
              onOpenFields();
            }}
          >
            Customize fields
          </MenuItem>
          <MenuItem
            icon={<Icon name="download" size={14} />}
            onClick={() => {
              exportCsv();
              menuPop.close();
            }}
          >
            Export as CSV
          </MenuItem>
          <MenuItem
            icon={<Icon name="copy" size={14} />}
            onClick={() => {
              navigator.clipboard?.writeText(`${location.origin}/#/project/${project.id}/list`);
              toast("Project link copied");
              menuPop.close();
            }}
          >
            Copy project link
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Icon name="archive" size={14} />}
            onClick={() => {
              dispatch({ type: "project/update", id: project.id, patch: { archived: true } });
              navigate("/home");
              toast("Project archived");
            }}
          >
            Archive project
          </MenuItem>
          <ConfirmButton
            label="Delete project"
            confirmLabel="Click again to delete"
            icon={<Icon name="trash" size={14} />}
            onConfirm={() => {
              dispatch({ type: "project/delete", id: project.id });
              navigate("/home");
              toast("Project deleted");
            }}
          />
        </Popover>
      )}

      {addTabPop.open && addTabPop.anchor && (
        <Popover anchor={addTabPop.anchor} onClose={addTabPop.close} width={240}>
          <MenuLabel>Saved views</MenuLabel>
          <MenuItem icon={<Icon name="list" size={14} />} onClick={() => { setView("list"); addTabPop.close(); }}>
            My incomplete tasks
          </MenuItem>
          <MenuItem
            icon={<Icon name="calendar" size={14} />}
            onClick={() => {
              setView("calendar");
              addTabPop.close();
            }}
          >
            Due this week
          </MenuItem>
          <MenuItem icon={<Icon name="chart" size={14} />} onClick={() => { setView("dashboard"); addTabPop.close(); }}>
            Project dashboard
          </MenuItem>
        </Popover>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- overview */
function ProjectOverview({
  projectId,
  onOpenTask,
  onOpenInvite,
}: {
  projectId: ID;
  onOpenTask: (id: ID) => void;
  onOpenInvite: () => void;
}) {
  const { state, dispatch, userById } = useApp();
  const project = state.projects.find((p) => p.id === projectId);
  const [description, setDescription] = useState(project?.description ?? "");
  const stats = projectStats(state, projectId);
  const tasks = projectTasks(state, projectId);
  const milestones = tasks.filter((t) => t.milestone || (t.dueDate && !t.completed)).slice(0, 5);
  const [showReport, setShowReport] = useState(false);
  if (!project) return null;
  const owner = userById(project.ownerId);
  const team = state.teams.find((t) => t.id === project.teamId);

  return (
    <div className="page-scroll">
      <div style={{ padding: "16px 24px 64px", maxWidth: 1200 }}>
        <div className="grid-cards" style={{ gridTemplateColumns: "2fr 1fr" }}>
          <div className="stat-card">
            <h4>Project description</h4>
            <textarea
              className="textarea"
              style={{ minHeight: 96, border: "1px solid transparent", background: "transparent" }}
              value={description}
              placeholder="What is this project about?"
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() =>
                dispatch({ type: "project/update", id: project.id, patch: { description } })
              }
            />
            <div className="divider" />
            <div className="row" style={{ gap: 24 }}>
              <div className="col">
                <span className="small weak">Owner</span>
                <span className="row" style={{ gap: 6 }}>
                  <Avatar user={owner} size={22} /> {owner?.name}
                </span>
              </div>
              <div className="col">
                <span className="small weak">Team</span>
                <span>{team?.name}</span>
              </div>
              <div className="col">
                <span className="small weak">Due date</span>
                <span>{project.dueDate ? formatFullDate(project.dueDate) : "—"}</span>
              </div>
              <div className="col">
                <span className="small weak">Status</span>
                <span className={`status-pill status-${project.status.state}`}>
                  {project.status.state === "none" ? "No status" : project.status.state.replace("-", " ")}
                </span>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <h4>Progress</h4>
            <div className="stat-value">{stats.percent}%</div>
            <ProgressBar percent={stats.percent} />
            <div className="row small weak">
              <span>{stats.done} complete</span>
              <div style={{ flex: 1 }} />
              <span>{stats.open} open</span>
            </div>
            <div className="divider" />
            <h4>Team</h4>
            <AvatarStack users={project.memberIds.map((id) => userById(id))} size={26} />
            <button className="btn btn-secondary btn-sm" onClick={onOpenInvite} style={{ marginTop: 8 }}>
              <Icon name="plus" size={12} /> Invite
            </button>
          </div>

          <div className="stat-card">
            <h4>Upcoming milestones & due work</h4>
            {milestones.length === 0 && <span className="small weak">Nothing scheduled</span>}
            {milestones.map((t) => (
              <div className="row" key={t.id} style={{ gap: 8, padding: "6px 0" }}>
                <Icon name={t.milestone ? "milestone" : "calendar"} size={13} />
                <button className="grow truncate" style={{ textAlign: "left" }} onClick={() => onOpenTask(t.id)}>
                  {t.name}
                </button>
                {t.dueDate && (
                  <span
                    className={`small ${
                      t.dueDate < todayISO() ? "due overdue" : "weak"
                    }`}
                  >
                    {formatDue(t.dueDate)}
                    {t.dueDate < todayISO() ? ` · ${Math.abs(diffDays(t.dueDate, todayISO()))}d late` : ""}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="stat-card">
            <h4>Status updates</h4>
            {project.statusUpdates.length === 0 && (
              <span className="small weak">No updates yet — share progress with the team.</span>
            )}
            {project.statusUpdates.slice(0, 3).map((su) => (
              <div key={su.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--color-border)" }}>
                <div className="row">
                  <span className={`status-pill status-${su.state}`}>{su.state.replace("-", " ")}</span>
                  <span className="small weak">{relativeTime(su.createdAt)}</span>
                </div>
                <div style={{ fontWeight: 500, marginTop: 4 }}>{su.title}</div>
                <div className="small" style={{ lineHeight: "18px" }}>
                  {su.text}
                </div>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" onClick={() => setShowReport(true)}>
              <Icon name="chart" size={12} /> Project brief
            </button>
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 500 }}>Recently added tasks</h3>
          {tasks.slice(0, 6).map((t) => (
            <div className="row" key={t.id} style={{ gap: 8, padding: "6px 0" }}>
              <Icon name="check-circle" size={13} />
              <button className="grow truncate" style={{ textAlign: "left" }} onClick={() => onOpenTask(t.id)}>
                {t.name}
              </button>
              <Avatar user={userById(t.assigneeId)} size={20} />
            </div>
          ))}
        </div>
      </div>

      {showReport && (
        <Modal
          title="Project brief"
          icon={<Icon name="chart" size={16} />}
          onClose={() => setShowReport(false)}
          wide
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setShowReport(false)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  navigator.clipboard?.writeText(
                    `${project.name}\n${project.description}\n\n${stats.done}/${stats.total} tasks complete (${stats.percent}%)`
                  );
                  setShowReport(false);
                }}
              >
                Copy brief
              </button>
            </>
          }
        >
          <h2 style={{ margin: 0 }}>{project.name}</h2>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="chip">{team?.name}</span>
            <span className="chip">Owner: {owner?.name}</span>
            <span className="chip">{stats.total} tasks</span>
            <span className="chip">{stats.percent}% complete</span>
            <span className="chip">{stats.overdue} overdue</span>
          </div>
          <p style={{ lineHeight: "22px" }}>{project.description}</p>
          <div className="divider" />
          <h4>Open work</h4>
          {tasks
            .filter((t) => !t.completed)
            .slice(0, 12)
            .map((t) => (
              <div className="row" key={t.id} style={{ gap: 8, padding: "4px 0" }}>
                <span className="grow truncate">{t.name}</span>
                <span className="small weak">
                  {userById(t.assigneeId)?.name ?? "Unassigned"}
                </span>
                <span className="small weak">{t.dueDate ? formatDue(t.dueDate) : "—"}</span>
              </div>
            ))}
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- files */
function ProjectFiles({ projectId, onOpenTask }: { projectId: ID; onOpenTask: (id: ID) => void }) {
  const { state } = useApp();
  const tasks = state.tasks.filter((t) => t.projectId === projectId && t.attachments.length > 0);
  return (
    <div className="page-scroll">
      <div style={{ padding: "16px 24px 48px", maxWidth: 1000 }}>
        {tasks.length === 0 && (
          <EmptyState
            icon="folder"
            title="No files yet"
            description="Files attached to tasks in this project will appear here."
          />
        )}
        {tasks.map((task) => (
          <div key={task.id} style={{ marginBottom: 16 }}>
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <button
                style={{ fontWeight: 500, textAlign: "left" }}
                onClick={() => onOpenTask(task.id)}
              >
                {task.name}
              </button>
              <span className="small weak">{task.attachments.length} files</span>
            </div>
            {task.attachments.map((att) => (
              <div
                key={att.id}
                className="row"
                style={{
                  gap: 10,
                  padding: "8px 10px",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  marginBottom: 6,
                }}
              >
                <Icon
                  name={att.kind === "image" ? "image" : att.kind === "link" ? "link" : "files"}
                  size={16}
                />
                <div className="col grow">
                  <span>{att.name}</span>
                  <span className="small weak">{att.meta}</span>
                </div>
                <span className="small weak">
                  {state.users.find((u) => u.id === att.addedById)?.name}
                </span>
                <span className="small weak">{relativeTime(att.createdAt)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- messages */
function ProjectMessages({ projectId }: { projectId: ID }) {
  const { state, user, dispatch, can } = useApp();
  const [draft, setDraft] = useState("");
  const messages = state.messages.filter((m) => m.projectId === projectId).slice().reverse();
  const canPost = can("comment:create", projectId);

  const post = () => {
    if (!draft.trim()) return;
    dispatch({ type: "message/post", projectId, text: draft.trim() });
    setDraft("");
  };

  return (
    <div className="page-scroll">
      <div style={{ padding: "16px 24px 48px", maxWidth: 800 }}>
        {canPost && (
          <div className="composer" style={{ marginBottom: 24 }}>
            <Avatar user={user} size={32} />
            <div className="input-wrap">
              <textarea
                placeholder="Post an update to the team…"
                value={draft}
                maxLength={10000}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
                }}
              />
              <div className="composer-tools">
                <span className="small weak">⌘↵ to post · visible to everyone in this project</span>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary btn-sm" onClick={post} disabled={!draft.trim()}>
                  Post
                </button>
              </div>
            </div>
          </div>
        )}
        {messages.length === 0 && (
          <EmptyState icon="messages" title="No messages yet" description="Project messages keep context out of task comments." />
        )}
        {messages.map((m) => {
          const author = state.users.find((u) => u.id === m.authorId);
          const mine = m.authorId === user.id;
          return (
            <div className="comment" key={m.id}>
              <Avatar user={author} size={32} />
              <div className="comment-body">
                <div className="comment-head">
                  <span className="comment-author">{author?.name}</span>
                  <span>{relativeTime(m.createdAt)}</span>
                  {(mine || can("project:update", projectId)) && (
                    <button
                      className="icon-btn sm"
                      title="Delete message"
                      aria-label="Delete message"
                      onClick={() => dispatch({ type: "message/delete", id: m.id })}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </div>
                <div className="comment-text">{m.text}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
