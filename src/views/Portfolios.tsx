import React, { useState } from "react";
import { PortfolioBody } from "./PortfolioViews";
import { useApp } from "../core/store";
import type { ID } from "../core/types";
import { navigate } from "../core/router";
import { portfolioRollup, projectStats } from "../core/selectors";
import { formatDue, pct, swatchBg, todayISO } from "../core/utils";
import { Icon } from "../ui/icons";
import {
  Avatar,
  AvatarStack,
  MenuItem,
  Popover,
  ProgressBar,
  usePopover,
} from "../ui/primitives";

export function PortfoliosView({ onCreate }: { onCreate: () => void }) {
  const { state, dispatch } = useApp();
  const [selected, setSelected] = useState<ID | null>(state.portfolios[0]?.id ?? null);
  const portfolio = state.portfolios.find((p) => p.id === selected);
  const addPop = usePopover();

  return (
    <div className="page" style={{ flexDirection: "row" }}>
      <div
        style={{
          width: 240,
          minWidth: 240,
          borderRight: "1px solid var(--color-border)",
          background: "var(--color-background-medium)",
          padding: 8,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div className="side-group-header" style={{ paddingTop: 4 }}>
          <span>Portfolios</span>
          <button className="icon-btn sm" onClick={onCreate} title="New portfolio">
            <Icon name="plus" size={13} />
          </button>
        </div>
        {state.portfolios.map((p) => (
          <button
            key={p.id}
            className={`side-item${selected === p.id ? " active" : ""}`}
            onClick={() => setSelected(p.id)}
          >
            <span className="side-icon">
              <span
                className="swatch dot"
                style={{ background: swatchBg(p.color) }}
              />
            </span>
            <span className="side-label">{p.name}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="side-item" onClick={onCreate}>
          <span className="side-icon">
            <Icon name="plus" size={14} />
          </span>
          <span className="side-label">New portfolio</span>
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {!portfolio && (
          <div className="empty">
            <h3>No portfolio selected</h3>
          </div>
        )}
        {portfolio && (
          <>
            <div className="page-header">
              <div className="page-header-row">
                <h1 className="page-title">
                  <span
                    className="swatch"
                    style={{ width: 18, height: 18, background: swatchBg(portfolio.color) }}
                  />
                  {portfolio.name}
                </h1>
                <div className="page-actions">
                  <AvatarStack
                    users={portfolio.memberIds.map((id) => state.users.find((u) => u.id === id))}
                    size={26}
                  />
                  <button className="btn btn-secondary" onClick={(e) => addPop.openAt(e.currentTarget)}>
                    <Icon name="plus" size={13} /> Add work
                  </button>
                </div>
              </div>
              <p className="page-subtitle">
                {portfolio.projectIds.length} projects ·{" "}
                {portfolioRollup(state, portfolio.projectIds).percent}% complete
              </p>
            </div>

            <div className="page-scroll">
              <div style={{ padding: "8px 24px 48px", maxWidth: 1200 }}>
                <div className="grid-cards" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
                  {(() => {
                    const rollup = portfolioRollup(state, portfolio.projectIds);
                    return (
                      <>
                        <div className="stat-card">
                          <h4>Projects</h4>
                          <div className="stat-value">{portfolio.projectIds.length}</div>
                        </div>
                        <div className="stat-card">
                          <h4>Tasks</h4>
                          <div className="stat-value">{rollup.total}</div>
                        </div>
                        <div className="stat-card">
                          <h4>Complete</h4>
                          <div className="stat-value">{rollup.percent}%</div>
                          <ProgressBar percent={rollup.percent} />
                        </div>
                        <div className="stat-card">
                          <h4>Overdue</h4>
                          <div className="stat-value">{rollup.overdue}</div>
                        </div>
                      </>
                    );
                  })()}
                </div>

                <PortfolioBody portfolio={portfolio} />
              </div>
            </div>

            {addPop.open && addPop.anchor && (
              <Popover anchor={addPop.anchor} onClose={addPop.close} width={260} align="end">
                {state.projects.map((p) => (
                  <MenuItem
                    key={p.id}
                    checked={portfolio.projectIds.includes(p.id)}
                    onClick={() => {
                      const next = portfolio.projectIds.includes(p.id)
                        ? portfolio.projectIds.filter((x) => x !== p.id)
                        : [...portfolio.projectIds, p.id];
                      dispatch({
                        type: "portfolio/update",
                        id: portfolio.id,
                        patch: { projectIds: next },
                      });
                    }}
                  >
                    <span className="swatch" style={{ background: swatchBg(p.color) }} />
                    {p.name}
                  </MenuItem>
                ))}
              </Popover>
            )}
          </>
        )}
      </div>
    </div>
  );
}
