export type ID = string;

export type SwatchName =
  | "none"
  | "aqua"
  | "blue"
  | "blue-green"
  | "cool-gray"
  | "green"
  | "hot-pink"
  | "indigo"
  | "magenta"
  | "orange"
  | "pink"
  | "purple"
  | "red"
  | "yellow"
  | "yellow-green"
  | "yellow-orange";

export type WorkspaceRole = "owner" | "admin" | "member" | "guest";
export type ProjectRole = "owner" | "editor" | "commenter" | "viewer";

export interface User {
  id: ID;
  workspaceRole?: WorkspaceRole;
  name: string;
  email: string;
  initials: string;
  color: SwatchName;
  role: string;
  teamIds: ID[];
  guest?: boolean;

  /* --- AI teammate fields (route table: /ai-teammate, /ai-teammates) --- */
  isAgent?: boolean;
  agentStatus?: "active" | "paused" | "draft";
  instructions?: string;
  skillIds?: ID[];
  projectIds?: ID[];
  authScopes?: string[];
  runCount?: number;
  modelLabel?: string;
  /** Weekly working hours for workload planning (default 40). */
  capacityHours?: number;
  /** Agent: finished runs wait for a human to approve or revert. */
  requireReview?: boolean;
  /** Agent: max runs per calendar month (0/undefined = unlimited). */
  runBudget?: number;
  usage?: { month: string; runs: number };
}

/* ------------------------------------------------------------ AI features */
export type SkillCategory =
  | "planning"
  | "writing"
  | "triage"
  | "reporting"
  | "analysis";

export interface AgentSkill {
  id: ID;
  name: string;
  description: string;
  category: SkillCategory;
  icon: string;
  example: string;
}

export type AgentStepKind =
  | "ack"
  | "plan"
  | "subtask"
  | "comment"
  | "field"
  | "complete"
  | "status"
  | "done";

export interface AgentRunStep {
  id: ID;
  kind: AgentStepKind;
  label: string;
  detail?: string;
  at?: string;
}

export interface AgentRun {
  id: ID;
  teammateId: ID;
  taskId: ID | null;
  projectId: ID | null;
  kind: "task" | "status" | "triage" | "summary";
  status: "queued" | "running" | "review" | "done" | "cancelled" | "reverted";
  /** What the run changed, so a human can review or revert it. */
  changes?: AgentChange[];
  /** Why the run paused before starting (prompt-injection screening). */
  flagged?: string;
  startedAt: string;
  finishedAt: string | null;
  steps: AgentRunStep[];
  cursor: number;
}

export interface Citation {
  kind: "task" | "project" | "goal" | "user" | "rule" | "meeting";
  id: ID;
  label: string;
}

export interface ChatAction {
  id: string;
  label: string;
  kind: "create-task" | "create-project" | "open-project" | "open-task" | "draft-status" | "complete-task";
  projectId?: ID;
  taskId?: ID;
  text?: string;
  dueDate?: string;
}

export interface ChatMessage {
  id: ID;
  threadId: ID;
  role: "user" | "ai";
  text: string;
  createdAt: string;
  citations: Citation[];
  actions: ChatAction[];
}

export interface ChatThread {
  id: ID;
  /** Chats are private to whoever started them (legacy threads: workspace owner). */
  ownerId?: ID;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptLine {
  id: ID;
  speakerId: ID;
  at: string;
  text: string;
}

export interface MeetingActionItem {
  id: ID;
  text: string;
  assigneeId: ID | null;
  projectId: ID | null;
  created: boolean;
}

export interface Meeting {
  id: ID;
  title: string;
  startedAt: string;
  durationMin: number;
  attendeeIds: ID[];
  projectId: ID | null;
  summary: string;
  transcript: TranscriptLine[];
  actionItems: MeetingActionItem[];
  source: "recall" | "manual";
}

export type FormFieldType = "text" | "textarea" | "select" | "date" | "people" | "checkbox";

export interface FormField {
  id: ID;
  label: string;
  type: FormFieldType;
  options?: string[];
  required?: boolean;
  mapsTo: "name" | "notes" | "dueDate" | "assigneeId" | "priority" | "custom";
  fieldId?: ID;
}

export interface ProjectForm {
  id: ID;
  projectId: ID;
  title: string;
  description: string;
  fields: FormField[];
  submissions: number;
  /** Accept anonymous submissions through the public link. */
  public?: boolean;
}

export interface ProjectTemplate {
  id: ID;
  name: string;
  description: string;
  icon: string;
  color: SwatchName;
  teamId: ID;
  sections: { name: string; tasks: { name: string; offsetDays?: number; milestone?: boolean; priority?: Priority }[] }[];
}

export interface Team {
  id: ID;
  name: string;
  description: string;
  color: SwatchName;
  memberIds: ID[];
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "changes-requested";

export interface Project {
  id: ID;
  name: string;
  teamId: ID;
  color: SwatchName;
  icon: string;
  description: string;
  ownerId: ID;
  memberIds: ID[];
  /** per-member project role; missing members fall back to the project privacy */
  roles?: Record<ID, ProjectRole>;
  privacy: "public" | "private";
  starred: boolean;
  archived: boolean;
  dueDate: string | null;
  createdAt: string;
  defaultView: ViewKey;
  status: ProjectStatus;
  statusUpdates: StatusUpdate[];
  fieldIds: ID[];
  /** Push dependent tasks later when a blocker's due date moves past their start. */
  autoShiftDates?: boolean;
  /** "push": only push later when needed; "buffer": keep gaps, move both ways. */
  autoShiftMode?: "push" | "buffer";
}

export interface ProjectStatus {
  state: "on-track" | "at-risk" | "off-track" | "on-hold" | "none";
  text: string;
}

export interface StatusUpdate {
  id: ID;
  projectId: ID;
  authorId: ID;
  createdAt: string;
  state: ProjectStatus["state"];
  title: string;
  text: string;
}

export type ViewKey =
  | "overview"
  | "list"
  | "board"
  | "timeline"
  | "calendar"
  | "dashboard"
  | "files"
  | "messages"
  | "form";

export interface Section {
  id: ID;
  projectId: ID;
  name: string;
  order: number;
  collapsed: boolean;
  color?: SwatchName;
}

export type Priority = "low" | "medium" | "high";

export interface Attachment {
  id: ID;
  name: string;
  kind: "image" | "file" | "link" | "figma";
  meta: string;
  addedById: ID;
  createdAt: string;
  /** Stored upload (server mode). */
  fileId?: string;
  size?: number;
  mime?: string;
}

export interface Task {
  id: ID;
  name: string;
  notes: string;
  completed: boolean;
  completedAt: string | null;
  assigneeId: ID | null;
  creatorId: ID;
  projectId: ID | null;
  sectionId: ID | null;
  parentId: ID | null;
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  order: number;
  priority: Priority | null;
  tagIds: ID[];
  followerIds: ID[];
  customFields: Record<ID, FieldValue>;
  blockedByIds: ID[];
  blockingIds: ID[];
  attachments: Attachment[];
  /** Present on approval tasks; aggregated from `approvals`. */
  approvalStatus?: ApprovalStatus;
  /** Approvers (defaults to the assignee). */
  approverIds?: ID[];
  /** How many approvals are needed (default: all approvers). */
  approvalsRequired?: number;
  approvals?: ApprovalVote[];
  recurrence?: Recurrence;
  /** Planned effort in hours (falls back to effort points × 4). */
  estimateHours?: number;
  likeUserIds: ID[];
  createdAt: string;
  modifiedAt: string;
  coverGradient?: string;
  milestone?: boolean;
}

export type FieldValue = string | number | boolean | string[] | null;

export type FieldType =
  | "text"
  | "number"
  | "select"
  | "multiSelect"
  | "date"
  | "people"
  | "checkbox"
  | "rating";

export interface FieldOption {
  id: ID;
  name: string;
  color: SwatchName;
}

export interface FieldDef {
  id: ID;
  name: string;
  type: FieldType;
  options: FieldOption[];
  precision?: number;
  createdBy: ID;
}

export interface Comment {
  id: ID;
  taskId: ID;
  authorId: ID;
  text: string;
  createdAt: string;
  likeUserIds: ID[];
  edited?: boolean;
}

export type ActivityType =
  | "created"
  | "completed"
  | "uncompleted"
  | "assigned"
  | "unassigned"
  | "due-date"
  | "section"
  | "comment"
  | "like"
  | "attachment"
  | "field"
  | "tag"
  | "dependency"
  | "priority"
  | "description"
  | "moved-project"
  | "duplicated"
  | "rule"
  | "approval";

export interface Activity {
  id: ID;
  taskId: ID;
  actorId: ID;
  type: ActivityType;
  createdAt: string;
  detail?: string;
  from?: string;
  to?: string;
}

export interface Tag {
  id: ID;
  name: string;
  color: SwatchName;
}

export type GoalStatus = "on-track" | "at-risk" | "off-track" | "achieved" | "dropped";

export interface Goal {
  id: ID;
  name: string;
  description: string;
  ownerId: ID;
  teamId: ID;
  parentId: ID | null;
  metric: string;
  startValue: number;
  targetValue: number;
  currentValue: number;
  unit: string;
  dueDate: string | null;
  status: GoalStatus;
  projectIds: ID[];
  createdAt: string;
  /** "projects" = progress and status computed from linked projects. */
  progressSource?: "manual" | "projects";
}

export interface Portfolio {
  id: ID;
  name: string;
  ownerId: ID;
  memberIds: ID[];
  color: SwatchName;
  projectIds: ID[];
  createdAt: string;
  view?: "list" | "board" | "timeline";
  /** extra columns in list view */
  columns?: PortfolioColumn[];
}

export type PortfolioColumn = "status" | "progress" | "owner" | "due" | "risk" | "tasks" | "overdue";

export type RuleTriggerType =
  | "task-added"
  | "task-moved-section"
  | "task-completed"
  | "assignee-changed"
  | "due-date-set"
  | "field-changed"
  | "priority-changed"
  | "schedule";

export type RuleActionType =
  | "assign"
  | "set-due"
  | "set-priority"
  | "move-section"
  | "add-tag"
  | "add-comment"
  | "complete"
  | "add-follower"
  | "set-field"
  | "ai-comment";

export interface RuleAction {
  id: ID;
  type: RuleActionType;
  value: string;
  fieldId?: ID;
}

export interface Rule {
  id: ID;
  projectId: ID;
  name: string;
  enabled: boolean;
  trigger: { type: RuleTriggerType; value: string };
  actions: RuleAction[];
  runCount: number;
  createdBy: ID;
  /** All must hold for the rule to act on a task. */
  conditions?: RuleCondition[];
  /** For `schedule` triggers. */
  schedule?: RuleSchedule;
  lastRunAt?: string | null;
}

export type RuleConditionField = "priority" | "assignee" | "section" | "tag" | "due" | "completed";
export interface RuleCondition {
  id: ID;
  field: RuleConditionField;
  op: "is" | "is-not" | "is-empty" | "is-set" | "overdue" | "within-days";
  value?: string;
}
export interface RuleSchedule {
  every: "day" | "weekday" | "week";
  /** HH:MM, local time */
  at: string;
  /** 0 = Sunday, for weekly schedules */
  dayOfWeek?: number;
}

export interface Notification {
  id: ID;
  type:
    | "assigned"
    | "comment"
    | "mention"
    | "completed"
    | "like"
    | "due-soon"
    | "added-to-project"
    | "dependency";
  taskId: ID;
  actorId: ID;
  createdAt: string;
  read: boolean;
  text: string;
  /** Who should see it; legacy notifications belong to the seed owner. */
  recipientId?: ID;
}

export interface UIState {
  theme: "light" | "dark";
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  compact: boolean;
  showCompleted: boolean;
  sortBy: string;
  sortDir: "asc" | "desc";
}

export interface AuditEntry {
  id: ID;
  at: string;
  /** Identity the action ran as. */
  actorId: ID;
  /** The admin behind a "View as" session, when different from actorId. */
  viaId: ID | null;
  action: string;
  outcome: "allowed" | "denied";
  detail: string;
}

export interface AppState {
  version: number;
  users: User[];
  teams: Team[];
  projects: Project[];
  sections: Section[];
  tasks: Task[];
  tags: Tag[];
  fields: FieldDef[];
  comments: Comment[];
  activities: Activity[];
  goals: Goal[];
  portfolios: Portfolio[];
  rules: Rule[];
  notifications: Notification[];
  statusUpdates: StatusUpdate[];
  skills: AgentSkill[];
  agentRuns: AgentRun[];
  chatThreads: ChatThread[];
  chatMessages: ChatMessage[];
  meetings: Meeting[];
  forms: ProjectForm[];
  templates: ProjectTemplate[];
  activeThreadId: ID | null;
  devSpaces: DevSpace[];
  tickets: Ticket[];
  agentSessions: AgentSession[];
  releases: Release[];
  serviceQueues: ServiceQueue[];
  serviceTickets: ServiceTicket[];
  kbArticles: KbArticle[];
  clients: Client[];
  contacts: ClientContact[];
  portals: ClientPortal[];
  tables: RecordTable[];
  pages: DocPage[];
  statusTemplates: StatusTemplate[];
  savedViews: SavedView[];
  invites: WorkspaceInvite[];
  messages: ProjectMessage[];
  taskTemplates: TaskTemplate[];
  clientNotes: ClientNote[];
  security: SecurityPolicy;
  currentUserId: ID;
  /** Security-relevant events, newest first. Visible to workspace admins only. */
  auditLog: AuditEntry[];
  /** Set while an admin uses "View as"; the real actor behind currentUserId. */
  impersonatorId?: ID | null;
  /** "View as" ends automatically at this time. */
  impersonationExpiresAt?: string | null;
  impersonationReason?: string | null;
  ui: UIState;
  recentlyViewed: { type: "project" | "task"; id: ID }[];
}

/* ============================================================ dev product */
export interface DevSpace {
  id: ID;
  name: string;
  key: string;
  description: string;
  color: SwatchName;
  memberIds: ID[];
  settings?: DevSettings;
}

export interface DevSettings {
  /** e.g. "{key}-{number}-{slug}" */
  branchTemplate: string;
  /** Mark a release "in-progress" → ready when all its tickets are done. */
  autoReadyRelease: boolean;
  /** Generate release notes from done tickets. */
  releaseNotes: boolean;
  /** Move a ticket to review when an agent session finishes. */
  sessionToReview: boolean;
}

export type TicketStatus = "backlog" | "todo" | "in-progress" | "review" | "done";

export interface Ticket {
  id: ID;
  spaceId: ID;
  key: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: Priority | null;
  assigneeId: ID | null;
  reporterId: ID;
  storyPoints: number | null;
  sprint: string;
  labelIds: ID[];
  linkedTaskId: ID | null;
  agentSessionIds: ID[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentSessionStep {
  id: ID;
  at: string;
  label: string;
  detail?: string;
}

export interface AgentSession {
  id: ID;
  teammateId: ID;
  ticketId: ID | null;
  taskId: ID | null;
  title: string;
  prompt: string;
  status: "running" | "waiting" | "done" | "failed";
  startedAt: string;
  durationSec: number;
  tokens: number;
  steps: AgentSessionStep[];
  artifacts: { name: string; kind: "branch" | "diff" | "doc" | "test" }[];
}

export interface Release {
  id: ID;
  spaceId: ID;
  name: string;
  version: string;
  status: "planned" | "in-progress" | "ready" | "shipped";
  date: string;
  ticketIds: ID[];
  notes?: string;
}

/* ========================================================= service product */
export interface ServiceQueue {
  id: ID;
  name: string;
  projectId: ID;
  slaHours: number;
  memberIds: ID[];
  description: string;
}

export interface ServiceTicket {
  id: ID;
  queueId: ID;
  key: string;
  title: string;
  body: string;
  status: "new" | "triage" | "waiting" | "resolved" | "closed";
  priority: Priority | null;
  requesterId: ID;
  assigneeId: ID | null;
  slaDueAt: string;
  createdAt: string;
}

export interface KbArticle {
  id: ID;
  title: string;
  body: string;
  tags: string[];
  views: number;
  updatedAt: string;
}

/* ========================================================== agency product */
export interface Client {
  id: ID;
  name: string;
  industry: string;
  health: "healthy" | "watch" | "at-risk";
  arr: number;
  since: string;
  contactIds: ID[];
  stage?: ClientStage;
  ownerId?: ID;
}

export type ClientStage = "lead" | "proposal" | "active" | "renewal" | "churned";

export interface ClientNote {
  id: ID;
  clientId: ID;
  authorId: ID;
  kind: "note" | "call" | "email" | "meeting";
  text: string;
  createdAt: string;
}

export interface ProjectMessage {
  id: ID;
  projectId: ID;
  authorId: ID;
  text: string;
  createdAt: string;
}

export interface TaskTemplate {
  id: ID;
  projectId: ID;
  name: string;
  taskName: string;
  notes: string;
  subtasks: string[];
  priority: Priority | null;
  tagIds: ID[];
  createdBy: ID;
}

export interface Recurrence {
  every: "day" | "weekday" | "week" | "month";
  interval: number;
}

export interface ApprovalVote {
  userId: ID;
  decision: Exclude<ApprovalStatus, "pending">;
  note?: string;
  at: string;
}

export interface AgentChange {
  kind: "subtask" | "comment" | "field" | "complete";
  taskId: ID;
  /** created record id (subtask / comment) or field id */
  refId: ID;
  summary: string;
  /** previous value for field changes */
  before?: unknown;
}

export interface SecurityPolicy {
  /** Idle session lifetime (server mode). */
  sessionHours: number;
  requireTwoFactor: boolean;
  /** Invite allowlist; empty = any domain. */
  inviteDomains: string[];
  /** "View as" sessions end automatically after this many minutes. */
  impersonationMinutes: number;
}

export interface ClientContact {
  id: ID;
  clientId: ID;
  name: string;
  email: string;
  title: string;
  primary: boolean;
}

export interface ClientPortal {
  id: ID;
  clientId: ID;
  name: string;
  projectIds: ID[];
  status: "draft" | "live";
  lastPublishedAt: string;
}

/* ======================================================== tables & pages */
export type RecordFieldType = "text" | "number" | "select" | "date" | "people" | "currency";

export interface RecordTable {
  id: ID;
  name: string;
  description: string;
  icon: string;
  color: SwatchName;
  ownerId: ID;
  fields: { id: ID; name: string; type: RecordFieldType; options?: string[] }[];
  records: { id: ID; values: Record<string, string> }[];
  updatedAt: string;
  views?: TableView[];
}

export interface TableView {
  id: ID;
  name: string;
  /** field id → substring / option the record must match */
  filters: Record<string, string>;
  sortField: ID | null;
  sortDir: "asc" | "desc";
  hiddenFieldIds: ID[];
  groupBy: ID | null;
}

export interface DocPage {
  id: ID;
  title: string;
  body: string;
  authorId: ID;
  collaboratorIds: ID[];
  projectId: ID | null;
  createdAt: string;
  updatedAt: string;
  starred: boolean;
  /** Parent page for nested docs. */
  parentId?: ID | null;
  order?: number;
}

export interface StatusTemplate {
  id: ID;
  name: string;
  state: "on-track" | "at-risk" | "off-track" | "on-hold";
  title: string;
  body: string;
}

/* ======================================================= saved views / ACL */
export interface SavedView {
  id: ID;
  projectId: ID;
  name: string;
  view: "list" | "board" | "timeline" | "calendar";
  filters: Record<string, unknown>;
  sortKey: string;
  sortDir: "asc" | "desc";
  createdBy: ID;
}

export interface WorkspaceInvite {
  id: ID;
  email: string;
  role: WorkspaceRole;
  projectIds: ID[];
  status: "sent" | "accepted" | "revoked";
  invitedById: ID;
  createdAt: string;
}
