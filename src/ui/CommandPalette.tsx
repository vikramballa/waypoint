import React, { useEffect, useMemo, useRef, useState } from "react";
import { BRAND } from "../core/brand";
import { createPortal } from "react-dom";
import { useApp } from "../core/store";
import { navigate } from "../core/router";
import { searchAll } from "../core/selectors";
import { formatDue, fuzzyScore, relativeTime } from "../core/utils";
import { Icon } from "./icons";
import { Avatar } from "./primitives";

interface Command {
  id: string;
  label: string;
  group: string;
  icon?: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  onClose,
  onOpenTask,
  onCreateTask,
  onCreateProject,
  onShortcuts,
  onFields,
  onRules,
  projectId,
}: {
  onClose: () => void;
  onOpenTask: (id: string) => void;
  onCreateTask: () => void;
  onCreateProject: () => void;
  onShortcuts: () => void;
  onFields: () => void;
  onRules: () => void;
  projectId?: string;
}) {
  const { state, dispatch, toast } = useApp();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const commands: Command[] = [
      {
        id: "new-task",
        label: "Create task",
        group: "Actions",
        icon: "plus",
        hint: "Tab Q",
        run: onCreateTask,
      },
      {
        id: "new-project",
        label: "Create project",
        group: "Actions",
        icon: "board",
        run: onCreateProject,
      },
      {
        id: "goto-my-tasks",
        label: "Go to My tasks",
        group: "Actions",
        icon: "check-circle",
        run: () => navigate("/my-tasks"),
      },
      {
        id: "goto-inbox",
        label: "Go to Inbox",
        group: "Actions",
        icon: "inbox",
        run: () => navigate("/inbox"),
      },
      {
        id: "goto-goals",
        label: "Go to Goals",
        group: "Actions",
        icon: "target",
        run: () => navigate("/goals"),
      },
      {
        id: "goto-portfolios",
        label: "Go to Portfolios",
        group: "Actions",
        icon: "briefcase",
        run: () => navigate("/portfolios"),
      },
      {
        id: "goto-reporting",
        label: "Go to Reporting",
        group: "Actions",
        icon: "chart",
        run: () => navigate("/reporting"),
      },
      {
        id: "goto-ai-teammates",
        label: "Go to AI teammates",
        group: "Actions",
        icon: "sparkle",
        run: () => navigate("/ai-teammates"),
      },
      {
        id: "goto-ai-chat",
        label: `Ask ${BRAND.ai}`,
        group: "Actions",
        icon: "messages",
        hint: "Chat",
        run: () => navigate("/chat"),
      },
      {
        id: "goto-meetings",
        label: "Go to Meetings",
        group: "Actions",
        icon: "messages",
        run: () => navigate("/meetings"),
      },
      {
        id: "goto-workload",
        label: "Go to Workload",
        group: "Actions",
        icon: "users",
        run: () => navigate("/workload"),
      },
      {
        id: "goto-automations",
        label: "Go to Automations",
        group: "Actions",
        icon: "zap",
        run: () => navigate("/rules"),
      },
      {
        id: "goto-forms",
        label: "Go to Forms",
        group: "Actions",
        icon: "form",
        run: () => navigate("/forms"),
      },
      {
        id: "goto-templates",
        label: "Go to Project templates",
        group: "Actions",
        icon: "grid",
        run: () => navigate("/project-templates"),
      },
      {
        id: "toggle-theme",
        label: state.ui.theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        group: "Actions",
        icon: state.ui.theme === "dark" ? "sun" : "moon",
        run: () =>
          dispatch({
            type: "ui/patch",
            patch: { theme: state.ui.theme === "dark" ? "light" : "dark" },
          }),
      },
      {
        id: "toggle-sidebar",
        label: "Toggle sidebar",
        group: "Actions",
        icon: "panel-left",
        run: () =>
          dispatch({
            type: "ui/patch",
            patch: { sidebarCollapsed: !state.ui.sidebarCollapsed },
          }),
      },
      {
        id: "fields",
        label: "Manage custom fields",
        group: "Actions",
        icon: "grid",
        run: onFields,
      },
      {
        id: "rules",
        label: "Manage automations",
        group: "Actions",
        icon: "zap",
        run: onRules,
      },
      {
        id: "shortcuts",
        label: "Keyboard shortcuts",
        group: "Actions",
        icon: "key",
        run: onShortcuts,
      },
      {
        id: "export",
        label: "Export workspace as JSON",
        group: "Actions",
        icon: "download",
        run: () => {
          const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "waypoint-workspace.json";
          a.click();
          toast("Workspace exported");
        },
      },
    ];

    const search = searchAll(state, query);
    const q = query.trim();
    const matchedCommands = commands.filter((c) => !q || fuzzyScore(q, c.label) > 0);

    return {
      commands: matchedCommands.slice(0, q ? 6 : 8),
      projects: search.projects.slice(0, q ? 6 : 4),
      tasks: q ? search.tasks.slice(0, 8) : [],
      people: q ? search.users.slice(0, 4) : [],
      goals: q ? search.goals.slice(0, 4) : [],
    };
  }, [query, state, dispatch, onCreateTask, onCreateProject, onFields, onRules, onShortcuts, toast]);

  const flat: Command[] = useMemo(() => {
    const list: Command[] = [...results.commands];
    for (const p of results.projects) {
      list.push({
        id: `p-${p.id}`,
        label: p.name,
        group: "Projects",
        icon: "board",
        run: () => navigate(`/project/${p.id}/list`),
      });
    }
    for (const t of results.tasks) {
      list.push({
        id: `t-${t.id}`,
        label: t.name,
        group: "Tasks",
        icon: "check-circle",
        hint: t.dueDate ? formatDue(t.dueDate) : undefined,
        run: () => onOpenTask(t.id),
      });
    }
    for (const g of results.goals) {
      list.push({
        id: `g-${g.id}`,
        label: g.name,
        group: "Goals",
        icon: "target",
        run: () => navigate("/goals"),
      });
    }
    for (const u of results.people) {
      list.push({
        id: `u-${u.id}`,
        label: u.name,
        group: "People",
        icon: "person",
        hint: u.role,
        run: () => navigate(`/search?q=${encodeURIComponent(u.name)}`),
      });
    }
    return list;
  }, [results, onOpenTask]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  const run = (cmd: Command) => {
    cmd.run();
    onClose();
  };

  const groups = useMemo(() => {
    const map = new Map<string, Command[]>();
    flat.forEach((c) => {
      const list = map.get(c.group) ?? [];
      list.push(c);
      map.set(c.group, list);
    });
    return [...map.entries()];
  }, [flat]);

  const footerHint = projectId ? "Search tasks in this project" : "Search your workspace";

  return createPortal(
    <div
      className="modal-backdrop"
      style={{ alignItems: "flex-start", paddingTop: 0 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => Math.min(flat.length - 1, i + 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const cmd = flat[index];
            if (cmd) run(cmd);
          }
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="palette-input">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            placeholder={footerHint}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-results">
          {flat.length === 0 && (
            <div className="empty" style={{ padding: 32 }}>
              <h3>No matches</h3>
              <p>Try “create”, “inbox”, or a task name.</p>
            </div>
          )}
          {groups.map(([group, list]) => (
            <div key={group}>
              <div className="palette-group">{group}</div>
              {list.map((cmd) => {
                const absoluteIndex = flat.indexOf(cmd);
                return (
                  <button
                    key={cmd.id}
                    className={`palette-item${absoluteIndex === index ? " active" : ""}`}
                    onMouseEnter={() => setIndex(absoluteIndex)}
                    onClick={() => run(cmd)}
                  >
                    {cmd.icon && <Icon name={cmd.icon} size={15} />}
                    <span className="grow truncate">{cmd.label}</span>
                    {cmd.hint && <span className="right">{cmd.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span className="row" style={{ gap: 4 }}>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> to navigate
          </span>
          <span className="row" style={{ gap: 4 }}>
            <span className="kbd">↵</span> to select
          </span>
          <div style={{ flex: 1 }} />
          <span>{flat.length} results</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
