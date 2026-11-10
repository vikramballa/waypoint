import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../core/store";
import type { Route } from "../core/router";
import { navigate } from "../core/router";
import { myTaskCount, unreadCount } from "../core/selectors";
import { clamp } from "../core/utils";
import { Icon } from "./icons";
import {
  ConfirmButton,
  MenuItem,
  MenuSeparator,
  Popover,
  SwatchDot,
  usePopover,
} from "./primitives";

interface ProjectRowProps {
  id: string;
  name: string;
  color: Parameters<typeof SwatchDot>[0]["color"];
  active: boolean;
  starred: boolean;
  onRename: (name: string) => void;
}

function ProjectRow({ id, name, color, active, starred, onRename }: ProjectRowProps) {
  const { dispatch, toast } = useApp();
  const pop = usePopover();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  return (
    <div className={`side-item${active ? " active" : ""}`}>
      <button
        className="grow row"
        style={{ gap: 10, minWidth: 0, height: "100%", textAlign: "left" }}
        onClick={() => navigate(`/project/${id}/list`)}
      >
        <span className="side-icon">
          <span
            className="mini-project-icon"
            style={{
              background: `var(--swatch-${color}-bg)`,
              color: `var(--swatch-${color}-fg)`,
            }}
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
        </span>
        {editing ? (
          <input
            ref={inputRef}
            className="input"
            style={{ height: 24, padding: "0 4px", marginLeft: -4 }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => {
              setEditing(false);
              if (draft.trim() && draft !== name) onRename(draft.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span className="side-label">{name}</span>
        )}
      </button>
      <button
        className="icon-btn sm side-hover-action"
        aria-label="Project menu"
        onClick={(e) => {
          e.stopPropagation();
          pop.openAt(e.currentTarget);
        }}
      >
        <Icon name="dots" size={14} />
      </button>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={220}>
          <MenuItem
            icon={<Icon name="star" size={14} filled={starred} />}
            onClick={() => {
              dispatch({ type: "project/toggleStar", id });
              pop.close();
            }}
          >
            {starred ? "Remove from Starred" : "Add to Starred"}
          </MenuItem>
          <MenuItem
            icon={<Icon name="copy" size={14} />}
            onClick={() => {
              navigator.clipboard?.writeText(`${location.origin}/#/project/${id}/list`);
              toast("Project link copied to clipboard");
              pop.close();
            }}
          >
            Copy project link
          </MenuItem>
          <MenuItem
            icon={<Icon name="align" size={14} />}
            onClick={() => {
              setEditing(true);
              pop.close();
            }}
          >
            Rename project
          </MenuItem>
          <MenuItem
            icon={<Icon name="archive" size={14} />}
            onClick={() => {
              dispatch({ type: "project/update", id, patch: { archived: true } });
              toast("Project archived");
              pop.close();
            }}
          >
            Archive project
          </MenuItem>
          <MenuSeparator />
          <ConfirmButton
            label="Delete project"
            confirmLabel="Click again to delete"
            icon={<Icon name="trash" size={14} />}
            onConfirm={() => {
              dispatch({ type: "project/delete", id });
              navigate("/home");
              toast("Project deleted");
              pop.close();
            }}
          />
        </Popover>
      )}
    </div>
  );
}

export function Sidebar({
  route,
  onCreateProject,
  onOpenInvite,
}: {
  route: Route;
  onCreateProject: () => void;
  onOpenInvite: () => void;
}) {
  const { state, dispatch, user, can } = useApp();
  const [collapsedTeams, setCollapsedTeams] = useState<Record<string, boolean>>({});
  const [projectsOpen, setProjectsOpen] = useState(true);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const myCount = myTaskCount(state);
  const unread = unreadCount(state);

  const starred = useMemo(
    () => state.projects.filter((p) => p.starred && !p.archived && can("project:read", p.id)),
    [state.projects, can]
  );

  const teams = useMemo(
    () =>
      state.teams.map((team) => ({
        team,
        projects: state.projects.filter(
          (p) => p.teamId === team.id && !p.archived && can("project:read", p.id)
        ),
      })),
    [state.teams, state.projects, can]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const width = clamp(
        dragRef.current.startW + (e.clientX - dragRef.current.startX),
        200,
        380
      );
      dispatch({ type: "ui/patch", patch: { sidebarWidth: width } });
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dispatch]);

  const isProjectActive = (id: string) =>
    route.kind === "project" && route.id === id;

  return (
    <aside
      aria-label="Workspace navigation"
      className={`sidebar${state.ui.sidebarCollapsed ? " collapsed" : ""}`}
      style={
        state.ui.sidebarCollapsed
          ? undefined
          : { width: state.ui.sidebarWidth, minWidth: state.ui.sidebarWidth }
      }
    >
      <div
        style={{
          position: "absolute",
          right: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "col-resize",
          zIndex: 5,
        }}
        onMouseDown={(e) => {
          dragRef.current = { startX: e.clientX, startW: state.ui.sidebarWidth };
          document.body.style.cursor = "col-resize";
          e.preventDefault();
        }}
      />
      <div className="sidebar-inner scroll-y">
        <button
          className={`side-item${route.kind === "home" ? " active" : ""}`}
          onClick={() => navigate("/home")}
        >
          <span className="side-icon">
            <Icon name="home" size={16} />
          </span>
          <span className="side-label">Home</span>
        </button>
        <button
          className={`side-item${route.kind === "my-tasks" ? " active" : ""}`}
          onClick={() => navigate("/my-tasks")}
        >
          <span className="side-icon">
            <Icon name="check-circle" size={16} />
          </span>
          <span className="side-label">My tasks</span>
          {myCount > 0 && <span className="side-count">{myCount}</span>}
        </button>
        <button
          className={`side-item${route.kind === "inbox" ? " active" : ""}`}
          onClick={() => navigate("/inbox")}
        >
          <span className="side-icon">
            <Icon name="inbox" size={16} />
          </span>
          <span className="side-label">Inbox</span>
          {unread > 0 && <span className="side-badge">{unread}</span>}
        </button>

        <div className="side-group">
          <div className="side-group-header">
            <span>AI</span>
          </div>
          <button
            className={`side-item${route.kind === "ai-teammates" || route.kind === "ai-teammate" ? " active" : ""}`}
            onClick={() => navigate("/ai-teammates")}
          >
            <span className="side-icon">
              <Icon name="sparkle" size={16} />
            </span>
            <span className="side-label">AI teammates</span>
            <span className="ai-badge" style={{ height: 16, fontSize: 9 }}>beta</span>
          </button>
          <button
            className={`side-item${route.kind === "chat" ? " active" : ""}`}
            onClick={() => navigate("/chat")}
          >
            <span className="side-icon">
              <Icon name="messages" size={16} />
            </span>
            <span className="side-label">AI chat</span>
          </button>
        </div>

        {starred.length > 0 && (
          <div className="side-group">
            <div className="side-group-header">
              <span>Starred</span>
            </div>
            {starred.map((p) => (
              <button
                key={p.id}
                className={`side-item${isProjectActive(p.id) ? " active" : ""}`}
                onClick={() => navigate(`/project/${p.id}/list`)}
              >
                <span className="side-icon">
                  <Icon name="star" size={14} filled />
                </span>
                <span className="side-label">{p.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="side-group">
          <div className="side-group-header">
            <button
              className="row"
              style={{ gap: 2, color: "inherit" }}
              onClick={() => setProjectsOpen((v) => !v)}
            >
              <span className={`side-caret${projectsOpen ? "" : " closed"}`}>
                <Icon name="chevron-down" size={12} />
              </span>
              Projects
            </button>
            <button
              className="icon-btn sm"
              title="Create project"
              onClick={onCreateProject}
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
          {projectsOpen &&
            teams.map(({ team, projects }) => (
              <div key={team.id}>
                <button
                  className="side-item"
                  style={{ color: "var(--color-text-weak)", height: 28 }}
                  onClick={() =>
                    setCollapsedTeams((c) => ({ ...c, [team.id]: !c[team.id] }))
                  }
                >
                  <span
                    className={`side-caret${collapsedTeams[team.id] ? " closed" : ""}`}
                  >
                    <Icon name="chevron-down" size={12} />
                  </span>
                  <span className="side-label" style={{ fontSize: 12, fontWeight: 500 }}>
                    {team.name}
                  </span>
                  <span className="side-count">{projects.length}</span>
                </button>
                {!collapsedTeams[team.id] &&
                  projects.map((p) => (
                    <ProjectRow
                      key={p.id}
                      id={p.id}
                      name={p.name}
                      color={p.color}
                      active={isProjectActive(p.id)}
                      starred={p.starred}
                      onRename={(name) =>
                        dispatch({ type: "project/update", id: p.id, patch: { name } })
                      }
                    />
                  ))}
              </div>
            ))}
        </div>

        <div className="side-group">
          <div className="side-group-header">
            <span>Insights</span>
          </div>
          <button
            className={`side-item${route.kind === "goals" ? " active" : ""}`}
            onClick={() => navigate("/goals")}
          >
            <span className="side-icon">
              <Icon name="target" size={16} />
            </span>
            <span className="side-label">Goals</span>
          </button>
          <button
            className={`side-item${route.kind === "portfolios" ? " active" : ""}`}
            onClick={() => navigate("/portfolios")}
          >
            <span className="side-icon">
              <Icon name="briefcase" size={16} />
            </span>
            <span className="side-label">Portfolios</span>
          </button>
          <button
            className={`side-item${route.kind === "reporting" ? " active" : ""}`}
            onClick={() => navigate("/reporting")}
          >
            <span className="side-icon">
              <Icon name="chart" size={16} />
            </span>
            <span className="side-label">Reporting</span>
          </button>
          <button
            className={`side-item${route.kind === "workload" ? " active" : ""}`}
            onClick={() => navigate("/workload")}
          >
            <span className="side-icon">
              <Icon name="users" size={16} />
            </span>
            <span className="side-label">Workload</span>
          </button>
        </div>

        <div className="side-group">
          <div className="side-group-header">
            <span>Products</span>
          </div>
          <button className={`side-item${route.kind === "dev" ? " active" : ""}`} onClick={() => navigate("/dev")}>
            <span className="side-icon"><Icon name="key" size={16} /></span>
            <span className="side-label">Dev</span>
            <span className="badge-new">new</span>
          </button>
          <button className="side-item" onClick={() => navigate("/service")}>
            <span className="side-icon"><Icon name="help" size={16} /></span>
            <span className="side-label">Service desk</span>
          </button>
          <button className="side-item" onClick={() => navigate("/agency")}>
            <span className="side-icon"><Icon name="briefcase" size={16} /></span>
            <span className="side-label">Agency</span>
          </button>
          <button className="side-item" onClick={() => navigate("/tables")}>
            <span className="side-icon"><Icon name="grid" size={16} /></span>
            <span className="side-label">Tables</span>
          </button>
          <button className="side-item" onClick={() => navigate("/pages")}>
            <span className="side-icon"><Icon name="files" size={16} /></span>
            <span className="side-label">Pages</span>
          </button>
        </div>

        <div className="side-group">
          <div className="side-group-header">
            <span>Work</span>
          </div>
          <button
            className={`side-item${route.kind === "automations" ? " active" : ""}`}
            onClick={() => navigate("/rules")}
          >
            <span className="side-icon">
              <Icon name="zap" size={16} />
            </span>
            <span className="side-label">Automations</span>
          </button>
          <button
            className={`side-item${route.kind === "forms" ? " active" : ""}`}
            onClick={() => navigate("/forms")}
          >
            <span className="side-icon">
              <Icon name="form" size={16} />
            </span>
            <span className="side-label">Forms</span>
          </button>
          <button
            className={`side-item${route.kind === "meetings" ? " active" : ""}`}
            onClick={() => navigate("/meetings")}
          >
            <span className="side-icon">
              <Icon name="messages" size={16} />
            </span>
            <span className="side-label">Meetings</span>
          </button>
          <button
            className={`side-item${route.kind === "templates" ? " active" : ""}`}
            onClick={() => navigate("/project-templates")}
          >
            <span className="side-icon">
              <Icon name="grid" size={16} />
            </span>
            <span className="side-label">Templates</span>
          </button>
          <button
            className={`side-item${route.kind === "status-templates" ? " active" : ""}`}
            onClick={() => navigate("/status-templates")}
          >
            <span className="side-icon">
              <Icon name="align" size={16} />
            </span>
            <span className="side-label">Status templates</span>
          </button>
          {can("workspace:admin") && (
            <button
              className={`side-item${route.kind === "admin" ? " active" : ""}`}
              onClick={() => navigate("/admin")}
            >
              <span className="side-icon">
                <Icon name="lock" size={16} />
              </span>
              <span className="side-label">Admin console</span>
            </button>
          )}
        </div>

        <div style={{ flex: 1 }} />
        <div
          style={{
            margin: "8px 4px 0",
            padding: 10,
            border: "1px solid var(--color-border-strong)",
            borderRadius: 8,
            background: "var(--color-background-weak)",
          }}
        >
          <div style={{ fontWeight: 500, fontSize: 13 }}>Invite your team</div>
          <div className="small weak" style={{ margin: "2px 0 8px" }}>
            Work is better together.
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onOpenInvite}>
            <Icon name="users" size={13} />
            Add teammates
          </button>
        </div>
        <div
          className="row"
          style={{ padding: "10px 8px 2px", gap: 8 }}
          title={user.email}
        >
          <span className="small weak truncate">{user.email}</span>
        </div>
      </div>
    </aside>
  );
}
