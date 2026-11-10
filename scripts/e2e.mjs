import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", e => errs.push("EXC " + e.message));
p.on("console", m => { if (m.type() === "error") errs.push("ERR " + m.text().slice(0, 200)); });
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name, extra); } };
const fresh = async (h) => { await p.goto("http://127.0.0.1:5175/#" + h, { waitUntil: "commit" }); await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(900); };

/* ---------- redesigned surfaces render ---------- */
for (const [route, name, sel] of [
  ["/dev", "Dev board", ".board-col"],
  ["/service", "Service desk", ".list-head"],
  ["/agency", "Agency", ".tabs"],
  ["/tables", "Tables", "table"],
  ["/pages", "Pages", ".page-scroll"],
  ["/admin", "Admin console", ".tabs"],
  ["/status-templates", "Status templates", ".stat-card"],
  ["/ai-teammates", "AI teammates", ".agent-card"],
  ["/chat", "AI chat", ".chat-composer"],
  ["/workload", "Workload", ".heat-cell"],
  ["/rules", "Automations", ".switch"],
  ["/project-templates", "Templates", ".agent-card"],
]) {
  await fresh(route);
  check(`route ${name}`, await p.evaluate(s => document.querySelectorAll(s).length > 0, sel));
  await p.screenshot({ path: `shots/v2-${route.replace(/\//g, "")}.png` });
}

/* ---------- impersonation / RBAC ---------- */
await fresh("/admin");
check("admin visible to owner", await p.evaluate(() => document.body.innerText.includes("Admin console")));
const lucasRow = p.locator(".row", { hasText: "Lucas Meyer" }).first();
await lucasRow.getByRole("button", { name: "View as" }).click();
await p.locator(".popover input").fill("E2E support check");
await p.locator(".popover button", { hasText: "Start viewing" }).click();
await p.waitForTimeout(700);
check("impersonation banner", await p.evaluate(() => !!document.querySelector(".impersonation-bar")));
await fresh("/home");
const navText = await p.evaluate(() => document.querySelector(".sidebar")?.textContent ?? "");
check("guest sees invited project", navText.includes("Website Redesign"), navText.slice(0, 120));
check("guest cannot see Atlas", !navText.includes("Atlas Product Launch"));
await fresh("/admin");
check("guest blocked from admin", await p.evaluate(() => document.body.innerText.includes("Admin access required")));
await fresh("/project/p-website/list");
const addRows = await p.evaluate(() => [...document.querySelectorAll(".add-task-row")].filter(e => e.textContent.includes("Add task")).length);
check("viewer has no add-task rows", addRows === 0, `found ${addRows}`);
const disabled = await p.evaluate(() => document.querySelector(".task-row .checkbox")?.disabled);
check("viewer checkbox disabled", disabled === true);
await p.screenshot({ path: "shots/v2-guest-view.png" });
await p.locator(".impersonation-bar button").click();
await p.waitForTimeout(500);
check("return to owner", !(await p.evaluate(() => !!document.querySelector(".impersonation-bar"))));

/* ---------- saved views ---------- */
await fresh("/project/p-atlas/list");
await p.locator('.viewbar .chip', { hasText: "Views" }).click();
await p.waitForTimeout(300);
await p.locator('.popover input').fill("Launch blockers");
await p.locator('.popover .btn-primary').click();
await p.waitForTimeout(500);
check("saved view created", await p.evaluate(() => document.body.innerText.includes("Saved view")));
await p.locator('.viewbar .chip', { hasText: "Views" }).click();
await p.waitForTimeout(300);
const viewItems = await p.locator('.popover .menu-item').allInnerTexts();
check("saved view listed", viewItems.some(t => t.includes("Launch blockers")), viewItems.join("|"));
await p.keyboard.press("Escape");

/* ---------- new surface interactions ---------- */
// tables: edit a cell
await fresh("/tables");
await p.locator("td .cell-value").first().click();
await p.locator("td input").first().fill("SSO for enterprise tier (v2)");
await p.keyboard.press("Tab");
await p.waitForTimeout(400);
check("table cell edited", await p.evaluate(() => document.body.innerText.includes("(v2)")));

// pages: edit body
await fresh("/pages");
await p.locator(".page-scroll textarea").first().fill("Updated body from e2e.");
await p.waitForTimeout(500);
check(
  "page body saved",
  (await p.locator(".page-scroll textarea").first().inputValue()).includes("Updated body from e2e.")
);
// admin permission matrix
await fresh("/admin");
await p.locator(".tab", { hasText: "Roles & permissions" }).click();
await p.waitForTimeout(400);
check("permission matrices render", await p.evaluate(() => document.querySelectorAll(".matrix").length === 2));
await p.screenshot({ path: "shots/v2-admin-permissions.png" });

// agency: publish portal
await fresh("/agency");
await p.locator('.tab', { hasText: "Portals" }).click();
await p.waitForTimeout(400);
const publish = p.locator('button', { hasText: "Publish portal" }).first();
await publish.click();
await p.waitForTimeout(400);
check("portal published", await p.evaluate(() => document.body.innerText.includes("published just now") || document.body.innerText.includes("Published")));

// service desk: create task from request
await fresh("/service");
await p.locator(".row", { hasText: "Rules not firing for guest users" }).first().click();
await p.waitForTimeout(500);
await p.locator('.pane button', { hasText: "Create task from request" }).click();
await p.waitForTimeout(500);
check("service request → task", await p.evaluate(() => document.body.innerText.includes("triage")));

// dev: ticket + agent session
await fresh("/dev");
await p.locator('.card', { hasText: "Builder: unsaved changes prompt" }).first().click();
await p.waitForTimeout(500);
await p.locator('.pane button', { hasText: "Start a session" }).click();
await p.waitForTimeout(300);
await p.locator('.popover .menu-item').first().click();
await p.waitForTimeout(600);
check("agent session started", await p.evaluate(() => document.querySelectorAll('.pane .run-step').length > 0));
await p.waitForTimeout(7000);
check("agent session advanced", await p.evaluate(() => document.querySelectorAll('.pane .run-dot.done').length >= 2));
await p.screenshot({ path: "shots/v2-dev-session.png" });

/* ---------- regression: core flows still work ---------- */
await fresh("/project/p-atlas/list");
const row = p.locator('.task-row', { hasText: "Automation rule engine" }).first();
await row.locator('.checkbox').click();
await p.waitForTimeout(500);
check("complete task", await p.evaluate(() => document.body.innerText.includes("Task completed")));
await p.keyboard.press("Meta+z");
await p.waitForTimeout(400);
check("undo works", await p.evaluate(() => !document.querySelector('.task-row.done .task-name')?.textContent?.includes("Automation")));

await p.keyboard.press("Meta+k");
await p.waitForTimeout(300);
await p.keyboard.type("dev");
await p.waitForTimeout(400);
check("palette finds new surfaces", await p.evaluate(() => document.body.innerText.includes("Dev") || document.body.innerText.includes("Go to")));
await p.keyboard.press("Escape");

await fresh("/chat");
await p.locator('.chat-composer textarea').fill("What should I work on today?");
await p.keyboard.press("Enter");
await p.waitForTimeout(800);
check("AI chat replies", await p.evaluate(() => document.querySelectorAll('.chat-bubble').length >= 2));

/* ---------- RBAC hardening: guest isolation ---------- */
await fresh("/admin");
await p.locator(".row", { hasText: "Lucas Meyer" }).first().getByRole("button", { name: "View as" }).click();
await p.locator(".popover input").fill("E2E support check");
await p.locator(".popover button", { hasText: "Start viewing" }).click();
await p.waitForTimeout(500);
await fresh("/project/p-atlas/list");
check("guest: private project link shows no data", await p.evaluate(() =>
  document.body.innerText.includes("don't have access") && !document.querySelector(".task-row")));
await fresh("/search?q=atlas");
check("guest: search does not leak tasks", await p.evaluate(() => !document.querySelector("#main-content").innerText.includes("Atlas launch")));
await p.keyboard.press("Meta+k");
await p.waitForTimeout(300);
await p.keyboard.type("Automation rule engine");
await p.waitForTimeout(300);
check("guest: palette does not leak tasks", await p.evaluate(() => !document.body.innerText.includes("cycle detection")));
await p.keyboard.press("Escape");
await fresh("/chat");
check("guest: AI chat history is private", await p.evaluate(() => !document.body.innerText.includes("Atlas launch check-in")));
check("guest: create project hidden on home", await (async () => { await fresh("/home"); return p.evaluate(() => ![...document.querySelectorAll("button")].some(b => b.textContent.trim() === "New project")); })());
check("guest: banner names the real admin", await p.evaluate(() => document.querySelector(".impersonation-bar")?.textContent.includes("Return to Maya")));
await p.locator(".impersonation-bar button").click();
await p.waitForTimeout(400);

/* ---------- persistence: last edit survives an immediate reload ---------- */
await fresh("/project/p-atlas/list");
const nameBefore = "Persisted " + Date.now();
await p.evaluate(() => document.querySelector(".add-task-row")?.click());
await p.waitForTimeout(200);
await p.keyboard.type(nameBefore);
await p.keyboard.press("Enter");
await p.reload({ waitUntil: "domcontentloaded" }); // well inside the 300 ms debounce
await p.waitForTimeout(900);
check("write flushed on unload", await p.evaluate((n) => document.body.innerText.includes(n), nameBefore));

/* ---------- cross-tab sync ---------- */
const p2 = await ctx.newPage();
await p2.goto("http://127.0.0.1:5175/#/project/p-atlas/list");
await p2.waitForTimeout(900);
await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("waypoint-v1-state"));
  s.tasks.push({ ...s.tasks.find(t => t.projectId === "p-atlas" && !t.parentId), id: "tk-crosstab", name: "Written by another tab", order: 1 });
  localStorage.setItem("waypoint-v1-state", JSON.stringify(s));
});
await p2.waitForTimeout(700);
check("other tab picks up changes", await p2.evaluate(() => document.body.innerText.includes("Written by another tab")));
await p2.close();

/* ---------- board cards label bare values ---------- */
await fresh("/project/p-atlas/board");
check("board labels numeric fields", await p.evaluate(() => [...document.querySelectorAll(".card-field-label")].some(e => e.textContent.includes("Effort"))));

/* ---------- approvals ---------- */
await fresh("/project/p-atlas/list");
await p.locator(".task-row", { hasText: "Write the Atlas launch announcement" }).first().click();
await p.waitForTimeout(500);
await p.locator(".pane .icon-btn[title*='More'], .pane button[aria-label*='More']").first().click();
await p.waitForTimeout(250);
await p.locator(".menu-item", { hasText: "Convert to approval" }).click();
await p.waitForTimeout(400);
check("approval: panel shown to the approver", await p.locator(".approval-panel").getByRole("button", { name: "Approve", exact: true }).count() === 1);
check("approval: row shows approval mark instead of checkbox", await p.evaluate(() =>
  !!document.querySelector(".task-row .approval-mark")));
await p.locator(".approval-note").fill("Looks good");
await p.locator(".approval-panel").getByRole("button", { name: "Approve", exact: true }).click();
await p.waitForTimeout(400);
check("approval: decision completes the task", await p.evaluate(() =>
  document.querySelector(".approval-panel")?.className.includes("approval-approved") &&
  document.body.innerText.includes("Approved this: Looks good")));

/* ---------- audit log captures a blocked attempt ---------- */
await fresh("/admin");
await p.locator(".row", { hasText: "Lucas Meyer" }).first().getByRole("button", { name: "View as" }).click();
await p.locator(".popover input").fill("E2E support check");
await p.locator(".popover button", { hasText: "Start viewing" }).click();
await p.waitForTimeout(400);
await fresh("/project/p-website/list"); // lucas is a viewer here
await p.locator("body").click({ position: { x: 700, y: 600 } });
await p.keyboard.press("Tab");
await p.keyboard.press("n"); // Tab+N = new section → not allowed for viewers
await p.waitForTimeout(400);
check("blocked action explains itself", await p.evaluate(() => document.body.innerText.includes("don't have permission")));
await p.locator(".impersonation-bar button").click();
await p.waitForTimeout(400);
await fresh("/admin");
await p.locator(".tab", { hasText: "Audit log" }).click();
await p.waitForTimeout(300);
const auditText = await p.evaluate(() => document.querySelector(".audit-list")?.innerText ?? "");
check("audit: impersonation recorded", auditText.includes("started viewing as Lucas"), auditText.slice(0, 200));
check("audit: blocked attempt recorded with real actor", auditText.includes("Blocked") && auditText.includes("via Maya"), auditText.slice(0, 300));
check("audit: approval recorded", auditText.includes("approved"), auditText.slice(0, 300));

/* ---------- timeline: critical path + auto-shift ---------- */
await fresh("/project/p-atlas/timeline");
check("timeline: forecast + conflicts summarised", await p.evaluate(() =>
  /Forecast finish/.test(document.querySelector(".schedule-summary")?.textContent ?? "")));
check("timeline: dependency arrows drawn", await p.evaluate(() => document.querySelectorAll(".dep-edge").length > 0));
await p.locator('[role=switch][aria-label="Auto-shift dependents"]').click();
await p.waitForTimeout(300);
const blocker = p.locator(".timeline-bar", { hasText: "Automation rule engine" }).first(); // blocks "Load test 10k"
await blocker.scrollIntoViewIfNeeded();
await blocker.click({ button: "right" });
await p.waitForTimeout(250);
await p.locator(".menu-item", { hasText: "Shift one day later" }).click();
await p.waitForTimeout(400);
check("timeline: auto-shift moves dependents", await p.evaluate(() => /Shifted \d+ dependent task/.test(document.body.innerText)));

/* ---------- v3 features (local mode) ---------- */
await fresh("/workload");
check("workload: hours against capacity", await p.evaluate(() => [...document.querySelectorAll(".heat-cell")].some((c) => /\dh$/.test(c.textContent)) && !!document.querySelector(".rebalance")));

await fresh("/reporting");
check("reporting: risk radar scores projects", await p.evaluate(() => document.querySelectorAll(".risk-row .risk-badge").length > 0));
await p.locator(".risk-row").first().click();
await p.waitForTimeout(200);
check("risk radar explains itself", await p.evaluate(() => document.querySelectorAll(".risk-factor").length > 0 || document.body.innerText.includes("No risk signals")));

await fresh("/search?q=" + encodeURIComponent("overdue high priority tasks"));
check("search: plain English becomes filters", await p.evaluate(() => {
  const t = document.querySelector(".nl-chips")?.textContent ?? "";
  return t.includes("Overdue") && t.includes("High priority");
}));

await fresh("/rules");
await p.locator(".page-actions .btn-primary").first().click();
await p.waitForTimeout(400);
if (await p.locator(".modal", { hasText: "Select a rule" }).count()) await p.locator(".modal .side-item").first().click();
await p.locator(".modal button", { hasText: "Add condition" }).click();
await p.locator(".modal button", { hasText: "Dry run" }).click();
await p.waitForTimeout(200);
check("rules: conditions + dry run", await p.evaluate(() => {
  const t = document.querySelector(".modal")?.innerText ?? "";
  return t.includes("Only if") && t.includes("Would have run");
}));
await p.keyboard.press("Escape");

await fresh("/project/p-atlas/list");
await p.locator(".task-row", { hasText: "Pricing page copy" }).first().click();
await p.waitForTimeout(500);
await p.locator(".pane button", { hasText: "Doesn't repeat" }).click();
await p.locator(".popover").getByRole("button", { name: "Every week", exact: true }).click();
await p.waitForTimeout(300);
check("recurring: task repeats weekly", await p.evaluate(() => document.querySelector(".pane")?.innerText.includes("Every week")));
await p.keyboard.press("Escape");

await fresh("/project/p-atlas/list");
await p.locator(".viewbar .chip", { hasText: "Templates" }).click();
await p.locator(".popover .menu-item", { hasText: "Bug report" }).click();
await p.waitForTimeout(400);
check("templates: create task with subtasks", await p.evaluate(() => document.body.innerText.includes("with 3 subtasks")));

await fresh("/project/p-atlas/messages");
await p.locator(".composer textarea").fill("Shipping notes from e2e");
await p.locator(".composer button", { hasText: "Post" }).click();
await p.waitForTimeout(300);
check("messages: stored in the workspace", await p.evaluate(() => JSON.parse(localStorage.getItem("waypoint-v1-state") ?? "{}").messages?.some((m) => m.text === "Shipping notes from e2e") || document.body.innerText.includes("Shipping notes from e2e")));

await fresh("/pages");
await p.locator(".page-tree-row").first().hover();
await p.locator(".page-tree-add").first().click();
await p.waitForTimeout(400);
check("pages: nested subpage", await p.evaluate(() => document.querySelectorAll(".page-trail button").length >= 2));

await fresh("/tables");
await p.locator(".table-toolbar select[aria-label='Sort by']").selectOption({ index: 1 });
p.once("dialog", (d) => d.accept("Sorted view"));
await p.locator(".table-toolbar button", { hasText: "Save as view" }).click();
await p.waitForTimeout(300);
check("tables: saved view tab", await p.evaluate(() => [...document.querySelectorAll(".tab")].some((t) => t.textContent === "Sorted view")));

await fresh("/agency");
await p.locator(".side-item", { hasText: "Pipeline" }).click();
await p.waitForTimeout(300);
check("crm: pipeline by stage", await p.evaluate(() => document.body.innerText.includes("Client pipeline") && document.querySelectorAll(".board-col").length === 5));

await fresh("/portfolios");
await p.locator(".segmented button", { hasText: "Board" }).click();
await p.waitForTimeout(300);
check("portfolios: board view", await p.evaluate(() => document.querySelectorAll(".board-col").length >= 4));

await fresh("/admin?tab=security");
const [download] = await Promise.all([p.waitForEvent("download"), p.locator("button", { hasText: "Download backup" }).click()]);
check("backup: downloads JSON", download.suggestedFilename().startsWith("waypoint-backup-"));

await fresh("/home");
await p.locator('button[aria-label="Help"]').click();
await p.locator(".popover .menu-item", { hasText: "What's new" }).click();
await p.waitForTimeout(200);
check("help: what's new works (no dead menu items)", await p.evaluate(() => document.body.innerText.includes("Live collaboration")));
await p.keyboard.press("Escape");

console.log("\nRESULT", pass, "passed,", fail, "failed");
console.log("ERRORS:", JSON.stringify(errs.slice(0, 6)));
await b.close();
