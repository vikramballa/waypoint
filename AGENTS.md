# Memory — Waypoint

Durable context for anyone (human or agent) picking this repo up. Read this
first, then `README.md` for the feature tour.

## What this is

**Waypoint** — brand in `src/core/brand.ts`, mark `WaypointLogo`, `public/icon.svg`.

Two runtimes, one codebase:
- **server mode** (`npm run server` + `npm run dev`, or `npm start`): Node server in
  `server/` is authoritative — accounts, sessions, SQLite, live SSE sync.
- **local mode** (no server reachable): everything in this browser, like before.
  `/api/session` returning `{mode:"local"}` (Vite proxy fallback) selects it.

- Seeded workspace: Northwind · demo password `waypoint-demo` · owner `maya.chen@northwind.co`

## Commands

- `npm run dev` — UI on 127.0.0.1:5175 (proxies `/api` → :5180, local mode if absent).
- `npm run server` — API on :5180, data in `./data` (`DATA_DIR`), secret in `data/secret.key`.
- `npm start` — build + serve `dist/` and API from one origin (:5180).
- `node scripts/e2e.mjs` — 66 browser checks, **local mode** (API server must be stopped).
- `npm run e2e:server` — 26 checks, server mode, against a fresh temp DB (build first:
  `npm run build && npm run -s build:server`).
- `npm run check:csp` — production build via `npm run preview` (:5176), 24 routes.

**Always finish with**: `npm run typecheck && npm test && npm run build`, then both e2e
suites if UI changed. Expected: 0 errors, 118/118, 66/66, 26/26, no console errors.

## Architecture

No UI library. React 18 + Vite + TS only; charts and icons are inline SVG. Server:
Node built-ins only (`http`, `crypto`, `node:sqlite` loaded via `createRequire`).
`src/core/reducer.ts` is pure (no React) and is bundled into the server by esbuild —
**anything the reducer imports must stay DOM/React-free**.
Every route view, the task pane, palette and modals are `lazyNamed()` chunks
(`src/ui/lazy.ts`), prefetched on idle; React is a separate vendor chunk.

## State model & persistence

- Shared engine: `reducer(state, action)` = `normalizeAction` → `authorize` (default-deny)
  → `apply` → `recordAudit` → `enforceLimits`. Server and browser run the same code.
- **Server mode**: `store.tsx` keeps `base` (server-confirmed, already scoped) + `pending`
  actions; display = pending replayed over base. Each action carries an `idSeed`
  (`withIdSeed`) so optimistic ids == server ids. Acks and patches arrive over SSE
  (`history.ts` `diffPatch`/`applyPatch`; count mismatch ⇒ reconnect for a snapshot).
  `ui`, `recentlyViewed`, `activeThreadId` are per-browser (`waypoint-prefs`).
- **SQLite** (`server/db.ts`): `records(collection,id,seq,json)`; `seq` is a fractional
  order key so array order (newest-first feeds) survives restarts. Writes are the
  record diff of each action in one transaction. Auth/files are separate tables.
- **Local mode**: `localStorage["waypoint-v1-state"]`,
  debounced + flushed on `pagehide`, cross-tab via `storage` events, snapshot undo.
- `hydrate()` fills missing collections from the seed then `sanitizeState()` repairs
  untrusted data. New collections: add to `types.ts` + seed (`seed-v3.ts`).
- Undo in server mode is **record-level** and refuses (409) if anyone changed the
  record since; per session, cleared on "View as".

## RBAC (do not bypass)

Two axes, both enforced in `reducer` via `authorize()` **and** mirrored in UI with
`can(permission, projectId?)` from `useApp()`. `authorize()` is **default-deny**:
an action type missing from its switch is refused.

**Reads are scoped too.** `useApp().state` is `scopeStateForViewer(state)`:
members/guests only receive readable projects and the tasks, comments,
activity, rules, forms, runs etc. hanging off them (subtasks inherit their
parent; assignees always see their own tasks). Guests also get no dev/ops data.
AI chat threads are private to `ownerId` for everyone. Owners/admins get the
same project/task references (no copying). The reducer works on full state;
`chat/send` answers from the caller's scoped state.

- Workspace: `owner > admin > member > guest`. Guests cannot create projects,
  invite, administer, or read projects they are not invited to.
- Project: `owner > editor > commenter > viewer`.
- Resolution order (`effectiveProjectRole`): workspace owner/admin ⇒ `owner`;
  agent ⇒ explicit role or editor-if-member; explicit role wins next; guest ⇒
  invited-only (viewer); private ⇒ membership only; public ⇒ member = editor.
- Adding a mutating action? Add it to `authorize()` (resolve the project from the
  stored entity, check **every** id in bulk actions, require `task:create` on a
  destination project), then hide/disable the affordance with `can()`.
- Owner role: only owners grant/revoke `owner`; nobody edits their own role.
- Impersonation: `dispatch({ type: "impersonate", userId })` — only the real
  actor (`impersonatorId ?? currentUserId`) with `workspace:admin` may do it;
  `state.impersonatorId` drives the banner and "Return to …".

## Server security (server/app.ts)

- Identity only from the `wp_sid` cookie; actions re-authorized as that identity;
  `CLIENT_FORBIDDEN` (state replace/import, clocks, audit, UI-only) refused.
- CSRF: header `x-requested-with: waypoint` + Origin/Sec-Fetch-Site. Use `api()` from
  `useApp()` (adds the header) for every mutating fetch.
- Clocks run server-side (agent runs 2.2 s, sessions 2.6 s, rules 30 s, View-as expiry).
  The browser `AgentRunner` only runs in local mode.
- Public endpoints: `/api/login`, `/api/session`, `/api/invites/accept`,
  `/api/public/forms/:id` (people fields stripped), `/api/health`.

## Security hardening (client-side)

- **CSP** (production builds only — Vite HMR needs inline script): injected by the
  `security-policy` plugin in `vite.config.ts`; `script-src 'self'`, `style-src 'self'`,
  `font-src 'self'`. Fonts must never be inlined (`assetsInlineLimit` excludes woff2).
  React `style={…}` goes through the CSSOM so it is unaffected. `vite preview` also
  sends `frame-ancestors 'none'`, nosniff, no-referrer, Permissions-Policy, COOP.
- **Untrusted storage**: `hydrate()` → `sanitizeState()` (`core/validate.ts`) drops
  malformed/duplicate records, coerces unknown roles to `guest` / privacy to
  `private`, repairs dangling refs, caps strings at 50k. Runs for cross-tab data too.
- **Input limits**: `normalizeAction()` in the reducer trims/clamps text
  (`TEXT_LIMITS`), rejects empty names/comments and invalid invite emails.
- **Audit log** (`state.auditLog`, admin-only via scoping, survives undo): role and
  membership changes, privacy, deletions, approvals, invites, agent permission
  changes, "View as" (with the real actor in `viaId`) and every blocked dispatch
  (`audit/denied`). Add new sensitive actions to `AUDITED` + `describeAudit()`.
- None of this is a real boundary while state lives in the browser — the user owns
  `localStorage`. `authorize()` / `scopeStateForViewer()` are pure and meant to move
  to a server unchanged.

## Approvals & scheduling

- **Approval tasks**: `task.approvalStatus` (`pending|approved|rejected|changes-requested`).
  Editors convert via `task/update` (only `pending`/`undefined` allowed); only the
  assignee decides via `task/decide`, and commenter access suffices. Approval tasks
  cannot be ticked complete; reopening returns them to `pending`. Render completion
  with `<TaskCheckbox task>` (handles approvals + permissions) — never a raw `Checkbox`.
- **Scheduling** (`core/schedule.ts`): `analyzeSchedule()` = critical path on real dates
  (forecast dates, slack, conflicts where a dependent starts before its blocker is due).
  `project.autoShiftDates` makes `task/update` push dependents later via
  `dependentShifts()` — only tasks the actor can edit, never earlier, never completed ones.

## Agent runtime (AI teammates)

- Agents are `User` records with `isAgent: true` (skills, instructions,
  `projectIds`, `authScopes`, `agentStatus`).
- Assigning a task to an active agent (through `task/setAssignee`) creates an
  `AgentRun`; `ui/AgentRunner.tsx` advances it every 2.2 s:
  ack → plan (creates 3 subtasks) → dependency check → estimate → progress
  comment (completes its own subtasks) → done. Reassigning cancels the run.
- Dev **agent sessions** (`session/start|advance`) stream on the same timer
  (2.6 s) and attach artifacts on completion.
- Rules can post an `ai-comment` action; `core/ai.ts` supplies the text.
- Agents act under **their own** grants (`agentCan()` in `rbac.ts`): active status, the
  step's scope (`AGENT_STEP_SCOPE`, e.g. plan → `scope-create`) and the project in
  `agent.projectIds`. No access ⇒ a visible cancelled run; missing scope ⇒ the step is
  marked "Skipped"; paused ⇒ the run holds. Agents are not project members in the seed.

## AI engine

`src/core/ai.ts` is deterministic and grounded — **no network, no keys**. It
cites real ids only, dedupes citations, and parses natural language via
`parseTaskDraft` (project, assignee, due date incl. weekdays, priority, tags,
milestone). Every AI surface labels output as generated and asks for review.

## Design system v2

- `src/styles/tokens.css` is the single source of truth (light + dark pairs).
  **Never hardcode colours/sizes in components** — use `var(--color-*)`,
  `var(--text-*)`, `var(--radius-*)`, `var(--shadow-*)`, `var(--ease-*)`.
- Fonts: Plus Jakarta Sans (UI/display) + JetBrains Mono (figures), bundled via
  `@fontsource-variable` (offline-safe).
- Motion: `cubic-bezier(.32,.72,0,1)`, 140/220/420 ms; only transform/opacity;
  respect `prefers-reduced-motion`.
- Shapes: squircle avatars (34 % radius), 6–18 px surfaces, hairline borders,
  layered tinted shadows, uppercase micro-labels (`--tracking-caps`).
- Class vocabulary in `app.css` is load-bearing (`task-row`, `section-header`,
  `board-col`, `pane`, `popover`, `matrix`, `agent-card` …). Restyle tokens/CSS
  before renaming classes.

## Gotchas (learned the hard way)

1. `.col` is a flex-column **utility**; anything needing row direction inside
   `.list-head`, `.goal-row`, `.matrix-row` must set `flex-direction: row`.
2. `authorize()` needs a project id for project-scoped permissions — personal
   tasks (`projectId: null`) are intentionally allowed for non-guests.
3. Automations run on `task-added`, so a form submission can be re-assigned by
   a triage rule; test form mapping on a project without rules (`p-website`).
4. Popovers close on outside scroll but ignore scrolls inside themselves.
5. Timeline drag must commit from a ref, never inside a `setState` updater
   (React render-phase warning).
6. `store()`-style external caches are not used; all state is the reducer.
7. Seed runs in `seed-extra.ts` must not be left `running` unless a task is
   actually assigned to that agent, or the runner advances orphan runs.
8. E2E uses a fresh browser profile each launch, so it always starts from seed.
9. UI code reads the *scoped* state: never assume a project/task id from a URL
   exists in `state` — render a "not found or no access" state instead.
10. Restyling goes in `src/styles/refresh.css` (loaded after `app.css`) using
    tokens; the work surface is `--color-canvas` (white), chrome is
    `--color-canvas-tint`.
11. Production CSP blocks eval: Playwright's `waitForFunction` fails under it — poll
    with `page.evaluate` (see `until()` in `scripts/e2e-server.mjs`).
12. Record-level undo/patches rely on structural sharing — never mutate records in
    place, and keep unchanged records' identity in scoping (`rbac.ts` copies goals/
    portfolios only when their project list actually changes).

## Known gaps / next steps

- SSO (SAML/OIDC), Postgres + row-level security, real antivirus, email delivery.
- Native desktop shell (Electron) not built — the PWA covers install/offline/window.
- Single React context: every change re-renders consumers; scoping is ~2 ms at 10k
  tasks, so fine today. Next step if lists grow: selector subscriptions + memo rows.
