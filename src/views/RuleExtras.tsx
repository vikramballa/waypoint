import React, { useState } from "react";
import { useApp } from "../core/store";
import { detectRuleLoops, simulateRule, type SimulationResult } from "../core/rules";
import type { Rule, RuleCondition, RuleConditionField, Section } from "../core/types";
import { Icon } from "../ui/icons";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function ScheduleEditor({ rule }: { rule: Rule }) {
  const { dispatch } = useApp();
  const s = rule.schedule ?? { every: "weekday" as const, at: "09:00" };
  const set = (patch: Partial<NonNullable<Rule["schedule"]>>) =>
    dispatch({ type: "rule/update", id: rule.id, patch: { schedule: { ...s, ...patch } } });
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <select className="input" aria-label="Repeat" value={s.every} onChange={(e) => set({ every: e.target.value as "day" | "weekday" | "week" })}>
        <option value="day">Every day</option>
        <option value="weekday">Every weekday</option>
        <option value="week">Every week</option>
      </select>
      {s.every === "week" && (
        <select className="input" aria-label="Day" value={s.dayOfWeek ?? 1} onChange={(e) => set({ dayOfWeek: Number(e.target.value) })}>
          {DAYS.map((d, i) => (
            <option key={d} value={i}>
              on {d}
            </option>
          ))}
        </select>
      )}
      <input className="input" type="time" aria-label="Time" value={s.at} onChange={(e) => set({ at: e.target.value || "09:00" })} />
      <span className="small weak">
        Runs on every matching task in the project{rule.lastRunAt ? ` · last ran ${new Date(rule.lastRunAt).toLocaleString()}` : ""}
      </span>
    </div>
  );
}

const FIELDS: { key: RuleConditionField; label: string }[] = [
  { key: "priority", label: "Priority" },
  { key: "assignee", label: "Assignee" },
  { key: "section", label: "Section" },
  { key: "tag", label: "Tag" },
  { key: "due", label: "Due date" },
  { key: "completed", label: "Completion" },
];

const OPS: Record<RuleConditionField, { op: RuleCondition["op"]; label: string; needsValue: boolean }[]> = {
  priority: [
    { op: "is", label: "is", needsValue: true },
    { op: "is-not", label: "is not", needsValue: true },
    { op: "is-empty", label: "is not set", needsValue: false },
  ],
  assignee: [
    { op: "is", label: "is", needsValue: true },
    { op: "is-not", label: "is not", needsValue: true },
    { op: "is-empty", label: "is unassigned", needsValue: false },
    { op: "is-set", label: "is assigned", needsValue: false },
  ],
  section: [
    { op: "is", label: "is", needsValue: true },
    { op: "is-not", label: "is not", needsValue: true },
  ],
  tag: [
    { op: "is", label: "has", needsValue: true },
    { op: "is-not", label: "doesn't have", needsValue: true },
  ],
  due: [
    { op: "overdue", label: "is overdue", needsValue: false },
    { op: "within-days", label: "is within N days", needsValue: true },
    { op: "is-empty", label: "is not set", needsValue: false },
  ],
  completed: [{ op: "is", label: "is", needsValue: true }],
};

export function ConditionsEditor({ rule, sections }: { rule: Rule; sections: Section[] }) {
  const { state, dispatch } = useApp();
  const conditions = rule.conditions ?? [];
  const save = (next: RuleCondition[]) => dispatch({ type: "rule/update", id: rule.id, patch: { conditions: next } });
  const update = (id: string, patch: Partial<RuleCondition>) => save(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const valueInput = (c: RuleCondition) => {
    const meta = OPS[c.field].find((o) => o.op === c.op);
    if (!meta?.needsValue) return null;
    const common = { className: "input", value: c.value ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => update(c.id, { value: e.target.value }) };
    switch (c.field) {
      case "priority":
        return (
          <select {...common} aria-label="Priority">
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        );
      case "assignee":
        return (
          <select {...common} aria-label="Person">
            <option value="">Choose person</option>
            {state.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        );
      case "section":
        return (
          <select {...common} aria-label="Section">
            <option value="">Choose section</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        );
      case "tag":
        return (
          <select {...common} aria-label="Tag">
            <option value="">Choose tag</option>
            {state.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        );
      case "completed":
        return (
          <select {...common} aria-label="Completion">
            <option value="false">incomplete</option>
            <option value="true">complete</option>
          </select>
        );
      default:
        return <input {...common} type="number" min={0} max={365} style={{ width: 80 }} aria-label="Days" />;
    }
  };

  return (
    <>
      <b className="row">
        <Icon name="filter" size={13} /> Only if
      </b>
      {conditions.length === 0 && <span className="small weak">No conditions — runs on every matching task.</span>}
      {conditions.map((c) => (
        <div className="row" key={c.id} style={{ gap: 8, flexWrap: "wrap" }}>
          <select
            className="input"
            aria-label="Field"
            value={c.field}
            onChange={(e) => {
              const field = e.target.value as RuleConditionField;
              update(c.id, { field, op: OPS[field][0].op, value: field === "completed" ? "false" : "" });
            }}
          >
            {FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <select className="input" aria-label="Operator" value={c.op} onChange={(e) => update(c.id, { op: e.target.value as RuleCondition["op"] })}>
            {OPS[c.field].map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </select>
          {valueInput(c)}
          <button className="icon-btn sm" aria-label="Remove condition" onClick={() => save(conditions.filter((x) => x.id !== c.id))}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => save([...conditions, { id: `${rule.id}-c-${Date.now().toString(36)}`, field: "priority", op: "is", value: "high" }])}
        >
          <Icon name="plus" size={12} /> Add condition
        </button>
      </div>
    </>
  );
}

/** Loop warning + 30-day dry run. */
export function RuleInsights({ rule }: { rule: Rule }) {
  const { state } = useApp();
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const loops = detectRuleLoops(state, rule.projectId, rule).filter((cycle) => cycle.includes(rule.id));
  const names = (ids: string[]) => ids.map((id) => state.rules.find((r) => r.id === id)?.name ?? rule.name).join(" → ");
  return (
    <div className="col" style={{ gap: 8 }}>
      {loops.length > 0 && rule.enabled && (
        <div className="callout" role="alert">
          <b>These rules trigger each other:</b> {names(loops[0])} → {names([loops[0][0]])}. Waypoint stops each chain after 8 steps, but you probably want to break the loop.
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setSim(simulateRule(state, rule, 30))}>
          <Icon name="clock" size={12} /> Dry run (last 30 days)
        </button>
        {sim && (
          <span className="small" role="status">
            Would have run <b>{sim.runs}</b> time{sim.runs === 1 ? "" : "s"} on <b>{sim.taskIds.length}</b> task{sim.taskIds.length === 1 ? "" : "s"} ({sim.actions} action
            {sim.actions === 1 ? "" : "s"}). <span className="weak">{sim.note}. Nothing was changed.</span>
          </span>
        )}
      </div>
    </div>
  );
}
