import React, { useMemo, useState } from "react";
import { useApp } from "../core/store";
import { projectRisk, type ProjectRisk } from "../core/insights";
import { navigate } from "../core/router";
import { formatDue } from "../core/utils";
import type { ID } from "../core/types";
import { Icon } from "../ui/icons";

export function RiskBadge({ risk }: { risk: ProjectRisk }) {
  return (
    <span className={`risk-badge risk-${risk.level}`} title={risk.factors.map((f) => f.label).join(" · ") || "No risk signals"}>
      {risk.score}
      <span className="risk-word">{risk.level === "high" ? "High" : risk.level === "medium" ? "Medium" : "Low"}</span>
    </span>
  );
}

/** Explainable slip-risk per project, most at-risk first. */
export function RiskRadar({ projectIds }: { projectIds: ID[] }) {
  const { state } = useApp();
  const [open, setOpen] = useState<ID | null>(null);
  const risks = useMemo(
    () => projectIds.map((id) => projectRisk(state, id)).sort((a, b) => b.score - a.score),
    [state, projectIds]
  );
  return (
    <section className="stat-card" aria-label="Risk radar">
      <h4>
        <Icon name="sparkle" size={13} /> Risk radar
      </h4>
      <ul className="risk-list">
        {risks.map((r) => {
          const p = state.projects.find((x) => x.id === r.projectId)!;
          const expanded = open === r.projectId;
          return (
            <li key={r.projectId}>
              <button className="risk-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.projectId)}>
                <span className="swatch" style={{ background: `var(--swatch-${p.color}-bg)` }} />
                <span className="grow truncate" style={{ textAlign: "left" }}>
                  {p.name}
                </span>
                <span className="small weak">{r.factors[0]?.label ?? "On track"}</span>
                <RiskBadge risk={r} />
                <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} />
              </button>
              {expanded && (
                <div className="risk-detail">
                  {r.forecastEnd && (
                    <span className="small weak">
                      Forecast finish {formatDue(r.forecastEnd)}
                      {p.dueDate ? ` · due ${formatDue(p.dueDate)}` : ""}
                    </span>
                  )}
                  {r.factors.length === 0 && <span className="small">No risk signals — keep going.</span>}
                  {r.factors.map((f) => (
                    <div key={f.key} className="risk-factor">
                      <span className="risk-weight mono">+{f.weight}</span>
                      <span className="grow">{f.label}</span>
                      {f.taskIds.slice(0, 3).map((id) => {
                        const t = state.tasks.find((x) => x.id === id);
                        return t ? (
                          <button key={id} className="chip" onClick={() => navigate(`/project/${p.id}/list?task=${id}`)}>
                            {t.name.length > 28 ? `${t.name.slice(0, 28)}…` : t.name}
                          </button>
                        ) : null;
                      })}
                    </div>
                  ))}
                  <span className="small weak">Generated from tasks, dates and status updates · review before acting.</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
