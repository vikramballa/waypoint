import React from "react";
import { useApp } from "../core/store";
import { navigate } from "../core/router";
import { WaypointLogo, Icon } from "./icons";
import { BRAND } from "../core/brand";
import { AccountModal, WhatsNewModal } from "../views/Account";
import { Avatar, MenuItem, MenuSeparator, Popover, usePopover } from "./primitives";

export function TopBar({
  onOpenPalette,
  onOpenAI,
  onCreate,
  onOpenInvite,
  onOpenShortcuts,
}: {
  onOpenPalette: () => void;
  onOpenAI: () => void;
  onCreate: (kind: "task" | "project" | "goal" | "portfolio") => void;
  onOpenInvite: () => void;
  onOpenShortcuts: () => void;
}) {
  const { state, dispatch, user, toast, can, mode, connection, logout, resetWorkspace } = useApp();
  const [dialog, setDialog] = React.useState<null | "account" | "news">(null);
  const createPop = usePopover();
  const avatarPop = usePopover();
  const helpPop = usePopover();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="hamburger"
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
          onClick={() =>
            dispatch({
              type: "ui/patch",
              patch: { sidebarCollapsed: !state.ui.sidebarCollapsed },
            })
          }
        >
          <Icon name="menu" size={18} />
        </button>
        <button
          className="brand-logo"
          onClick={() => navigate("/home")}
          title={`${BRAND.name} home`}
        >
          <WaypointLogo size={20} />
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" }}>
            {BRAND.name}
          </span>
        </button>
      </div>

      <div className="topbar-center">
        <button className="searchbar" onClick={onOpenPalette}>
          <Icon name="search" size={15} />
          <span style={{ flex: 1, textAlign: "left" }}>Search</span>
          <span className="kbd">⌘</span>
          <span className="kbd">K</span>
        </button>
      </div>

      <div className="topbar-right">
        {mode === "server" && (
          <span
            className={`conn-pill ${connection}`}
            role="status"
            title={connection === "live" ? "Connected — changes sync instantly" : connection === "connecting" ? "Reconnecting… your changes are queued" : "Offline — changes will sync when you're back"}
          >
            <span className="dot" />
            {connection === "live" ? "Live" : connection === "connecting" ? "Reconnecting" : "Offline"}
          </span>
        )}
        <button
          className="btn btn-primary"
          onClick={(e) => createPop.openAt(e.currentTarget)}
          aria-haspopup="menu"
        >
          <Icon name="plus" size={14} />
          Create
        </button>
        <button
          className="btn btn-ghost btn-sm"
          title={`Ask ${BRAND.ai} about your work`}
          onClick={onOpenAI}
        >
          <Icon name="sparkle" size={15} />
          <span>Ask AI</span>
        </button>
        <button
          className="icon-btn"
          aria-label="Help"
          onClick={(e) => helpPop.openAt(e.currentTarget)}
        >
          <Icon name="help" size={17} />
        </button>
        <button
          className="hamburger"
          aria-label="Account menu"
          onClick={(e) => avatarPop.openAt(e.currentTarget)}
        >
          <Avatar user={user} size={26} />
        </button>
      </div>

      {createPop.open && createPop.anchor && (
        <Popover anchor={createPop.anchor} onClose={createPop.close} width={230} align="end">
          <MenuItem
            icon={<Icon name="plus" size={14} />}
            right="Tab Q"
            onClick={() => {
              createPop.close();
              onCreate("task");
            }}
          >
            Task
          </MenuItem>
          <MenuItem
            icon={<Icon name="board" size={14} />}
            disabled={!can("project:create")}
            onClick={() => {
              createPop.close();
              onCreate("project");
            }}
          >
            Project
          </MenuItem>
          <MenuItem
            icon={<Icon name="target" size={14} />}
            disabled={!can("project:create")}
            onClick={() => {
              createPop.close();
              onCreate("goal");
            }}
          >
            Goal
          </MenuItem>
          <MenuItem
            icon={<Icon name="briefcase" size={14} />}
            disabled={!can("project:create")}
            onClick={() => {
              createPop.close();
              onCreate("portfolio");
            }}
          >
            Portfolio
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Icon name="users" size={14} />}
            disabled={!can("workspace:invite")}
            onClick={onOpenInvite}
          >
            Invite teammates
          </MenuItem>
          <MenuItem
            icon={<Icon name="sparkle" size={14} />}
            disabled={!can("agent:manage")}
            onClick={() => {
              createPop.close();
              navigate("/ai-teammates");
            }}
          >
            AI teammate
          </MenuItem>
        </Popover>
      )}

      {avatarPop.open && avatarPop.anchor && (
        <Popover anchor={avatarPop.anchor} onClose={avatarPop.close} width={260} align="end">
          <div className="row" style={{ padding: "6px 8px 10px", gap: 10 }}>
            <Avatar user={user} size={36} />
            <div className="col" style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>{user.name}</span>
              <span className="small weak truncate">{user.email}</span>
            </div>
          </div>
          <MenuSeparator />
          <MenuItem
            icon={<Icon name={state.ui.theme === "dark" ? "sun" : "moon"} size={14} />}
            onClick={() => {
              dispatch({
                type: "ui/patch",
                patch: { theme: state.ui.theme === "dark" ? "light" : "dark" },
              });
              avatarPop.close();
            }}
          >
            {state.ui.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          </MenuItem>
          <MenuItem
            icon={<Icon name="sparkle" size={14} />}
            onClick={() => {
              avatarPop.close();
              onOpenAI();
            }}
          >
            Ask AI about my work
          </MenuItem>
          <MenuItem
            icon={<Icon name="align" size={14} />}
            checked={state.ui.compact}
            onClick={() => {
              dispatch({ type: "ui/patch", patch: { compact: !state.ui.compact } });
            }}
          >
            Compact rows
          </MenuItem>
          <MenuItem
            icon={<Icon name="lock" size={14} />}
            onClick={() => {
              avatarPop.close();
              setDialog("account");
            }}
          >
            Account & security
          </MenuItem>
          <MenuSeparator />
          {(mode === "local" || can("billing:manage")) && (
            <MenuItem
              icon={<Icon name="refresh" size={14} />}
              onClick={() => {
                avatarPop.close();
                if (confirm("Reset the workspace back to the demo data? This replaces everything for everyone.")) resetWorkspace();
              }}
            >
              Reset demo workspace
            </MenuItem>
          )}
          {mode === "server" && (
            <MenuItem
              icon={<Icon name="external" size={14} />}
              onClick={() => {
                avatarPop.close();
                logout();
              }}
            >
              Sign out
            </MenuItem>
          )}
        </Popover>
      )}

      {helpPop.open && helpPop.anchor && (
        <Popover anchor={helpPop.anchor} onClose={helpPop.close} width={240} align="end">
          <MenuItem
            icon={<Icon name="key" size={14} />}
            right="?"
            onClick={() => {
              helpPop.close();
              onOpenShortcuts();
            }}
          >
            Keyboard shortcuts
          </MenuItem>
          <MenuItem
            icon={<Icon name="sparkle" size={14} />}
            onClick={() => {
              helpPop.close();
              setDialog("news");
            }}
          >
            What's new
          </MenuItem>
        </Popover>
      )}
      {dialog === "account" && <AccountModal onClose={() => setDialog(null)} />}
      {dialog === "news" && <WhatsNewModal onClose={() => setDialog(null)} />}
    </header>
  );
}
