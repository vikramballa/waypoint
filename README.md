<p align="center">
  <img src="public/icon.svg" width="72" height="72" alt="Waypoint logo">
</p>

<h1 align="center">Waypoint</h1>

<p align="center">
  <strong>Plan the route. Ship the work.</strong><br>
  Work management with live collaboration, server-enforced access control,
  dependency-aware planning and AI teammates.
</p>

<p align="center">
  React 18 · TypeScript · Vite · Node.js · SQLite · zero UI libraries
</p>

---

![Waypoint home](shots/home.png)

## Contents

- [Overview](#overview)
- [Features](#features)
- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [Two run modes](#two-run-modes)
- [Configuration](#configuration)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [Roadmap](#roadmap)

## Overview

Waypoint is a full work-management app: projects, tasks, boards, timelines, goals,
portfolios, automations and AI agents that work alongside people. It runs as a real
multi-user server (accounts, sessions, SQLite, live sync) or entirely in the browser
for quick demos. The same code runs in both places.

What sets it apart:

- **One engine, two runtimes.** A single pure reducer handles authorization, changes
  and audit logging. It runs in the browser for instant optimistic updates and on the
  server as the authority.
- **Access control throughout.** Every action is re-authorized on the server, and each
  viewer only receives the data they're allowed to read, down to individual patches.
- **Planning that understands dependencies.** Critical path, slack, conflict
  detection and automatic rescheduling.
- **AI teammates with guardrails.** Agents act under their own scopes and budgets,
  screen for prompt injection, and every change they make can be reviewed and reverted.
  The AI engine is deterministic and runs offline, with no API keys.

## Features

| Area | Highlights |
|---|---|
| **Work** | List, board, timeline, calendar and dashboard views; subtasks, dependencies, custom fields, saved views, recurring tasks, task templates |
| **Planning** | Critical path, slack, dependency conflicts, cross-project dependencies, auto-reschedule (push later or keep gaps) |
| **Sign-off** | Approvals with one or many approvers (N of M), notes and full history |
| **Automation** | Triggers including schedules and conditions, chained rules with loop protection, 30-day dry run, loop warnings |
| **Insight** | Risk radar (explainable 0–100 slip risk), goals that update themselves, workload vs capacity with AI rebalancing, plain-English search |
| **AI teammates** | Agents that plan, comment and estimate under their own scopes, with monthly budgets, prompt-injection screening and one-click revert |
| **Collaboration** | Live updates, presence ("Priya is here"), project messages, uploads with signed links, public intake forms |
| **Ops surfaces** | Dev board with release automation, service desk, CRM pipeline with activity log, nested pages, tables with saved views, portfolios in list / board / timeline |
| **Admin** | Roles and permissions, invitations with a domain allowlist, audit log, sessions and revocation, security policy, backups (export / restore / reset) |
| **App** | Installable PWA (offline shell), light and dark themes, keyboard-first, accessible |

<table>
  <tr>
    <td><img src="shots/project-p-atlas-board.png" alt="Board view"></td>
    <td><img src="shots/project-p-atlas-timeline.png" alt="Timeline view"></td>
  </tr>
  <tr>
    <td align="center"><sub>Board</sub></td>
    <td align="center"><sub>Timeline with dependencies</sub></td>
  </tr>
  <tr>
    <td><img src="shots/v2-ai-teammates.png" alt="AI teammates"></td>
    <td><img src="shots/v2-dark-board.png" alt="Dark mode"></td>
  </tr>
  <tr>
    <td align="center"><sub>AI teammates</sub></td>
    <td align="center"><sub>Dark mode</sub></td>
  </tr>
</table>

## Quick start

**Requirements:** Node.js **22.5 or newer** (the server uses the built-in `node:sqlite`
module) and npm.

```bash
npm install
```

**Full app** (real accounts, live collaboration, data saved to SQLite):

```bash
npm run server        # API on http://127.0.0.1:5180, data in ./data
npm run dev           # UI on http://127.0.0.1:5175, proxies /api to the server
```

**Single production origin** (builds the UI and serves it from the server):

```bash
npm start             # http://127.0.0.1:5180
```

**Browser-only demo** (no server, no sign-in):

```bash
npm run dev           # without `npm run server`, the app falls back to local mode
```

## Demo accounts

The seeded workspace is **Northwind**. Every demo account uses the password
`waypoint-demo`.

| Email | Workspace role |
|---|---|
| `maya.chen@northwind.co` | Owner |
| `alex.rivera@northwind.co` | Admin |
| `priya.nair@northwind.co` | Member |
| `lucas@agency.partner` | Guest (sees invited projects only) |

Sign in as different people in separate browsers to watch live updates, presence and
permission scoping in action.

## Two run modes

| | **Server mode** | **Local mode** |
|---|---|---|
| Start with | `npm run server` + `npm run dev`, or `npm start` | `npm run dev` only |
| Sign-in | Real accounts, sessions, optional 2FA | None (acts as the seeded owner) |
| Data | SQLite in `./data/workspace.db` | `localStorage` in this browser |
| Sync | Live across users and devices (SSE) | Across tabs in the same browser |
| Undo | Record-level, refuses if someone else changed the record | Snapshot undo |
| Best for | Real use, multi-user testing | Demos, UI work |

The UI picks the mode automatically: if `/api/session` reports no server, it runs
locally.

## Configuration

The server reads these environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5180` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (use `0.0.0.0` to expose on your network) |
| `DATA_DIR` | `./data` | Folder for the SQLite database and signing key |
| `WAYPOINT_SECRET` | generated into `data/secret.key` | Key for signed download links and form tokens |
| `WAYPOINT_HTTPS` | off | Set to `1` behind HTTPS so session cookies are marked `Secure` |
| `WAYPOINT_DEMO_PASSWORD` | `waypoint-demo` | Password for the seeded demo accounts |
| `SERVE_STATIC` | off | Set to `1` to serve the built UI from `./dist` (`npm start` does this) |

To rename the product, change `src/core/brand.ts`.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| <kbd>⌘/Ctrl</kbd> <kbd>K</kbd> | Command palette |
| <kbd>Tab</kbd> then <kbd>Q</kbd> | Quick-add a task |
| <kbd>Tab</kbd> then <kbd>A</kbd> | Assign the open task to yourself |
| <kbd>Tab</kbd> then <kbd>N</kbd> | New section in the current project |
| <kbd>G</kbd> then <kbd>H</kbd> / <kbd>M</kbd> / <kbd>I</kbd> / <kbd>G</kbd> | Go to Home / My tasks / Inbox / Goals |
| <kbd>1</kbd>–<kbd>5</kbd> | Project view: list, board, timeline, calendar, dashboard |
| <kbd>⌘/Ctrl</kbd> <kbd>Enter</kbd> | Complete or reopen the open task |
| <kbd>⌘/Ctrl</kbd> <kbd>Z</kbd> / <kbd>⇧</kbd> <kbd>⌘/Ctrl</kbd> <kbd>Z</kbd> | Undo / redo |
| <kbd>Esc</kbd> | Close the palette, modal or task pane |

## Architecture

```
src/core/          pure TypeScript, shared by the browser AND the server
  reducer.ts       actions · authorize() (default-deny) · reducer · hydrate()
  rbac.ts          roles, can(), scopeStateForViewer() (read scoping), agentCan()
  rules.ts         automation engine     schedule.ts  critical path
  insights.ts      risk radar, workload  ai.ts        deterministic, grounded AI
  history.ts       record-level diffs → multi-user-safe undo + live sync patches
  validate.ts      sanitize untrusted state, text limits    aiGuard.ts  injection screening
  store.tsx        React provider: local mode or server mode (optimistic + SSE)
server/            Node built-ins only, no runtime dependencies
  app.ts           HTTP API, auth, SSE fan-out, uploads, public forms, clocks
  db.ts            node:sqlite (WAL): one row per record, transactional writes
  auth.ts          scrypt, sessions, TOTP 2FA, signed URLs, rate limits
```

**How an action flows**

1. The browser applies the action optimistically, so the UI responds instantly.
2. It sends `POST /api/actions`.
3. The server re-runs `authorize()` as the session's identity, then the reducer.
4. Only the changed records are written to SQLite, in one transaction.
5. Every open tab receives a patch containing only what that viewer is allowed to read.

Each action carries an id seed, so optimistic results and the server's authoritative
results always agree.

**Design choices**

- No UI library: React 18, Vite and TypeScript only. Charts and icons are inline SVG.
- Every route, the task pane, the palette and modals are lazy-loaded chunks, prefetched
  when the browser is idle.
- One design-token file (`src/styles/tokens.css`) drives light and dark themes.
  Fonts (Plus Jakarta Sans, JetBrains Mono) are bundled, so the app works offline.

## Security model

- **Sessions:** HttpOnly, SameSite=Strict cookies (only the SHA-256 of the token is
  stored), scrypt-hashed passwords, optional or required **TOTP two-factor**, idle
  expiry, a session list with remote sign-out. Changing your password signs out your
  other sessions.
- **Authorization:** every action is re-authorized on the server. Clients can't
  replace state or trigger clock-driven actions. Every stream message is scoped to
  what its viewer may read.
- **Browser hardening:** CSRF protection (custom header, Origin / Sec-Fetch-Site checks,
  SameSite cookies). Strict CSP (no inline script, no eval), `frame-ancestors 'none'`,
  nosniff, no-referrer, COOP/CORP.
- **Rate limits** on login, actions, uploads, invites and public forms. Login timing is
  equalized so it doesn't reveal which accounts exist.
- **Uploads:** checked by content rather than extension, HTML/SVG/script rejected,
  EICAR malware-signature check, 10 MB cap. Downloads go through **5-minute signed
  links** that re-check read access.
- **Public forms:** timed signed token, honeypot field, per-IP limits, no directory
  exposure.
- **"View as":** requires a reason, is time-limited, notifies the person and is audited.
- **Audit log:** role and sharing changes, deletions, approvals, sign-ins, 2FA, exports
  and blocked attempts. Backups never contain passwords or sessions.

## Testing

```bash
npm run typecheck                 # browser + server
npm test                          # 118 unit + server tests (real sockets, SQLite, SSE)
```

End-to-end suites use Playwright. Install the browser once with
`npx playwright install chromium`.

```bash
# 66 browser checks, local mode (the API server must be stopped)
npm run dev & node scripts/e2e.mjs

# 26 checks, server mode, against a fresh temporary database
npm run build && npm run -s build:server && npm run e2e:server

# Content-Security-Policy check: 24 routes, 0 violations
npm run build && npm run preview & npm run check:csp
```

Before you open a pull request, run
`npm run typecheck && npm test && npm run build`. If you changed the UI, run both
end-to-end suites too.

## Project structure

```
.
├── public/            icon, PWA manifest, service worker
├── scripts/           e2e suites, CSP check, screenshot tool
├── server/            Node API server + tests
├── shots/             screenshots
├── src/
│   ├── core/          reducer, RBAC, rules, scheduling, AI, seed data, store
│   ├── styles/        tokens.css · app.css · refresh.css
│   ├── ui/            sidebar, top bar, task list, command palette, primitives
│   └── views/         one file per screen (Home, Board, Timeline, Goals, Admin, …)
├── AGENTS.md          in-depth notes for contributors and coding agents
└── vite.config.ts     dev proxy, CSP plugin, chunking
```

## Contributing

Read [`AGENTS.md`](AGENTS.md) first. It covers the state model, permission rules and
known pitfalls. Key rules:

- Every new mutating action must be added to `authorize()` **and** hidden or disabled
  in the UI with `can()`.
- Anything the reducer imports must stay free of DOM and React code, because it is
  bundled into the server.
- Use design tokens (`var(--color-*)`, `var(--text-*)` …), never hard-coded colours or
  sizes.
- Render task completion with `<TaskCheckbox>` so approvals and permissions are handled.

## Roadmap

Not included yet, because each needs extra infrastructure (the extension points are
documented in the code):

- SAML / OIDC single sign-on
- Postgres with row-level security
- A real antivirus engine
- Email delivery
- A native desktop shell (the installable PWA covers install, offline and windowed use)
