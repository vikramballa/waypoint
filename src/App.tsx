import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AppProvider, useApp } from "./core/store";
import { navigate, useRoute, type Route } from "./core/router";
import { EnrollScreen, JoinScreen, LoginScreen, PublicFormView, Splash } from "./views/Auth";
import { TopBar } from "./ui/TopBar";
import { Sidebar } from "./ui/Sidebar";
import { Toasts } from "./ui/primitives";
import { Icon } from "./ui/icons";
import { AgentRunner } from "./ui/AgentRunner";
import { BRAND } from "./core/brand";
import { lazyNamed, prefetchViews } from "./ui/lazy";

/* Route-level code splitting: each surface is its own chunk, fetched on first
   visit (and prefetched while the browser is idle after first paint). */
const HomeView = lazyNamed(() => import("./views/Home"), "HomeView");
const MyTasksView = lazyNamed(() => import("./views/MyTasks"), "MyTasksView");
const InboxView = lazyNamed(() => import("./views/Inbox"), "InboxView");
const ProjectView = lazyNamed(() => import("./views/ProjectView"), "ProjectView");
const GoalsView = lazyNamed(() => import("./views/Goals"), "GoalsView");
const PortfoliosView = lazyNamed(() => import("./views/Portfolios"), "PortfoliosView");
const ReportingView = lazyNamed(() => import("./views/Dashboard"), "ReportingView");
const SearchView = lazyNamed(() => import("./views/Search"), "SearchView");
const TagView = lazyNamed(() => import("./views/Search"), "TagView");
const AITeammatesView = lazyNamed(() => import("./views/AITeammates"), "AITeammatesView");
const AITeammateView = lazyNamed(() => import("./views/AITeammates"), "AITeammateView");
const CreateAgentModal = lazyNamed(() => import("./views/AITeammates"), "CreateAgentModal");
const AIChatView = lazyNamed(() => import("./views/AIChat"), "AIChatView");
const AskAIDrawer = lazyNamed(() => import("./views/AIChat"), "AskAIDrawer");
const MeetingsView = lazyNamed(() => import("./views/Meetings"), "MeetingsView");
const WorkloadView = lazyNamed(() => import("./views/Workload"), "WorkloadView");
const AutomationsView = lazyNamed(() => import("./views/Automations"), "AutomationsView");
const TemplatesView = lazyNamed(() => import("./views/Automations"), "TemplatesView");
const FormsView = lazyNamed(() => import("./views/Forms"), "FormsView");
const AgencyView = lazyNamed(() => import("./views/Operations"), "AgencyView");
const PagesView = lazyNamed(() => import("./views/Operations"), "PagesView");
const ServiceDeskView = lazyNamed(() => import("./views/Operations"), "ServiceDeskView");
const StatusTemplatesView = lazyNamed(() => import("./views/Operations"), "StatusTemplatesView");
const TablesView = lazyNamed(() => import("./views/Operations"), "TablesView");
const DevView = lazyNamed(() => import("./views/Dev"), "DevView");
const AdminView = lazyNamed(() => import("./views/Admin"), "AdminView");
const DevSettingsView = lazyNamed(() => import("./views/DevSettings"), "DevSettingsView");
const TaskPane = lazyNamed(() => import("./views/TaskPane"), "TaskPane");
const CommandPalette = lazyNamed(() => import("./ui/CommandPalette"), "CommandPalette");
const CreateGoalModal = lazyNamed(() => import("./views/Modals"), "CreateGoalModal");
const CreateProjectModal = lazyNamed(() => import("./views/Modals"), "CreateProjectModal");
const CreateTaskModal = lazyNamed(() => import("./views/Modals"), "CreateTaskModal");
const FieldLibraryModal = lazyNamed(() => import("./views/Modals"), "FieldLibraryModal");
const InviteModal = lazyNamed(() => import("./views/Modals"), "InviteModal");
const RuleBuilderModal = lazyNamed(() => import("./views/Modals"), "RuleBuilderModal");
const ShortcutsModal = lazyNamed(() => import("./views/Modals"), "ShortcutsModal");
const SimpleNameModal = lazyNamed(() => import("./views/Modals"), "SimpleNameModal");
import type { ID } from "./core/types";

type ModalKind =
  | null
  | "project"
  | "task"
  | "invite"
  | "fields"
  | "rules"
  | "shortcuts"
  | "goal"
  | "portfolio"
  | "agent";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

function Shell() {
  const { state, dispatch, toast, undo, redo, user, can, canEdit, impersonator, mode, setPresence } = useApp();
  const route = useRoute();
  const [paneTaskId, setPaneTaskId] = useState<ID | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [rulesProject, setRulesProject] = useState<ID | null>(null);
  const lastKey = useRef<{ key: string; at: number } | null>(null);

  const openTask = useCallback(
    (id: ID) => {
      setAiOpen(false);
      setPaneTaskId(id);
      dispatch({ type: "view/visit", kind: "task", id });
      if (route.kind === "project") {
        navigate(`/project/${route.id}/${route.view}?task=${id}`);
      }
    },
    [dispatch, route]
  );

  const closePane = useCallback(() => {
    setPaneTaskId(null);
    if (route.kind === "project" && route.taskId) {
      navigate(`/project/${route.id}/${route.view}`);
    }
  }, [route]);

  /* deep link: /task/:id and ?task= in project routes */
  useEffect(() => {
    if (route.kind === "project" && route.taskId) setPaneTaskId(route.taskId);
    if (route.kind === "task") setPaneTaskId(route.id);
    if (route.kind === "project") {
      dispatch({ type: "view/visit", kind: "project", id: route.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.kind, route.kind === "project" ? route.id : "", route.kind === "project" ? route.taskId : route.kind === "task" ? route.id : ""]);

  const openCreateTask = useCallback(() => setModal("task"), []);

  /* live presence: tell others which task / project this tab is on */
  useEffect(() => {
    setPresence(paneTaskId, route.kind === "project" ? route.id : null);
  }, [paneTaskId, route, setPresence]);

  useEffect(() => {
    const project = route.kind === "project" ? state.projects.find((p) => p.id === route.id) : null;
    const titles: Record<string, string> = {
      home: "Home",
      "my-tasks": "My tasks",
      inbox: "Inbox",
      goals: "Goals",
      portfolios: "Portfolios",
      reporting: "Reporting",
      search: "Search",
      tag: "Tag",
      task: "Task",
    };
    document.title = `${project?.name ?? titles[route.kind] ?? "Home"} · ${BRAND.name}`;
  }, [route, state.projects]);

  /* ------------------------------------------------------- hotkeys */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (meta && e.key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.key === "Escape") {
        if (paletteOpen) setPaletteOpen(false);
        else if (modal) setModal(null);
        else if (paneTaskId) closePane();
        return;
      }
      if (meta && e.key.toLowerCase() === "z") {
        if (isTyping(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        toast(e.shiftKey ? "Redone" : "Undone");
        return;
      }
      if (meta && e.key.toLowerCase() === "a" && !isTyping(e.target)) {
        // avoid clobbering select-all only outside inputs
      }
      if (isTyping(e.target) || meta) return;

      /* Tab-prefixed sequences */
      const now = Date.now();
      if (e.key === "Tab") {
        lastKey.current = { key: "Tab", at: now };
        return;
      }
      if (lastKey.current?.key === "Tab" && now - lastKey.current.at < 1500) {
        const k = e.key.toLowerCase();
        if (k === "q") {
          e.preventDefault();
          setModal("task");
          lastKey.current = null;
          return;
        }
        if (k === "a" && paneTaskId) {
          e.preventDefault();
          dispatch({ type: "task/setAssignee", id: paneTaskId, userId: state.currentUserId });
          toast("Assigned to you");
          lastKey.current = null;
          return;
        }
        if (k === "n" && route.kind === "project") {
          e.preventDefault();
          dispatch({ type: "section/create", projectId: route.id, name: "New section" });
          lastKey.current = null;
          return;
        }
      }

      /* g-prefixed navigation */
      if (lastKey.current?.key === "g" && now - lastKey.current.at < 1500) {
        const k = e.key.toLowerCase();
        const dest =
          k === "h" ? "/home" : k === "m" ? "/my-tasks" : k === "i" ? "/inbox" : k === "g" ? "/goals" : null;
        if (dest) {
          e.preventDefault();
          navigate(dest);
          lastKey.current = null;
          return;
        }
      }
      if (e.key.toLowerCase() === "g") {
        lastKey.current = { key: "g", at: now };
        return;
      }

      /* view switching inside a project */
      if (route.kind === "project" && ["1", "2", "3", "4", "5"].includes(e.key)) {
        const views = ["list", "board", "timeline", "calendar", "dashboard"] as const;
        e.preventDefault();
        navigate(`/project/${route.id}/${views[Number(e.key) - 1]}`);
        return;
      }

      /* task keyboard actions on the open pane */
      if (paneTaskId) {
        if (meta && e.key === "Enter") {
          e.preventDefault();
          const task = state.tasks.find((t) => t.id === paneTaskId);
          if (task && canEdit(task.id)) {
            dispatch({ type: "task/toggleComplete", id: task.id, value: !task.completed });
            toast(task.completed ? "Marked incomplete" : "Task completed");
          }
          return;
        }
        if (e.key === "Backspace" || e.key === "Delete") {
          const task = state.tasks.find((t) => t.id === paneTaskId);
          if (document.activeElement?.tagName === "BODY" && task && can("task:delete", task.projectId)) {
            e.preventDefault();
            dispatch({ type: "task/delete", id: paneTaskId });
            setPaneTaskId(null);
            toast("Task deleted");
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, undo, redo, toast, paletteOpen, modal, paneTaskId, route, state.tasks, state.currentUserId, closePane, can, canEdit]);

  const renderRoute = (r: Route) => {
    switch (r.kind) {
      case "home":
        return (
          <HomeView
            onOpenTask={openTask}
            onCreateProject={() => setModal("project")}
            onCreateTask={openCreateTask}
          />
        );
      case "my-tasks":
        return <MyTasksView onOpenTask={openTask} />;
      case "inbox":
        return <InboxView onOpenTask={openTask} />;
      case "goals":
        return <GoalsView onCreate={() => setModal("goal")} />;
      case "portfolios":
        return <PortfoliosView onCreate={() => setModal("portfolio")} />;
      case "reporting":
        return <ReportingView />;
      case "ai-teammates":
        return <AITeammatesView onCreate={() => setModal("agent")} />;
      case "ai-teammate":
        return <AITeammateView id={r.id} />;
      case "chat":
        return <AIChatView onOpenTask={openTask} />;
      case "meetings":
        return <MeetingsView />;
      case "workload":
        return <WorkloadView />;
      case "automations":
        return <AutomationsView onEdit={(projectId) => { setRulesProject(projectId); setModal("rules"); }} />;
      case "templates":
        return <TemplatesView />;
      case "forms":
        return <FormsView />;
      case "dev":
        return <DevView />;
      case "service":
        return <ServiceDeskView />;
      case "agency":
        return <AgencyView />;
      case "tables":
        return <TablesView />;
      case "pages":
        return <PagesView />;
      case "status-templates":
        return <StatusTemplatesView />;
      case "admin":
        return <AdminView />;
      case "dev-settings":
        return <DevSettingsView />;
      case "search":
        return <SearchView initialQuery={r.query} onOpenTask={openTask} />;
      case "tag":
        return <TagView tagId={r.id} onOpenTask={openTask} />;
      case "project":
        return (
          <ProjectView
            projectId={r.id}
            view={r.view}
            taskId={r.taskId}
            onOpenTask={openTask}
            onOpenInvite={() => setModal("invite")}
            onOpenRules={() => setModal("rules")}
            onOpenFields={() => setModal("fields")}
          />
        );
      case "task": {
        const task = state.tasks.find((t) => t.id === r.id);
        if (task?.projectId) {
          return (
            <ProjectView
              projectId={task.projectId}
              view="list"
              taskId={r.id}
              onOpenTask={openTask}
              onOpenInvite={() => setModal("invite")}
              onOpenRules={() => setModal("rules")}
              onOpenFields={() => setModal("fields")}
            />
          );
        }
        return <HomeView onOpenTask={openTask} onCreateProject={() => setModal("project")} onCreateTask={openCreateTask} />;
      }
      default:
        return null;
    }
  };

  const currentProjectId =
    route.kind === "project"
      ? route.id
      : paneTaskId
        ? state.tasks.find((t) => t.id === paneTaskId)?.projectId ?? undefined
        : undefined;

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {impersonator && (
        <div className="impersonation-bar">
          <Icon name="eye" size={14} />
          <span>
            Viewing the workspace as <b>{user.name}</b> ·{" "}
            {user.workspaceRole ?? "member"} role
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              dispatch({ type: "impersonate", userId: impersonator.id });
              toast("Back to your own account");
            }}
          >
            Return to {impersonator.name.split(" ")[0]}
          </button>
        </div>
      )}
      <TopBar
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenAI={() => setAiOpen(true)}
        onCreate={(kind) => {
          if (kind === "task") setModal("task");
          else if (kind === "project") setModal("project");
          else if (kind === "goal") setModal("goal");
          else setModal("portfolio");
        }}
        onOpenInvite={() => setModal("invite")}
        onOpenShortcuts={() => setModal("shortcuts")}
      />
      <div className="app-body">
        <Sidebar
          route={route}
          onCreateProject={() => setModal("project")}
          onOpenInvite={() => setModal("invite")}
        />
        <main className="content" id="main-content">
          <Suspense fallback={<RouteFallback />}>{renderRoute(route)}</Suspense>
        </main>
        <Suspense fallback={null}>
        {paneTaskId && (
          <TaskPane
            taskId={paneTaskId}
            onClose={closePane}
            onOpenTask={openTask}
          />
        )}
        {aiOpen && !paneTaskId && (
          <AskAIDrawer onClose={() => setAiOpen(false)} onOpenTask={openTask} />
        )}
        </Suspense>
      </div>
      <Suspense fallback={null}>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onOpenTask={openTask}
          onCreateTask={() => setModal("task")}
          onCreateProject={() => setModal("project")}
          onShortcuts={() => setModal("shortcuts")}
          onFields={() => setModal("fields")}
          onRules={() => setModal("rules")}
          projectId={currentProjectId}
        />
      )}

      {modal === "project" && <CreateProjectModal onClose={() => setModal(null)} />}
      {modal === "task" && (
        <CreateTaskModal onClose={() => setModal(null)} onCreated={openTask} />
      )}
      {modal === "invite" && <InviteModal onClose={() => setModal(null)} />}
      {modal === "fields" && <FieldLibraryModal onClose={() => setModal(null)} />}
      {modal === "rules" && (rulesProject ?? currentProjectId) && (
        <RuleBuilderModal
          projectId={(rulesProject ?? currentProjectId) as ID}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "rules" && !rulesProject && !currentProjectId && state.projects[0] && (
        <RuleBuilderModal projectId={state.projects[0].id} onClose={() => setModal(null)} />
      )}
      {modal === "agent" && <CreateAgentModal onClose={() => setModal(null)} />}
      {modal === "shortcuts" && <ShortcutsModal onClose={() => setModal(null)} />}
      {modal === "goal" && <CreateGoalModal onClose={() => setModal(null)} />}
      {modal === "portfolio" && (
        <SimpleNameModal
          title="Create portfolio"
          icon="briefcase"
          placeholder="Portfolio name"
          submitLabel="Create portfolio"
          onSubmit={(name) => {
            dispatch({ type: "portfolio/create", name });
            toast("Portfolio created");
          }}
          onClose={() => setModal(null)}
        />
      )}

      </Suspense>
      {mode === "local" && <AgentRunner />}
      <Toasts />
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="route-fallback" aria-busy="true" aria-label="Loading">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line short" />
    </div>
  );
}

/** Who sees what before the workspace: sign-in, 2FA enrollment, invites, public forms. */
function Gate() {
  const { mode } = useApp();
  const route = useRoute();
  if (route.kind === "public-form") return <PublicFormView formId={route.formId} />;
  if (route.kind === "join" && mode !== "local" && mode !== "detecting") return <JoinScreen inviteId={route.inviteId} />;
  if (mode === "detecting") return <Splash />;
  if (mode === "login") return <LoginScreen />;
  if (mode === "enroll") return <EnrollScreen />;
  return <Shell />;
}

export default function App() {
  useEffect(() => prefetchViews(), []);
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  );
}
