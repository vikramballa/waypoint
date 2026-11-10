import React, { useEffect, useMemo, useRef, useState } from "react";
import { isStructured, matchesNaturalQuery, parseNaturalQuery } from "../core/insights";
import { useApp } from "../core/store";
import type { ID } from "../core/types";
import { navigate } from "../core/router";
import { searchAll } from "../core/selectors";
import { addDays, formatDue, parseQuery, swatchBg, todayISO } from "../core/utils";
import { Icon } from "../ui/icons";
import { Avatar, EmptyState, TagPill } from "../ui/primitives";

export function SearchView({
  initialQuery,
  onOpenTask,
}: {
  initialQuery: string;
  onOpenTask: (id: ID) => void;
}) {
  const { state, dispatch, userById } = useApp();
  const [q, setQ] = useState(initialQuery);
  const [tab, setTab] = useState<"all" | "tasks" | "projects" | "goals" | "people">("all");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQ(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const parsed = parseQuery(q);
  const [literal, setLiteral] = useState(false);
  // plain English ("overdue high priority for Priya") when no operator syntax is used
  const natural = useMemo(
    () => (q.includes(":") || literal ? null : parseNaturalQuery(state, q, state.currentUserId)),
    [q, literal, state]
  );
  const nlActive = !!natural && isStructured(natural);
  const results = useMemo(
    () => searchAll(state, nlActive ? natural!.text : parsed.text),
    [state, parsed.text, nlActive, natural]
  );

  const filteredTasks = useMemo(() => {
    if (nlActive) return state.tasks.filter((t) => !t.parentId && matchesNaturalQuery(t, natural!)).slice(0, 200);
    let list = results.tasks;
    if (parsed.completed) list = list.filter((t) => (parsed.completed === "yes" ? t.completed : !t.completed));
    if (parsed.priority) list = list.filter((t) => t.priority === parsed.priority);
    if (parsed.due === "today") list = list.filter((t) => t.dueDate === todayISO());
    if (parsed.due === "overdue") list = list.filter((t) => t.dueDate && t.dueDate < todayISO() && !t.completed);
    if (parsed.due === "week")
      list = list.filter((t) => t.dueDate && t.dueDate >= todayISO() && t.dueDate <= addDays(todayISO(), 7));
    if (parsed.due === "none") list = list.filter((t) => !t.dueDate);
    if (parsed.assignee === "me") list = list.filter((t) => t.assigneeId === state.currentUserId);
    if (parsed.tag)
      list = list.filter((t) =>
        t.tagIds.some((id) => state.tags.find((x) => x.id === id)?.name.toLowerCase().includes(parsed.tag!))
      );
    return list;
  }, [results.tasks, parsed, state, nlActive, natural]);

  const tokens = q.split(/\s+/).filter((t) => t.includes(":"));

  return (
    <div className="page">
      <div className="page-scroll">
        <div className="search-page">
          <div className="search-field">
            <Icon name="search" size={18} />
            <input
              ref={inputRef}
              placeholder="Search, or ask: “overdue high priority tasks for Priya”"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                navigate(`/search?q=${encodeURIComponent(e.target.value)}`);
              }}
            />
            {q && (
              <button
                className="icon-btn sm"
                onClick={() => {
                  setQ("");
                  navigate("/search?q=");
                }}
              >
                <Icon name="close" size={13} />
              </button>
            )}
          </div>

          {nlActive && (
            <div className="row nl-chips" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }} role="status">
              <span className="small weak">
                <Icon name="sparkle" size={12} /> Understood as:
              </span>
              {natural!.chips.map((c) => (
                <span className="chip active" key={c.key}>
                  {c.label}
                </span>
              ))}
              {natural!.text && <span className="chip">“{natural!.text}”</span>}
              <button className="btn btn-ghost btn-sm" onClick={() => setLiteral(true)}>
                Search the exact words instead
              </button>
            </div>
          )}
          {literal && !q.includes(":") && (
            <div className="row" style={{ gap: 6, marginTop: 10 }}>
              <span className="small weak">Searching the exact words.</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setLiteral(false)}>
                Understand my question
              </button>
            </div>
          )}

          {tokens.length > 0 && (
            <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <span className="small weak">Filters:</span>
              {tokens.map((t) => (
                <span className="chip active" key={t}>
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="tabs" style={{ padding: "16px 0 0", borderBottom: "1px solid var(--color-border)" }}>
            {(
              [
                ["all", `All (${filteredTasks.length + results.projects.length + results.goals.length})`],
                ["tasks", `Tasks (${filteredTasks.length})`],
                ["projects", `Projects (${results.projects.length})`],
                ["goals", `Goals (${results.goals.length})`],
                ["people", `People (${results.users.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={`tab${tab === key ? " active" : ""}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {!q.trim() && (
            <div style={{ marginTop: 24 }}>
              <h3 className="small weak" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Recent searches
              </h3>
              {["launch", "due:today", "assignee:me priority:high", "blocked", "brand"].map((s) => (
                <button
                  key={s}
                  className="result-row"
                  onClick={() => {
                    setQ(s);
                    navigate(`/search?q=${encodeURIComponent(s)}`);
                  }}
                >
                  <Icon name="search" size={14} />
                  <span>{s}</span>
                </button>
              ))}
            </div>
          )}

          {(tab === "all" || tab === "tasks") && filteredTasks.length > 0 && (
            <div className="result-group">
              <h3>Tasks</h3>
              {filteredTasks.slice(0, tab === "all" ? 8 : 50).map((task) => {
                const project = state.projects.find((p) => p.id === task.projectId);
                return (
                  <button key={task.id} className="result-row" onClick={() => onOpenTask(task.id)}>
                    <Icon name="check-circle" size={15} />
                    <span className="grow truncate">{task.name}</span>
                    {task.dueDate && <span className="small weak">{formatDue(task.dueDate)}</span>}
                    {project && (
                      <span className="small weak row" style={{ gap: 5 }}>
                        <span className="swatch dot" style={{ background: swatchBg(project.color) }} />
                        {project.name}
                      </span>
                    )}
                    <Avatar user={userById(task.assigneeId)} size={20} />
                  </button>
                );
              })}
            </div>
          )}

          {(tab === "all" || tab === "projects") && results.projects.length > 0 && (
            <div className="result-group">
              <h3>Projects</h3>
              {results.projects.map((project) => (
                <button
                  key={project.id}
                  className="result-row"
                  onClick={() => navigate(`/project/${project.id}/list`)}
                >
                  <span className="swatch" style={{ background: swatchBg(project.color) }} />
                  <span className="grow truncate">{project.name}</span>
                  <span className="small weak">
                    {state.teams.find((t) => t.id === project.teamId)?.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {(tab === "all" || tab === "goals") && results.goals.length > 0 && (
            <div className="result-group">
              <h3>Goals</h3>
              {results.goals.map((goal) => (
                <button key={goal.id} className="result-row" onClick={() => navigate("/goals")}>
                  <Icon name="target" size={15} />
                  <span className="grow truncate">{goal.name}</span>
                  <span className="small weak">{goal.status.replace("-", " ")}</span>
                </button>
              ))}
            </div>
          )}

          {(tab === "all" || tab === "people") && results.users.length > 0 && (
            <div className="result-group">
              <h3>People</h3>
              {results.users.map((u) => (
                <div key={u.id} className="result-row">
                  <Avatar user={u} size={24} />
                  <span className="grow">{u.name}</span>
                  <span className="small weak">{u.role}</span>
                </div>
              ))}
            </div>
          )}

          {q.trim() && filteredTasks.length + results.projects.length + results.goals.length + results.users.length === 0 && (
            <EmptyState
              icon="search"
              title={`No results for “${q}”`}
              description="Try a different search term, or use filters like due:today or assignee:me."
            />
          )}

          {tab === "all" && results.tags.length > 0 && (
            <div className="result-group">
              <h3>Tags</h3>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {results.tags.map((t) => {
                  const tag = state.tags.find((x) => x.id === t.id);
                  return tag ? (
                    <button key={t.id} onClick={() => navigate(`/tag/${t.id}`)}>
                      <TagPill name={tag.name} color={tag.color} />
                    </button>
                  ) : null;
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function TagView({ tagId, onOpenTask }: { tagId: ID; onOpenTask: (id: ID) => void }) {
  const { state } = useApp();
  const tag = state.tags.find((t) => t.id === tagId);
  const tasks = state.tasks.filter((t) => t.tagIds.includes(tagId) && !t.parentId);
  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <h1 className="page-title">
            <Icon name="tag" size={20} /> {tag?.name ?? "Tag"}
          </h1>
        </div>
        <p className="page-subtitle">{tasks.length} tasks with this tag</p>
      </div>
      <div className="page-scroll">
        <div style={{ padding: "0 24px" }}>
          {tasks.map((task) => {
            const project = state.projects.find((p) => p.id === task.projectId);
            return (
              <button
                key={task.id}
                className="task-row"
                style={{ width: "100%" }}
                onClick={() => onOpenTask(task.id)}
              >
                <Icon name="check-circle" size={14} />
                <span className="grow truncate" style={{ textAlign: "left" }}>
                  {task.name}
                </span>
                {project && <span className="small weak">{project.name}</span>}
                {task.dueDate && <span className="small weak">{formatDue(task.dueDate)}</span>}
                <Avatar user={state.users.find((u) => u.id === task.assigneeId)} size={20} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
