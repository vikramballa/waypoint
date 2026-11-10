import React, { useState } from "react";
import { useApp } from "../core/store";
import { navigate } from "../core/router";
import { DEFAULT_DEV_SETTINGS } from "../core/seed-v3";
import type { DevSettings, ID } from "../core/types";
import { Icon } from "../ui/icons";

const TOGGLES: { key: keyof DevSettings; label: string; help: string }[] = [
  { key: "autoReadyRelease", label: "Mark releases ready automatically", help: "When every ticket in a release is done, its status becomes Ready (and back to In progress if a ticket reopens)." },
  { key: "releaseNotes", label: "Keep release notes up to date", help: "Regenerate notes from shipped and open tickets whenever a ticket changes status." },
  { key: "sessionToReview", label: "Send finished agent sessions to review", help: "When an AI agent session completes, its linked ticket moves to Review." },
];

/** Branch naming + release automation per dev space (route: /dev/settings). */
export function DevSettingsView() {
  const { state, dispatch, toast, can, user } = useApp();
  const [spaceId, setSpaceId] = useState<ID>(state.devSpaces[0]?.id ?? "");
  const space = state.devSpaces.find((s) => s.id === spaceId);
  const settings: DevSettings = { ...DEFAULT_DEV_SETTINGS, ...(space?.settings ?? {}) };
  const editable = !!space && can("task:edit") && (space.memberIds.includes(user.id) || can("workspace:admin"));
  const [template, setTemplate] = useState(settings.branchTemplate);
  const sample = template
    .replace("{key}", space?.key ?? "DEV")
    .replace("{number}", "418")
    .replace("{slug}", "builder-unsaved-changes");

  const save = (patch: Partial<DevSettings>) => {
    if (!space) return;
    dispatch({ type: "devSpace/settings", spaceId: space.id, patch });
    toast("Dev settings saved");
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-row">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/dev")}>
            <Icon name="arrow-left" size={14} /> Dev
          </button>
          <h1 className="page-title">
            <Icon name="settings" size={20} /> Dev settings
          </h1>
          <div className="page-actions">
            <select className="input" value={spaceId} onChange={(e) => setSpaceId(e.target.value)} aria-label="Dev space">
              {state.devSpaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="page-subtitle">Automation that runs as tickets move — no scripts, no webhooks to babysit.</p>
      </div>
      <div className="page-scroll">
        <div className="settings-stack">
          {!editable && <div className="callout">Only members of this space can change its settings.</div>}
          <section className="stat-card">
            <h4>Branch naming</h4>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input
                className="input mono"
                style={{ flex: "1 1 260px" }}
                value={template}
                maxLength={80}
                disabled={!editable}
                onChange={(e) => setTemplate(e.target.value)}
                aria-label="Branch name template"
              />
              <button className="btn btn-secondary" disabled={!editable || template === settings.branchTemplate} onClick={() => save({ branchTemplate: template.trim() || DEFAULT_DEV_SETTINGS.branchTemplate })}>
                Save
              </button>
            </div>
            <div className="small weak">
              Placeholders: <code>{"{key}"}</code> <code>{"{number}"}</code> <code>{"{slug}"}</code> · e.g. <code className="mono">{sample}</code>
            </div>
          </section>
          <section className="stat-card">
            <h4>Release automation</h4>
            {TOGGLES.map((t) => (
              <div className="setting-row" key={t.key}>
                <div className="col" style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 550 }}>{t.label}</span>
                  <span className="small weak">{t.help}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!settings[t.key]}
                  aria-label={t.label}
                  disabled={!editable}
                  className={`switch${settings[t.key] ? " on" : ""}`}
                  onClick={() => save({ [t.key]: !settings[t.key] })}
                />
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
