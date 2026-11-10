import React, { useMemo, useState } from "react";
import { useApp } from "../core/store";
import { capacityByWeek, suggestRebalance, taskHours, type RebalanceSuggestion } from "../core/insights";
import { fromISO } from "../core/utils";

/** "Nov 9" — weeks are calendar dates, never "Yesterday". */
const weekLabel = (iso: string) => fromISO(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
import type { ID } from "../core/types";
import { Icon } from "../ui/icons";
import { Avatar } from "../ui/primitives";

/** Hours-based workload against each person's weekly capacity, with AI rebalancing. */
export function WorkloadView() {
  const { state, dispatch, userById, user, can, toast } = useApp();
  const [weeks, setWeeks] = useState(4);
  const [projectId, setProjectId] = useState<ID | "">("");
  const [focusWeek, setFocusWeek] = useState(0);
  const [editing, setEditing] = useState<ID | null>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<{ userId: ID; week: number } | null>(null);

  const load = useMemo(() => capacityByWeek(state, weeks, projectId ? [projectId] : undefined), [state, weeks, projectId]);
  const week = load[Math.min(focusWeek, load.length - 1)];
  const suggestions = useMemo<RebalanceSuggestion[]>(() => (week ? suggestRebalance(state, week) : []), [state, week]);
  const people = state.users.filter((u) => !u.isAgent);
  const over = load.reduce((n, w) => n + w.rows.filter((r) => r.hours > r.capacity).length, 0);
  const isAdmin = can("workspace:admin");

  const accept = (s: RebalanceSuggestion) => {
    dispatch({ type: "task/setAssignee", id: s.taskId, userId: s.toId });
    toast(`Moved “${state.tasks.find((t) => t.id === s.taskId)?.name}” to ${userById(s.toId)?.name}`);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <h1 className="page-title">
            <Icon name="users" size={22} /> Workload
          </h1>
          <div className="page-actions">
            <select className="input" aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="segmented">
              {[2, 4, 8].map((w) => (
                <button key={w} className={weeks === w ? "active" : ""} onClick={() => setWeeks(w)}>
                  {w}w
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="page-subtitle">
          Planned hours of open work due each week, against each person's capacity.{" "}
          {over > 0 ? <b className="schedule-late">{over} overloaded person-week{over === 1 ? "" : "s"}</b> : "Nobody is over capacity."}
        </p>
      </div>

      <div className="page-scroll">
        <div className="workload-layout">
          <div className="workload-grid" style={{ gridTemplateColumns: `minmax(180px, 240px) repeat(${weeks}, minmax(70px, 1fr)) 96px` }}>
            <div className="small weak">Teammate</div>
            {load.map((w, i) => (
              <button
                key={w.weekStart}
                className={`small workload-week${i === focusWeek ? " active" : ""}`}
                onClick={() => setFocusWeek(i)}
                title="Plan this week"
              >
                Week of {weekLabel(w.weekStart)}
              </button>
            ))}
            <div className="small weak" style={{ textAlign: "right" }}>
              Capacity
            </div>

            {people.map((person) => (
              <React.Fragment key={person.id}>
                <div className="row" style={{ gap: 8, minWidth: 0 }}>
                  <Avatar user={person} size={22} />
                  <span className="truncate small">{person.name}</span>
                </div>
                {load.map((w, i) => {
                  const row = w.rows.find((r) => r.userId === person.id)!;
                  const ratio = row.capacity ? row.hours / row.capacity : row.hours ? 2 : 0;
                  const level = row.hours === 0 ? "empty" : ratio > 1 ? "over" : ratio > 0.8 ? "full" : "ok";
                  return (
                    <button
                      key={w.weekStart}
                      className={`heat-cell load-${level}${i === focusWeek ? " focus" : ""}`}
                      title={`${row.hours}h of ${row.capacity}h · ${row.taskIds.length} task${row.taskIds.length === 1 ? "" : "s"}`}
                      onClick={() => setOpen(open?.userId === person.id && open.week === i ? null : { userId: person.id, week: i })}
                    >
                      {row.hours ? `${row.hours}h` : ""}
                    </button>
                  );
                })}
                <div style={{ textAlign: "right" }}>
                  {editing === person.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const n = Number(draft);
                        if (Number.isFinite(n) && n >= 0 && n <= 80) dispatch({ type: "user/setCapacity", userId: person.id, hours: n });
                        setEditing(null);
                      }}
                    >
                      <input
                        className="input mono"
                        style={{ width: 70 }}
                        autoFocus
                        type="number"
                        min={0}
                        max={80}
                        aria-label={`${person.name} weekly capacity`}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                      />
                    </form>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm mono"
                      disabled={!(person.id === user.id || isAdmin)}
                      title={person.id === user.id || isAdmin ? "Edit weekly capacity" : "Only admins can change someone else's capacity"}
                      onClick={() => {
                        setEditing(person.id);
                        setDraft(String(person.capacityHours ?? 40));
                      }}
                    >
                      {person.capacityHours ?? 40}h/wk
                    </button>
                  )}
                </div>
                {open?.userId === person.id && (
                  <div className="workload-detail" style={{ gridColumn: `1 / span ${weeks + 2}` }}>
                    {load[open.week].rows
                      .find((r) => r.userId === person.id)!
                      .taskIds.map((id) => state.tasks.find((t) => t.id === id)!)
                      .map((t) => (
                        <span key={t.id} className="chip">
                          {t.name} · {taskHours(t)}h
                        </span>
                      ))}
                    {load[open.week].rows.find((r) => r.userId === person.id)!.taskIds.length === 0 && (
                      <span className="small weak">Nothing due that week.</span>
                    )}
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          <aside className="stat-card rebalance">
            <h4>
              <Icon name="sparkle" size={13} /> Suggested rebalancing · week of {week ? weekLabel(week.weekStart) : "—"}
            </h4>
            {suggestions.length === 0 ? (
              <p className="small weak">
                {week?.rows.some((r) => r.hours > r.capacity)
                  ? "Someone is over capacity, but nobody who can edit those projects has room. Consider moving dates instead."
                  : "Everyone is within capacity this week."}
              </p>
            ) : (
              <ul className="rebalance-list">
                {suggestions.map((s) => {
                  const t = state.tasks.find((x) => x.id === s.taskId);
                  return (
                    <li key={s.taskId}>
                      <div className="col" style={{ minWidth: 0 }}>
                        <span className="truncate">
                          <b>{t?.name}</b> · {s.hours}h
                        </span>
                        <span className="small weak">
                          {userById(s.fromId)?.name.split(" ")[0]} → {userById(s.toId)?.name.split(" ")[0]} · {s.reason}
                        </span>
                      </div>
                      <button className="btn btn-secondary btn-sm" onClick={() => accept(s)}>
                        Accept
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="small weak">AI suggestion · check with the people involved before moving their work.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
