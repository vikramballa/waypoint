import { useEffect, useState } from "react";
import type { ViewKey } from "./types";

export type Route =
  | { kind: "home" }
  | { kind: "my-tasks" }
  | { kind: "inbox" }
  | { kind: "goals" }
  | { kind: "portfolios" }
  | { kind: "reporting" }
  | { kind: "search"; query: string }
  | { kind: "tag"; id: string }
  | { kind: "ai-teammates" }
  | { kind: "ai-teammate"; id: string }
  | { kind: "chat" }
  | { kind: "meetings" }
  | { kind: "workload" }
  | { kind: "automations" }
  | { kind: "templates" }
  | { kind: "forms" }
  | { kind: "dev" }
  | { kind: "service" }
  | { kind: "agency" }
  | { kind: "tables" }
  | { kind: "pages" }
  | { kind: "status-templates" }
  | { kind: "admin" }
  | { kind: "project"; id: string; view: ViewKey; taskId?: string }
  | { kind: "task"; id: string }
  | { kind: "dev-settings" }
  /* reachable without signing in */
  | { kind: "join"; inviteId: string }
  | { kind: "public-form"; formId: string };

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = clean.split("?");
  const params = new URLSearchParams(queryPart ?? "");
  const segments = pathPart.split("/").filter(Boolean);
  if (segments.length === 0) return { kind: "home" };
  const [head, second, third] = segments;
  switch (head) {
    case "my-tasks":
      return { kind: "my-tasks" };
    case "inbox":
      return { kind: "inbox" };
    case "goals":
      return { kind: "goals" };
    case "portfolios":
      return { kind: "portfolios" };
    case "reporting":
      return { kind: "reporting" };
    case "ai-teammates":
      return { kind: "ai-teammates" };
    case "ai-teammate":
      return { kind: "ai-teammate", id: second ?? "" };
    case "chat":
      return { kind: "chat" };
    case "meetings":
      return { kind: "meetings" };
    case "workload":
      return { kind: "workload" };
    case "rules":
      return { kind: "automations" };
    case "project-templates":
      return { kind: "templates" };
    case "forms":
      return { kind: "forms" };
    case "dev":
      return second === "settings" ? { kind: "dev-settings" } : { kind: "dev" };
    case "join":
      return { kind: "join", inviteId: second ?? "" };
    case "f":
      return { kind: "public-form", formId: second ?? "" };
    case "service":
      return { kind: "service" };
    case "agency":
      return { kind: "agency" };
    case "tables":
      return { kind: "tables" };
    case "pages":
      return { kind: "pages" };
    case "status-templates":
      return { kind: "status-templates" };
    case "admin":
      return { kind: "admin" };
    case "search":
      return { kind: "search", query: params.get("q") ?? "" };
    case "tag":
      return { kind: "tag", id: second ?? "" };
    case "project": {
      const view = (["overview", "list", "board", "timeline", "calendar", "dashboard", "files", "messages", "form"].includes(
        third ?? ""
      )
        ? third
        : "list") as ViewKey;
      return {
        kind: "project",
        id: segments[1] ?? "",
        view,
        taskId: params.get("task") ?? undefined,
      };
    }
    case "task":
      return { kind: "task", id: second ?? "" };
    default:
      return { kind: "home" };
  }
}

export function navigate(path: string) {
  const target = path.startsWith("#") ? path : `#${path}`;
  if (window.location.hash === target) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = target;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function routeToProject(
  projectId: string,
  view: ViewKey,
  taskId?: string
): string {
  return `/project/${projectId}/${view}${taskId ? `?task=${taskId}` : ""}`;
}

export function projectPath(projectId: string, view: ViewKey = "list"): string {
  return `#${routeToProject(projectId, view)}`;
}
