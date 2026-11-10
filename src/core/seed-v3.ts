/**
 * Seed data for the v3 surfaces: project messages, task templates, CRM notes,
 * the workspace security policy and defaults layered onto existing records.
 */
import type {
  ClientNote,
  ClientStage,
  DevSettings,
  ProjectMessage,
  SecurityPolicy,
  TaskTemplate,
} from "./types";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

export const SEED_MESSAGES: ProjectMessage[] = [
  {
    id: "msg-atlas-1",
    projectId: "p-atlas",
    authorId: "u-maya",
    text: "GA is locked for Dec 4. Launch checklist is the critical path — flag anything that threatens it here.",
    createdAt: hoursAgo(30),
  },
  {
    id: "msg-atlas-2",
    projectId: "p-atlas",
    authorId: "u-daniel",
    text: "Cycle detection landed behind a flag. Load test is next; I'll post numbers tomorrow.",
    createdAt: hoursAgo(6),
  },
  {
    id: "msg-web-1",
    projectId: "p-website",
    authorId: "u-priya",
    text: "New nav is in review. Please leave comments on the design task, not in DMs.",
    createdAt: hoursAgo(20),
  },
];

export const SEED_TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "ttpl-bug",
    projectId: "p-atlas",
    name: "Bug report",
    taskName: "Bug: ",
    notes: "Steps to reproduce:\n1.\n\nExpected:\n\nActual:\n",
    subtasks: ["Reproduce", "Write failing test", "Fix and verify"],
    priority: "high",
    tagIds: [],
    createdBy: "u-maya",
  },
  {
    id: "ttpl-launch",
    projectId: "p-atlas",
    name: "Launch readiness check",
    taskName: "Launch readiness: ",
    notes: "Owner signs off once every subtask is complete.",
    subtasks: ["Docs updated", "Support briefed", "Rollback plan rehearsed"],
    priority: "medium",
    tagIds: [],
    createdBy: "u-maya",
  },
];

export const SEED_CLIENT_NOTES: ClientNote[] = [
  { id: "cn-1", clientId: "client-1", authorId: "u-jordan", kind: "call", text: "QBR went well; they want SSO for the store managers before renewal.", createdAt: hoursAgo(50) },
  { id: "cn-2", clientId: "client-2", authorId: "u-sofia", kind: "email", text: "Asked for a revised onboarding timeline — waiting on their IT review.", createdAt: hoursAgo(28) },
  { id: "cn-3", clientId: "client-3", authorId: "u-sofia", kind: "meeting", text: "Usage dropped 30% since October. Champion left; need a new sponsor.", createdAt: hoursAgo(8) },
];

export const CLIENT_STAGES: Record<string, ClientStage> = {
  "client-1": "renewal",
  "client-2": "active",
  "client-3": "active",
};

export const DEFAULT_DEV_SETTINGS: DevSettings = {
  branchTemplate: "{key}-{number}-{slug}",
  autoReadyRelease: true,
  releaseNotes: true,
  sessionToReview: true,
};

export const DEFAULT_SECURITY: SecurityPolicy = {
  sessionHours: 12,
  requireTwoFactor: false,
  inviteDomains: [],
  impersonationMinutes: 30,
};
