import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../core/store";
import type { FieldDef, ID, Section, SwatchName, Task } from "../core/types";
import {
  filterTasks,
  projectTasks,
  sectionTasks,
  sortTasks,
  subtasksOf,
  type SortKey,
  type TaskFilters,
} from "../core/selectors";
import {
  addDays,
  diffDays,
  dueState,
  formatDue,
  pct,
  todayISO,
} from "../core/utils";
import { Icon } from "./icons";
import { TemplatesChip } from "../views/TaskExtras";
import {
  Avatar,
  AutoGrowTextarea,
  Checkbox,
  ColorGrid,
  ConfirmButton,
  DatePicker,
  EmptyState,
  FieldEditor,
  FieldValueView,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  PriorityPill,
  ProgressBar,
  TagPill,
  UserPicker,
  usePopover,
  TaskCheckbox,
} from "./primitives";

export interface TaskGroup {
  key: string;
  name: string;
  tasks: Task[];
  sectionId?: ID | null;
  color?: SwatchName;
  readOnlyName?: boolean;
  meta?: React.ReactNode;
  collapsible?: boolean;
}

interface ColumnState {
  assignee: boolean;
  due: boolean;
  priority: boolean;
  tags: boolean;
  projects: boolean;
  fields: ID[];
}

const DEFAULT_COLUMNS: ColumnState = {
  assignee: true,
  due: true,
  priority: false,
  tags: false,
  projects: false,
  fields: [],
};

/* --------------------------------------------------------------- row menu */
function RowMenu({
  task,
  onClose,
  onOpen,
  sectionId,
}: {
  task: Task;
  onClose: () => void;
  onOpen: (id: string) => void;
  sectionId?: ID | null;
}) {
  const { state, dispatch, toast, undo } = useApp();
  const sections = state.sections.filter((s) => s.projectId === task.projectId);
  const [submenu, setSubmenu] = useState<"move" | null>(null);

  return (
    <>
      <MenuItem
        icon={<Icon name="check-circle" size={14} />}
        onClick={() => {
          dispatch({ type: "task/toggleComplete", id: task.id });
          onClose();
        }}
      >
        {task.completed ? "Mark incomplete" : "Mark complete"}
      </MenuItem>
      <MenuItem
        icon={<Icon name="person" size={14} />}
        onClick={() => {
          dispatch({ type: "task/setAssignee", id: task.id, userId: state.currentUserId });
          onClose();
        }}
      >
        Assign to me
      </MenuItem>
      <MenuItem
        icon={<Icon name="subtask" size={14} />}
        onClick={() => {
          dispatch({ type: "task/create", patch: { name: "New subtask", parentId: task.id, projectId: task.projectId } });
          onClose();
        }}
      >
        Add subtask
      </MenuItem>
      <MenuItem
        icon={<Icon name="arrow-right" size={14} />}
        onClick={() => setSubmenu(submenu === "move" ? null : "move")}
        right={<Icon name="chevron-right" size={12} />}
      >
        Move to section
      </MenuItem>
      {submenu === "move" && (
        <div style={{ paddingLeft: 12 }}>
          {sections.map((s) => (
            <MenuItem
              key={s.id}
              checked={task.sectionId === s.id}
              onClick={() => {
                dispatch({ type: "task/move", id: task.id, sectionId: s.id });
                onClose();
              }}
            >
              {s.name}
            </MenuItem>
          ))}
        </div>
      )}
      <MenuItem
        icon={<Icon name="milestone" size={14} />}
        onClick={() => {
          dispatch({ type: "task/update", id: task.id, patch: { milestone: !task.milestone } });
          onClose();
        }}
      >
        {task.milestone ? "Remove milestone" : "Mark as milestone"}
      </MenuItem>
      <MenuItem
        icon={<Icon name="copy" size={14} />}
        onClick={() => {
          dispatch({ type: "task/duplicate", id: task.id });
          toast("Task duplicated", "Undo", undo);
          onClose();
        }}
      >
        Duplicate task
      </MenuItem>
      <MenuItem
        icon={<Icon name="link" size={14} />}
        onClick={() => {
          navigator.clipboard?.writeText(`${location.origin}/#/task/${task.id}`);
          toast("Task link copied");
          onClose();
        }}
      >
        Copy task link
      </MenuItem>
      <MenuItem
        icon={<Icon name="arrow-up-right" size={14} />}
        onClick={() => {
          onOpen(task.id);
          onClose();
        }}
      >
        Open details
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
    </>
  );
}

/* ------------------------------------------------------------------- row */
function TaskRow({
  task,
  columns,
  depth = 0,
  onOpen,
  selected,
  onToggleSelect,
  dragProps,
}: {
  task: Task;
  columns: ColumnState;
  depth?: number;
  onOpen: (id: string) => void;
  selected: boolean;
  onToggleSelect: (e: React.MouseEvent) => void;
  dragProps?: {
    draggable?: boolean;
    onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
    onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  };
}) {
  const { state, dispatch, toast, userById, undo, can } = useApp();
  const canEditThis = can("task:edit", task.projectId);
  const menuPop = usePopover();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.name);
  const [expanded, setExpanded] = useState(false);
  const due = dueState(task.dueDate, task.completed);
  const assignee = userById(task.assigneeId);
  const subs = subtasksOf(state, task.id);
  const project = state.projects.find((p) => p.id === task.projectId);
  const agentAssignee = state.users.find((u) => u.id === task.assigneeId && u.isAgent);
  const activeRun = agentAssignee
    ? state.agentRuns.find(
        (r) =>
          r.taskId === task.id &&
          r.teammateId === agentAssignee.id &&
          (r.status === "running" || r.status === "queued")
      )
    : undefined;
  const fields = columns.fields
    .map((id) => state.fields.find((f) => f.id === id))
    .filter(Boolean) as FieldDef[];

  useEffect(() => {
    if (!editing) setDraft(task.name);
  }, [task.name, editing]);

  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== task.name) dispatch({ type: "task/rename", id: task.id, name });
  };

  const subtaskDone = subs.filter((s) => s.completed).length;

  return (
    <>
      <div
        className={`task-row${task.completed ? " done" : ""}${selected ? " selected" : ""}${
          depth > 0 ? " sub" : ""
        }`}
        data-task-id={task.id}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button,input,textarea")) return;
          if (e.metaKey || e.shiftKey) onToggleSelect(e);
          else onOpen(task.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !editing) onOpen(task.id);
        }}
        {...dragProps}
      >
        {subs.length > 0 && (
          <button
            className="side-caret"
            style={{ marginLeft: depth * -4 }}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
          >
            <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} />
          </button>
        )}
          <TaskCheckbox task={task} undoToast />
        <div className="row-main" onDoubleClick={() => setEditing(true)}>
          {editing ? (
            <input
              className="task-name-input"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(task.name);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <button
              className="task-name"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(task.id);
              }}
              title={task.name}
            >
              {task.name}
            </button>
          )}
          {task.milestone && (
            <span className="chip outline" style={{ height: 20 }}>
              <Icon name="milestone" size={11} /> Milestone
            </span>
          )}
          {activeRun && (
            <span className="ai-badge" title={`${agentAssignee?.name ?? "AI"} is working`}>
              <span
                className="swatch dot"
                style={{ width: 5, height: 5, background: "currentColor", animation: "pulse 1.4s infinite" }}
              />
              AI working
            </span>
          )}
          {subs.length > 0 && (
            <span className="small weak mono" style={{ whiteSpace: "nowrap" }}>
              {subtaskDone}/{subs.length}
            </span>
          )}
          {task.attachments.length > 0 && (
            <span className="small weak row" style={{ gap: 2 }}>
              <Icon name="paperclip" size={12} />
              {task.attachments.length}
            </span>
          )}
          {state.comments.filter((c) => c.taskId === task.id).length > 0 && (
            <span className="small weak row" style={{ gap: 2 }}>
              <Icon name="comment" size={12} />
              {state.comments.filter((c) => c.taskId === task.id).length}
            </span>
          )}
        </div>

        {columns.projects && (
          <div className="cell" style={{ width: 150 }}>
            {project ? (
              <span className="cell-value" title={project.name}>
                <span
                  className="swatch"
                  style={{ background: `var(--swatch-${project.color}-bg)` }}
                />
                <span className="truncate">{project.name}</span>
              </span>
            ) : (
              <span className="cell-value empty">—</span>
            )}
          </div>
        )}

        {columns.assignee && (
          <div className="cell" style={{ width: 116 }}>
            <UserPicker
              value={task.assigneeId}
              onChange={(id) =>
                dispatch({ type: "task/setAssignee", id: task.id, userId: id })
              }
            >
              {(open) => (
                <button
                  className="cell-value"
                  onClick={(e) => {
                    e.stopPropagation();
                    open(e.currentTarget);
                  }}
                >
                  {assignee ? (
                    <>
                      <Avatar user={assignee} size={22} />
                      <span className="truncate">{assignee.name.split(" ")[0]}</span>
                    </>
                  ) : (
                    <span className="empty">Assignee</span>
                  )}
                </button>
              )}
            </UserPicker>
          </div>
        )}

        {columns.due && (
          <div className="cell" style={{ width: 108 }}>
            <DatePicker
              value={task.dueDate}
              withTime
              time={task.dueTime}
              onTimeChange={(t) =>
                dispatch({
                  type: "task/update",
                  id: task.id,
                  patch: { dueTime: t },
                  silent: true,
                })
              }
              onChange={(iso) =>
                dispatch({ type: "task/setDue", id: task.id, dueDate: iso })
              }
            >
              {(open) => (
                <button
                  className={`cell-value due ${due}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    open(e.currentTarget);
                  }}
                >
                  {task.dueDate ? (
                    <>
                      <Icon name="calendar" size={12} />
                      {formatDue(task.dueDate)}
                      {task.dueTime && (
                        <span style={{ marginLeft: 2 }}>{task.dueTime}</span>
                      )}
                    </>
                  ) : (
                    <span className="empty">Due date</span>
                  )}
                </button>
              )}
            </DatePicker>
          </div>
        )}

        {columns.priority && (
          <div className="cell" style={{ width: 92 }}>
            <PriorityCell task={task} />
          </div>
        )}

        {columns.tags && (
          <div className="cell" style={{ width: 120 }}>
            <span className="row" style={{ gap: 3, overflow: "hidden" }}>
              {task.tagIds.slice(0, 2).map((id) => {
                const tag = state.tags.find((t) => t.id === id);
                return tag ? <TagPill key={id} name={tag.name} color={tag.color} /> : null;
              })}
              {task.tagIds.length > 2 && (
                <span className="small weak">+{task.tagIds.length - 2}</span>
              )}
            </span>
          </div>
        )}

        {fields.map((field) => (
          <div className="cell" key={field.id} style={{ width: 120 }}>
            <FieldEditor
              field={field}
              value={task.customFields[field.id] ?? null}
              onChange={(v) =>
                dispatch({ type: "task/setField", id: task.id, fieldId: field.id, value: v })
              }
            >
              {(open) => (
                <button
                  className="cell-value"
                  onClick={(e) => {
                    e.stopPropagation();
                    open(e.currentTarget);
                  }}
                >
                  <FieldValueView
                    field={field}
                    value={task.customFields[field.id] ?? null}
                    state={state}
                  />
                </button>
              )}
            </FieldEditor>
          </div>
        ))}

        <div className="row-actions">
          <button
            className="icon-btn sm"
            title="Add subtask"
            onClick={(e) => {
              e.stopPropagation();
              dispatch({
                type: "task/create",
                patch: { name: "New subtask", parentId: task.id, projectId: task.projectId },
              });
              setExpanded(true);
            }}
          >
            <Icon name="plus" size={13} />
          </button>
          <button
            className="icon-btn sm"
            title="More actions"
            onClick={(e) => {
              e.stopPropagation();
              menuPop.openAt(e.currentTarget);
            }}
          >
            <Icon name="dots" size={14} />
          </button>
          <button
            className="icon-btn sm"
            title="Select"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(e);
            }}
          >
            <Icon name="check" size={13} />
          </button>
        </div>

        {menuPop.open && menuPop.anchor && (
          <Popover anchor={menuPop.anchor} onClose={menuPop.close} width={230} align="end">
            <RowMenu
              task={task}
              onClose={menuPop.close}
              onOpen={onOpen}
              sectionId={task.sectionId}
            />
          </Popover>
        )}
      </div>
      {expanded &&
        subs.map((sub) => (
          <TaskRow
            key={sub.id}
            task={sub}
            columns={columns}
            depth={depth + 1}
            onOpen={onOpen}
            selected={false}
            onToggleSelect={() => {}}
          />
        ))}
      {expanded && (
        <button
          className="add-task-row"
          style={{ paddingLeft: 56 }}
          onClick={() =>
            dispatch({
              type: "task/create",
              patch: { name: "New subtask", parentId: task.id, projectId: task.projectId },
            })
          }
        >
          <Icon name="plus" size={13} /> Add subtask
        </button>
      )}
    </>
  );
}

function PriorityCell({ task }: { task: Task }) {
  const { dispatch } = useApp();
  const pop = usePopover();
  return (
    <>
      <button
        className="cell-value"
        onClick={(e) => {
          e.stopPropagation();
          pop.openAt(e.currentTarget);
        }}
      >
        {task.priority ? <PriorityPill priority={task.priority} /> : <span className="empty">Priority</span>}
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

/* ------------------------------------------------------------ add task row */
export function AddTaskRow({
  projectId,
  sectionId,
  placeholder = "Add task…",
  onCreated,
  defaults,
}: {
  projectId?: ID | null;
  sectionId?: ID | null;
  placeholder?: string;
  onCreated?: (id: ID) => void;
  defaults?: Partial<Task>;
}) {
  const { dispatch } = useApp();
  const [active, setActive] = useState(false);
  const [value, setValue] = useState("");

  const submit = (keepOpen: boolean) => {
    const name = value.trim();
    if (!name) {
      setActive(false);
      return;
    }
    dispatch({
      type: "task/create",
      patch: { ...defaults, name, projectId: projectId ?? null, sectionId: sectionId ?? null },
    });
    setValue("");
    if (!keepOpen) setActive(false);
  };

  if (!active) {
    return (
      <button className="add-task-row" onClick={() => setActive(true)}>
        <Icon name="plus" size={13} /> {placeholder}
      </button>
    );
  }

  return (
    <div className="add-task-row" style={{ paddingTop: 4, paddingBottom: 4 }}>
      <Checkbox checked={false} onChange={() => {}} label="New task" />
      <input
        className="task-name-input"
        autoFocus
        placeholder="Task name — press Enter to create, Tab for description"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit(true);
          if (e.key === "Escape") {
            setValue("");
            setActive(false);
          }
        }}
        onBlur={() => {
          if (!value.trim()) setActive(false);
        }}
      />
      <button className="btn btn-primary btn-sm" onClick={() => submit(false)}>
        Add
      </button>
    </div>
  );
}

/* --------------------------------------------------------- section header */
function SectionHeader({
  section,
  tasks,
  onOpenTask,
  collapsed,
  onToggleCollapse,
  canCreate,
}: {
  section: Section;
  tasks: Task[];
  onOpenTask: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  canCreate: boolean;
}) {
  const { dispatch, toast } = useApp();
  const [name, setName] = useState(section.name);
  const [editing, setEditing] = useState(false);
  const pop = usePopover();
  const done = tasks.filter((t) => t.completed).length;
  const percent = pct(done, tasks.length);

  return (
    <div
      className="section-header"
      data-section-id={section.id}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/task-id")) {
          e.preventDefault();
          e.currentTarget.style.background = "var(--color-selected-background)";
        }
      }}
      onDragLeave={(e) => {
        e.currentTarget.style.background = "";
      }}
      onDrop={(e) => {
        e.currentTarget.style.background = "";
        const id = e.dataTransfer.getData("text/task-id");
        if (id) {
          e.preventDefault();
          dispatch({ type: "task/move", id, sectionId: section.id });
        }
      }}
    >
      <button className="icon-btn sm" onClick={onToggleCollapse} aria-label="Collapse section">
        <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={13} />
      </button>
      {section.color && (
        <span
          className="swatch"
          style={{ background: `var(--swatch-${section.color}-bg)` }}
        />
      )}
      {editing ? (
        <input
          className="section-name section-name-input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (name.trim() && name !== section.name)
              dispatch({ type: "section/update", id: section.id, patch: { name: name.trim() } });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      ) : (
        <button
          className="section-name"
          style={{ padding: "1px 4px", border: "1px solid transparent" }}
          onClick={() => setEditing(true)}
        >
          {section.name}
        </button>
      )}
      <span className="section-count">{tasks.length}</span>
      {percent > 0 && (
        <div className="section-progress" title={`${percent}% complete`}>
          <i style={{ width: `${percent}%` }} />
        </div>
      )}
      <div style={{ flex: 1 }} />
      {canCreate && (
        <button
          className="icon-btn sm"
          title="Add task to section"
          onClick={() =>
            dispatch({
              type: "task/create",
              patch: { name: "New task", projectId: section.projectId, sectionId: section.id },
            })
          }
        >
          <Icon name="plus" size={13} />
        </button>
      )}
      <button
        className="icon-btn sm"
        title="Section actions"
        onClick={(e) => pop.openAt(e.currentTarget)}
      >
        <Icon name="dots" size={14} />
      </button>
      <button
        className="icon-btn sm"
        title="Add section below"
        onClick={() =>
          dispatch({
            type: "section/create",
            projectId: section.projectId,
            name: "New section",
            afterId: section.id,
          })
        }
      >
        <Icon name="layout-list" size={13} />
      </button>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={230} align="end">
          <MenuItem
            icon={<Icon name="plus" size={14} />}
            onClick={() => {
              dispatch({
                type: "task/create",
                patch: { name: "New task", projectId: section.projectId, sectionId: section.id },
              });
              pop.close();
            }}
          >
            Add task to section
          </MenuItem>
          <MenuItem
            icon={<Icon name="align" size={14} />}
            onClick={() => {
              setEditing(true);
              pop.close();
            }}
          >
            Rename section
          </MenuItem>
          <MenuItem
            icon={<Icon name="arrow-up" size={14} />}
            onClick={() => {
              dispatch({ type: "section/move", id: section.id, beforeId: null });
              pop.close();
            }}
          >
            Move to top
          </MenuItem>
          <MenuLabel>Color</MenuLabel>
          <div style={{ padding: "0 8px 6px" }}>
            <ColorGrid
              value={section.color ?? "none"}
              onChange={(c) => {
                dispatch({ type: "section/update", id: section.id, patch: { color: c } });
                pop.close();
              }}
            />
          </div>
          <MenuSeparator />
          <ConfirmButton
            label="Delete section"
            confirmLabel="Tasks move to next section"
            icon={<Icon name="trash" size={14} />}
            onConfirm={() => {
              dispatch({ type: "section/delete", id: section.id });
              pop.close();
              toast("Section deleted");
            }}
          />
        </Popover>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- toolbar */
function ListToolbar({
  allTasks,
  filtered,
  filters,
  setFilters,
  sortKey,
  sortDir,
  setSort,
  columns,
  setColumns,
  onSeeAll,
  showCompleted,
  setShowCompleted,
  savedViews,
  onApplyView,
  onSaveView,
  onDeleteView,
  showViews,
  projectId,
}: {
  projectId?: ID | null;
  allTasks: Task[];
  filtered: Task[];
  showViews?: boolean;
  savedViews: { id: string; name: string }[];
  onApplyView: (id: string) => void;
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
  filters: TaskFilters;
  setFilters: (f: TaskFilters) => void;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  setSort: (k: SortKey, d: "asc" | "desc") => void;
  columns: ColumnState;
  setColumns: (c: ColumnState) => void;
  onSeeAll: () => void;
  showCompleted: boolean;
  setShowCompleted: (v: boolean) => void;
}) {
  const { state } = useApp();
  const filterPop = usePopover();
  const sortPop = usePopover();
  const fieldsPop = usePopover();
  const viewsPop = usePopover();
  const [viewName, setViewName] = useState("");
  const activeFilters =
    (filters.assigneeIds?.length ?? 0) +
    (filters.tagIds?.length ?? 0) +
    (filters.completed && filters.completed !== "all" ? 1 : 0) +
    (filters.due && filters.due !== "any" ? 1 : 0) +
    (filters.priority && filters.priority !== "any" ? 1 : 0);

  const toggle = <T,>(list: T[] | undefined, value: T): T[] => {
    const arr = list ?? [];
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  };

  return (
    <div className="viewbar">
      <span className="viewbar-title">
        {filtered.length === allTasks.length
          ? `${allTasks.length} task${allTasks.length === 1 ? "" : "s"}`
          : `${filtered.length} of ${allTasks.length} tasks`}
      </span>
      <div className="spacer" />
      {activeFilters > 0 && (
        <button
          className="chip active"
          onClick={() =>
            setFilters({ text: filters.text, completed: "all", due: "any", priority: "any" })
          }
        >
          <Icon name="filter" size={12} /> {activeFilters} filter
          {activeFilters > 1 ? "s" : ""} <Icon name="close" size={11} />
        </button>
      )}
      <button className="chip" onClick={(e) => filterPop.openAt(e.currentTarget)}>
        <Icon name="filter" size={12} /> Filter
      </button>
      <button className="chip" onClick={(e) => sortPop.openAt(e.currentTarget)}>
        <Icon name="sort" size={12} /> Sort
      </button>
      {projectId && <TemplatesChip projectId={projectId} />}
      <button className="chip" onClick={(e) => fieldsPop.openAt(e.currentTarget)}>
        <Icon name="grid" size={12} /> Customize
      </button>
      {showViews && (
        <button className="chip" onClick={(e) => viewsPop.openAt(e.currentTarget)}>
          <Icon name="eye" size={12} /> Views
          {savedViews.length > 0 && (
            <span className="small weak">{savedViews.length}</span>
          )}
        </button>
      )}
      <button className="chip" onClick={onSeeAll} title="Open the first task">
        <Icon name="expand" size={12} />
      </button>

      {filterPop.open && filterPop.anchor && (
        <Popover anchor={filterPop.anchor} onClose={filterPop.close} width={300} align="end">
          <MenuLabel>Status</MenuLabel>
          {(["all", "open", "done"] as const).map((v) => (
            <MenuItem
              key={v}
              checked={filters.completed === v}
              onClick={() => setFilters({ ...filters, completed: v })}
            >
              {v === "all" ? "All tasks" : v === "open" ? "Incomplete" : "Completed"}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuLabel>Due date</MenuLabel>
          {(["any", "overdue", "today", "week", "none"] as const).map((v) => (
            <MenuItem
              key={v}
              checked={filters.due === v}
              onClick={() => setFilters({ ...filters, due: v })}
            >
              {v === "any"
                ? "Any"
                : v === "overdue"
                  ? "Overdue"
                  : v === "today"
                    ? "Due today"
                    : v === "week"
                      ? "Due in the next 7 days"
                      : "No due date"}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuLabel>Priority</MenuLabel>
          {(["any", "high", "medium", "low"] as const).map((v) => (
            <MenuItem
              key={v}
              checked={filters.priority === v}
              onClick={() => setFilters({ ...filters, priority: v })}
            >
              {v === "any" ? "Any" : v[0].toUpperCase() + v.slice(1)}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuLabel>Assignee</MenuLabel>
          {state.users.map((u) => (
            <MenuItem
              key={u.id}
              checked={filters.assigneeIds?.includes(u.id)}
              onClick={() =>
                setFilters({ ...filters, assigneeIds: toggle(filters.assigneeIds, u.id) })
              }
            >
              <Avatar user={u} size={20} /> {u.name}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuLabel>Tags</MenuLabel>
          {state.tags.map((t) => (
            <MenuItem
              key={t.id}
              checked={filters.tagIds?.includes(t.id)}
              onClick={() =>
                setFilters({ ...filters, tagIds: toggle(filters.tagIds, t.id) })
              }
            >
              <span
                className="swatch dot"
                style={{ background: `var(--swatch-${t.color}-bg)` }}
              />
              {t.name}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              setFilters({ completed: "all", due: "any", priority: "any" });
              filterPop.close();
            }}
          >
            Clear filters
          </MenuItem>
        </Popover>
      )}

      {sortPop.open && sortPop.anchor && (
        <Popover anchor={sortPop.anchor} onClose={sortPop.close} width={240} align="end">
          <MenuLabel>Sort by</MenuLabel>
          {(
            [
              ["order", "Manual"],
              ["due", "Due date"],
              ["name", "Name"],
              ["assignee", "Assignee"],
              ["priority", "Priority"],
              ["created", "Creation date"],
              ["modified", "Last modified"],
            ] as [SortKey, string][]
          ).map(([key, label]) => (
            <MenuItem
              key={key}
              checked={sortKey === key}
              right={sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : undefined}
              onClick={() =>
                setSort(key, sortKey === key && sortDir === "asc" ? "desc" : "asc")
              }
            >
              {label}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem checked={showCompleted} onClick={() => setShowCompleted(!showCompleted)}>
            Show completed tasks
          </MenuItem>
        </Popover>
      )}

      {viewsPop.open && viewsPop.anchor && (
        <Popover anchor={viewsPop.anchor} onClose={viewsPop.close} width={280} align="end">
          <MenuLabel>Saved views</MenuLabel>
          {savedViews.length === 0 && (
            <div className="small weak" style={{ padding: "4px 8px 8px" }}>
              No saved views for this project yet.
            </div>
          )}
          {savedViews.map((v) => (
            <div key={v.id} className="row" style={{ gap: 2 }}>
              <MenuItem
                icon={<Icon name="list" size={13} />}
                onClick={() => {
                  onApplyView(v.id);
                  viewsPop.close();
                }}
              >
                {v.name}
              </MenuItem>
              <button
                className="icon-btn sm"
                title="Delete view"
                onClick={() => onDeleteView(v.id)}
              >
                <Icon name="trash" size={12} />
              </button>
            </div>
          ))}
          <MenuSeparator />
          <MenuLabel>Save current filters</MenuLabel>
          <div className="row" style={{ gap: 6, padding: "0 6px 6px" }}>
            <input
              className="input"
              style={{ height: 30 }}
              placeholder="View name"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && viewName.trim()) {
                  onSaveView(viewName.trim());
                  setViewName("");
                  viewsPop.close();
                }
              }}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={!viewName.trim()}
              onClick={() => {
                onSaveView(viewName.trim());
                setViewName("");
                viewsPop.close();
              }}
            >
              Save
            </button>
          </div>
        </Popover>
      )}

      {fieldsPop.open && fieldsPop.anchor && (
        <Popover anchor={fieldsPop.anchor} onClose={fieldsPop.close} width={280} align="end">
          <MenuLabel>Toggle columns</MenuLabel>
          {(
            [
              ["assignee", "Assignee"],
              ["due", "Due date"],
              ["priority", "Priority"],
              ["tags", "Tags"],
              ["projects", "Projects"],
            ] as [keyof ColumnState, string][]
          ).map(([key, label]) => (
            <MenuItem
              key={key}
              checked={Boolean(columns[key])}
              onClick={() => setColumns({ ...columns, [key]: !columns[key] })}
            >
              {label}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuLabel>Custom fields</MenuLabel>
          {state.fields.map((f) => (
            <MenuItem
              key={f.id}
              checked={columns.fields.includes(f.id)}
              onClick={() =>
                setColumns({
                  ...columns,
                  fields: columns.fields.includes(f.id)
                    ? columns.fields.filter((x) => x !== f.id)
                    : [...columns.fields, f.id],
                })
              }
            >
              {f.name}
            </MenuItem>
          ))}
        </Popover>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- list */
export function TaskList({
  groups,
  projectId,
  onOpenTask,
  emptyTitle = "No tasks yet",
  emptyDescription = "Add your first task to get started.",
  allowAdd = true,
  onAddSection,
  toolbarTasks,
  onMoveToGroup,
  newTaskDefaults,
  groupLabels,
}: {
  groups: TaskGroup[];
  projectId?: ID | null;
  onOpenTask: (id: ID) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  allowAdd?: boolean;
  onAddSection?: () => void;
  toolbarTasks?: Task[];
  onMoveToGroup?: (ids: ID[], groupKey: string) => void;
  newTaskDefaults?: Partial<Task>;
  groupLabels?: [string, string];
}) {
  const { state, dispatch, toast, undo, can } = useApp();
  const canCreate = can("task:create", projectId ?? null);
  const canEdit = can("task:edit", projectId ?? null);
  const [columns, setColumns] = useState<ColumnState>(DEFAULT_COLUMNS);
  const [filters, setFilters] = useState<TaskFilters>({ completed: "all", due: "any", priority: "any" });
  const [sortKey, setSortKey] = useState<SortKey>("order");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showCompleted, setShowCompleted] = useState(true);
  const [selection, setSelection] = useState<Set<ID>>(new Set());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState<ID[] | null>(null);
  const [dropTarget, setDropTarget] = useState<{ taskId: ID | null; position: "before" | "after" | "empty"; sectionId?: ID | null } | null>(null);

  const allTasks = useMemo(() => {
    const seen = new Set<string>();
    return groups.flatMap((g) => g.tasks).filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [groups]);

  const applyFilters = (tasks: Task[]) => {
    let out = filterTasks(tasks, { ...filters, completed: showCompleted ? filters.completed : "open" });
    out = sortTasks(state, out, sortKey, sortDir);
    return out;
  };

  const toggleSelect = (id: ID, additive: boolean) => {
    setSelection((prev) => {
      const next = new Set(additive ? prev : []);
      if (prev.has(id) && additive) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelection(new Set());

  const startDrag = (e: React.DragEvent, task: Task) => {
    const ids = selection.has(task.id) ? [...selection] : [task.id];
    setDragging(ids);
    e.dataTransfer.setData("text/task-id", task.id);
    e.dataTransfer.effectAllowed = "move";
    // ghost is the row itself by default
  };

  const handleDrop = (
    e: React.DragEvent,
    targetTask: Task | null,
    sectionId: ID | null | undefined,
    position: "before" | "after" | "empty",
    groupKey?: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("text/task-id");
    const ids = dragging && dragging.length ? dragging : id ? [id] : [];
    setDropTarget(null);
    setDragging(null);
    if (!ids.length) return;
    const section = sectionId ?? null;
    if (onMoveToGroup && groupKey && sectionId === undefined) {
      onMoveToGroup(ids, groupKey);
      if (projectId) toast("Task moved", "Undo", undo);
      return;
    }
    ids.forEach((taskId, index) => {
      dispatch({
        type: "task/move",
        id: taskId,
        sectionId: section,
        projectId: projectId ?? undefined,
        beforeId:
          targetTask && targetTask.id !== taskId
            ? position === "after"
              ? nextSiblingId(state.tasks, targetTask, section)
              : targetTask.id
            : null,
      });
      void index;
    });
    if (section && projectId) toast("Task moved", "Undo", undo);
  };

  const hasAny = groups.some((g) => applyFilters(g.tasks).length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ListToolbar
        projectId={projectId ?? null}
        showViews={Boolean(projectId)}
        savedViews={state.savedViews
          .filter((v) => v.projectId === projectId)
          .map((v) => ({ id: v.id, name: v.name }))}
        onApplyView={(id) => {
          const view = state.savedViews.find((v) => v.id === id);
          if (!view) return;
          setFilters({
            completed: "all",
            due: "any",
            priority: "any",
            ...(view.filters as TaskFilters),
          });
          setSortKey(view.sortKey as SortKey);
          setSortDir(view.sortDir);
          toast(`Applied “${view.name}”`);
        }}
        onSaveView={(name) => {
          if (!projectId) {
            toast("Open a project to save a view");
            return;
          }
          dispatch({
            type: "savedView/create",
            projectId,
            name,
            view: "list",
            filters: {
              completed: filters.completed,
              due: filters.due,
              priority: filters.priority,
              assigneeIds: filters.assigneeIds,
              tagIds: filters.tagIds,
            },
            sortKey,
            sortDir,
          });
          toast(`Saved view “${name}”`);
        }}
        onDeleteView={(id) => dispatch({ type: "savedView/delete", id })}
        allTasks={toolbarTasks ?? allTasks}
        filtered={allTasks}
        filters={filters}
        setFilters={setFilters}
        sortKey={sortKey}
        sortDir={sortDir}
        setSort={(k, d) => {
          setSortKey(k);
          setSortDir(d);
        }}
        columns={columns}
        setColumns={setColumns}
        onSeeAll={() => allTasks[0] && onOpenTask(allTasks[0].id)}
        showCompleted={showCompleted}
        setShowCompleted={setShowCompleted}
      />
      <div className="page-scroll" style={{ position: "relative" }}>
        <div className="task-list">
          <div className="list-head">
            <div className="col" style={{ width: 16 }} />
            <div className="col" style={{ flex: 1 }}>
              {groupLabels?.[0] ?? "Task name"}
            </div>
            {columns.projects && <div className="col" style={{ width: 150 }}>Projects</div>}
            {columns.assignee && <div className="col" style={{ width: 116 }}>Assignee</div>}
            {columns.due && <div className="col" style={{ width: 108 }}>Due date</div>}
            {columns.priority && <div className="col" style={{ width: 92 }}>Priority</div>}
            {columns.tags && <div className="col" style={{ width: 120 }}>Tags</div>}
            {columns.fields.map((id) => (
              <div className="col" key={id} style={{ width: 120 }}>
                {state.fields.find((f) => f.id === id)?.name}
              </div>
            ))}
            <div style={{ width: 76 }} />
          </div>

          {groups.map((group) => {
            const tasks = applyFilters(group.tasks);
            const isCollapsed = collapsed[group.key] ?? false;
            return (
              <div key={group.key}>
                {group.sectionId !== undefined && projectId ? (
                  <SectionHeader
                    section={
                      state.sections.find((s) => s.id === group.sectionId) ?? {
                        id: group.sectionId ?? group.key,
                        projectId: projectId,
                        name: group.name,
                        order: 0,
                        collapsed: false,
                      }
                    }
                    tasks={group.tasks}
                    onOpenTask={onOpenTask}
                    collapsed={isCollapsed}
                    onToggleCollapse={() =>
                      setCollapsed((c) => ({ ...c, [group.key]: !isCollapsed }))
                    }
                    canCreate={canCreate}
                  />
                ) : (
                  <div className="section-header" style={{ top: 32 }}>
                    <button
                      className="icon-btn sm"
                      onClick={() =>
                        setCollapsed((c) => ({ ...c, [group.key]: !isCollapsed }))
                      }
                    >
                      <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size={13} />
                    </button>
                    {group.color && (
                      <span
                        className="swatch"
                        style={{ background: `var(--swatch-${group.color}-bg)` }}
                      />
                    )}
                    <span className="section-name" style={{ padding: "1px 4px" }}>
                      {group.name}
                    </span>
                    <span className="section-count">{tasks.length}</span>
                    {group.meta}
                  </div>
                )}

                {!isCollapsed && (
                  <>
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        onDragOver={(e) => {
                          e.preventDefault();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const position =
                            e.clientY - rect.top < rect.height / 2 ? "before" : "after";
                          setDropTarget({
                            taskId: task.id,
                            position: dropTarget?.taskId === task.id ? dropTarget.position : position,
                            sectionId: group.sectionId ?? null,
                          });
                        }}
                        onDrop={(e) =>
                          handleDrop(
                            e,
                            task,
                            group.sectionId ?? null,
                            dropTarget?.taskId === task.id ? dropTarget.position : "before",
                            group.key
                          )
                        }
                        style={{
                          borderTop:
                            dropTarget?.taskId === task.id && dropTarget.position === "before"
                              ? "2px solid var(--color-primary-border)"
                              : undefined,
                          borderBottom:
                            dropTarget?.taskId === task.id && dropTarget.position === "after"
                              ? "2px solid var(--color-primary-border)"
                              : undefined,
                        }}
                      >
                        <TaskRow
                          task={task}
                          columns={columns}
                          onOpen={onOpenTask}
                          selected={selection.has(task.id)}
                          onToggleSelect={(e) => toggleSelect(task.id, e.metaKey || e.shiftKey)}
                          dragProps={{
                            draggable: true,
                            onDragStart: (e: React.DragEvent<HTMLDivElement>) => startDrag(e, task),
                            onDragEnd: () => {
                              setDragging(null);
                              setDropTarget(null);
                            },
                          }}
                        />
                      </div>
                    ))}

                    {tasks.length === 0 && (
                      <div
                        className="empty"
                        style={{ padding: "16px 24px", alignItems: "flex-start" }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleDrop(e, null, group.sectionId ?? null, "empty", group.key)}
                      >
                        <span className="small weak">No tasks in this section</span>
                      </div>
                    )}

                    {allowAdd && canCreate && (
                      <AddTaskRow
                        projectId={projectId ?? null}
                        sectionId={group.sectionId ?? null}
                        onCreated={onOpenTask}
                        defaults={newTaskDefaults}
                      />
                    )}
                  </>
                )}
              </div>
            );
          })}

          {!hasAny && (
            <EmptyState
              icon="check-circle"
              title={emptyTitle}
              description={emptyDescription}
            />
          )}

          {onAddSection && canEdit && (
            <button
              className="add-task-row"
              style={{ color: "var(--color-text-weak)", paddingLeft: 24 }}
              onClick={onAddSection}
            >
              <Icon name="plus" size={13} /> Add section
            </button>
          )}
        </div>

        {selection.size > 0 && (
          <div className="bulk-bar" style={{ position: "sticky", bottom: 12 }}>
            <span className="bulk-count">{selection.size} selected</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const ids = [...selection];
                ids.forEach((id) => dispatch({ type: "task/toggleComplete", id, value: true }));
                toast(`${ids.length} tasks completed`, "Undo", undo);
                clearSelection();
              }}
            >
              <Icon name="check" size={13} /> Complete
            </button>
            <BulkDue ids={[...selection]} />
            <BulkAssign ids={[...selection]} />
            <BulkMove ids={[...selection]} projectId={projectId ?? null} />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                dispatch({ type: "tasks/delete", ids: [...selection] });
                toast(`${selection.size} tasks deleted`, "Undo", undo);
                clearSelection();
              }}
            >
              <Icon name="trash" size={13} /> Delete
            </button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={clearSelection}>
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function nextSiblingId(tasks: Task[], target: Task, sectionId: ID | null | undefined) {
  const siblings = tasks
    .filter((t) => t.sectionId === (sectionId ?? null) && !t.parentId)
    .sort((a, b) => a.order - b.order);
  const idx = siblings.findIndex((t) => t.id === target.id);
  return siblings[idx + 1]?.id ?? null;
}

/* ------------------------------------------------------------ bulk tools */
function BulkDue({ ids }: { ids: ID[] }) {
  const { dispatch } = useApp();
  return (
    <DatePicker value={null} onChange={(iso) => ids.forEach((id) => dispatch({ type: "task/setDue", id, dueDate: iso }))}>
      {(open) => (
        <button className="btn btn-ghost btn-sm" onClick={(e) => open(e.currentTarget)}>
          <Icon name="calendar" size={13} /> Due date
        </button>
      )}
    </DatePicker>
  );
}

function BulkAssign({ ids }: { ids: ID[] }) {
  const { dispatch } = useApp();
  return (
    <UserPicker
      value={null}
      onChange={(userId) => ids.forEach((id) => dispatch({ type: "task/setAssignee", id, userId }))}
    >
      {(open) => (
        <button className="btn btn-ghost btn-sm" onClick={(e) => open(e.currentTarget)}>
          <Icon name="person" size={13} /> Assign
        </button>
      )}
    </UserPicker>
  );
}

function BulkMove({ ids, projectId }: { ids: ID[]; projectId: ID | null }) {
  const { state, dispatch } = useApp();
  const pop = usePopover();
  const sections = state.sections.filter((s) => s.projectId === projectId);
  if (!projectId) return null;
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={(e) => pop.openAt(e.currentTarget)}>
        <Icon name="arrow-right" size={13} /> Move
      </button>
      {pop.open && pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={220}>
          <MenuLabel>Sections</MenuLabel>
          {sections.map((s) => (
            <MenuItem
              key={s.id}
              onClick={() => {
                ids.forEach((id) => dispatch({ type: "task/move", id, sectionId: s.id }));
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

