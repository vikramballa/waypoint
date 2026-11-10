// Server-mode browser tests against the production build served by the
// Waypoint server (one origin, real CSP, real SQLite, real SSE).
//   npm run build && npm run -s build:server
//   SERVE_STATIC=1 PORT=5190 DATA_DIR=<tmp> node .server/index.mjs
//   node scripts/e2e-server.mjs
import { chromium } from "playwright";
import { createHmac } from "node:crypto";

const BASE = process.env.BASE ?? "http://127.0.0.1:5190";
const PASSWORD = "waypoint-demo";
const MAYA = "maya.chen@northwind.co";
const PRIYA = "priya.nair@northwind.co";
const ALEX = "alex.rivera@northwind.co";
const LUCAS = "lucas@agency.partner";

let pass = 0;
let fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log("PASS", name);
  } else {
    fail++;
    console.log("FAIL", name, extra);
  }
};
const errs = [];
// expected: deliberate wrong logins / denied requests surface as resource errors
const EXPECTED = /Failed to load resource: the server responded with a status of (401|403|404|409|415|422|429)/;

function totp(secret, t = Date.now()) {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of secret.replace(/\s/g, "").toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac("sha1", Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

const b = await chromium.launch();
async function person(label) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(`${label} EXC ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !EXPECTED.test(m.text())) errs.push(`${label} ERR ${m.text().slice(0, 200)}`);
  });
  return { ctx, page };
}
async function login(page, email, code) {
  await page.goto(BASE + "/#/home");
  await page.waitForSelector(".auth-title, .page-title", { timeout: 8000 });
  if (await page.locator(".auth-title", { hasText: "Sign in" }).count()) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator(".auth-submit").click();
    if (code) {
      await page.waitForSelector('input[autocomplete="one-time-code"]');
      await page.locator('input[autocomplete="one-time-code"]').fill(code());
      await page.locator(".auth-submit").click();
    }
  }
  await page.waitForSelector(".topbar", { timeout: 8000 });
  await page.waitForSelector(".conn-pill.live", { timeout: 8000 });
}
// Poll from Node with page.evaluate (waitForFunction needs eval, which our CSP blocks — correctly).
const until = async (page, fn, arg, ms = 5000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if (await page.evaluate(fn, arg)) return true;
    } catch {
      /* navigating */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

/* ---------- production headers ---------- */
const res = await fetch(BASE + "/");
check("prod: CSP header on the app", (res.headers.get("content-security-policy") ?? "").includes("script-src 'self'"));
check("prod: clickjacking + sniffing protection", res.headers.get("x-frame-options") === "DENY" && res.headers.get("x-content-type-options") === "nosniff");

/* ---------- sign in ---------- */
const maya = await person("maya");
await maya.page.goto(BASE + "/#/home");
await maya.page.waitForSelector(".auth-title");
check("signed out → sign-in screen", await maya.page.locator(".auth-title", { hasText: "Sign in" }).count() === 1);
await maya.page.locator('input[type="email"]').fill(MAYA);
await maya.page.locator('input[type="password"]').fill("not-the-password");
await maya.page.locator(".auth-submit").click();
check("wrong password is refused", await until(maya.page, () => document.querySelector(".auth-error")?.textContent.includes("don't match")));
await login(maya.page, MAYA);
check("sign in → live workspace", await maya.page.locator(".conn-pill.live").count() === 1);

/* ---------- real-time collaboration ---------- */
const priya = await person("priya");
await login(priya.page, PRIYA);
await maya.page.goto(BASE + "/#/project/p-atlas/list");
await priya.page.goto(BASE + "/#/project/p-atlas/list");
await maya.page.waitForSelector(".task-row");
await priya.page.waitForSelector(".task-row");
await maya.page.locator(".add-task-row").first().click();
await maya.page.keyboard.type("Live from Maya");
await maya.page.keyboard.press("Enter");
check("other people see new work instantly", await until(priya.page, () => document.body.innerText.includes("Live from Maya")));

/* ---------- presence ---------- */
await priya.page.locator(".task-row", { hasText: "Pricing page copy" }).first().click();
await maya.page.locator(".task-row", { hasText: "Pricing page copy" }).first().click();
check("presence: see who else is on a task", await until(maya.page, () => document.querySelector(".pane .presence-row")?.textContent.includes("Priya")));

/* ---------- approvals across people ---------- */
await maya.page.goto(BASE + "/#/project/p-atlas/list");
await maya.page.locator(".task-row", { hasText: "Design the automation builder" }).first().click();
await priya.page.goto(BASE + "/#/project/p-atlas/list");
await priya.page.locator(".task-row", { hasText: "Design the automation builder" }).first().click();
await maya.page.locator(".pane .icon-btn[title*='More'], .pane button[aria-label*='More']").first().click();
await maya.page.locator(".menu-item", { hasText: "Convert to approval" }).click();
check("approver is asked live", await until(priya.page, () => [...document.querySelectorAll(".approval-panel button")].some((b) => b.textContent.trim() === "Approve")));
await priya.page.locator(".approval-panel").getByRole("button", { name: "Approve", exact: true }).click();
check("requester sees the decision live", await until(maya.page, () => document.querySelector(".approval-panel")?.className.includes("approval-approved")));

/* ---------- uploads ---------- */
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
await maya.page.locator(".pane input[type=file]").setInputFiles({ name: "diagram.png", mimeType: "image/png", buffer: png });
check("upload attaches a file", await until(maya.page, () => document.querySelector(".pane")?.innerText.includes("diagram.png")));
const [popup] = await Promise.all([
  maya.page.waitForEvent("popup"),
  maya.page.locator(".pane button[aria-label='Download diagram.png']").click(),
]);
await popup.waitForLoadState().catch(() => {});
check("download uses a signed, expiring link", /\/api\/files\/.+\?exp=\d+&sig=/.test(popup.url()));
await popup.close();
await maya.page.locator(".pane input[type=file]").setInputFiles({
  name: "invoice.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"),
});
check("malware is blocked", await until(maya.page, () => document.body.innerText.includes("blocked by the malware scanner")));

/* ---------- public form ---------- */
await maya.page.goto(BASE + "/#/project/p-atlas/form");
await maya.page.locator('[role=switch][aria-label="Accept public submissions"]').click();
await maya.page.waitForTimeout(400);
const anon = await person("anon");
await anon.page.goto(BASE + "/#/f/form-1");
await anon.page.waitForSelector(".auth-form");
check("public form hides the people directory", !(await anon.page.evaluate(() => document.body.innerText.includes("Requested by"))));
await anon.page.locator(".auth-form input.input").first().fill("Public request from a customer");
await anon.page.locator(".auth-form textarea.input").first().fill("Our nightly export breaks when a task has no due date.");
await anon.page.waitForTimeout(2800); // spam check: forms submitted instantly are rejected
await anon.page.locator(".auth-submit").click();
check("anyone can submit a public form", await until(anon.page, () => document.body.innerText.includes("we got it")));
await maya.page.goto(BASE + "/#/project/p-atlas/list");
check("submission lands as a task live", await until(maya.page, () => document.body.innerText.includes("Public request from a customer")));

/* ---------- server-side RBAC ---------- */
const lucas = await person("lucas");
await login(lucas.page, LUCAS);
const nav = await lucas.page.evaluate(() => document.querySelector(".sidebar")?.textContent ?? "");
check("guest sees only invited projects", nav.includes("Website Redesign") && !nav.includes("Atlas Product Launch"));
await lucas.page.goto(BASE + "/#/project/p-atlas/list");
await lucas.page.waitForTimeout(600);
check("guest gets no data for private links", await lucas.page.evaluate(() => !document.querySelector(".task-row") && document.body.innerText.includes("don't have access")));

/* ---------- offline / reconnect ---------- */
await maya.ctx.setOffline(true);
check("connection loss is shown", await until(maya.page, () => !document.querySelector(".conn-pill.live"), null, 8000));
await maya.ctx.setOffline(false);
check("reconnects automatically", await until(maya.page, () => !!document.querySelector(".conn-pill.live"), null, 10000));

/* ---------- two-factor ---------- */
const alex = await person("alex");
await login(alex.page, ALEX);
await alex.page.locator('button[aria-label="Account menu"]').click();
await alex.page.locator(".menu-item", { hasText: "Account & security" }).click();
await alex.page.locator(".modal button", { hasText: "Set up two-factor" }).click();
await alex.page.waitForSelector(".auth-secret code");
const secret = (await alex.page.locator(".auth-secret code").textContent()).replace(/\s/g, "");
await alex.page.locator(".modal input[placeholder='6-digit code']").fill(totp(secret));
await alex.page.locator(".modal button", { hasText: "Verify" }).click();
check("2FA can be turned on", await until(alex.page, () => document.querySelector(".modal")?.innerText.includes("you'll enter a code")));
await alex.page.keyboard.press("Escape");
await alex.page.locator('button[aria-label="Account menu"]').click();
await alex.page.locator(".menu-item", { hasText: "Sign out" }).click();
await alex.page.waitForSelector(".auth-title");
await login(alex.page, ALEX, () => totp(secret));
check("2FA sign-in with an authenticator code", await alex.page.locator(".conn-pill.live").count() === 1);

/* ---------- View as + audit + sessions ---------- */
await maya.page.goto(BASE + "/#/admin");
await maya.page.locator(".row", { hasText: "Lucas Meyer" }).first().getByRole("button", { name: "View as" }).click();
await maya.page.locator(".popover input").fill("Ticket 4821: Lucas can't see Brand");
await maya.page.locator(".popover button", { hasText: "Start viewing" }).click();
check("View as runs server-side with a reason", await until(maya.page, () => document.querySelector(".impersonation-bar")?.textContent.includes("Lucas")));
await maya.page.locator(".impersonation-bar button").click();
check("…and returns", await until(maya.page, () => !document.querySelector(".impersonation-bar")));
await maya.page.goto(BASE + "/#/admin");
await maya.page.locator(".tab", { hasText: "Audit log" }).click();
await maya.page.waitForTimeout(400);
const audit = await maya.page.evaluate(() => document.querySelector(".audit-list")?.innerText ?? "");
check("audit: sign-ins, 2FA, uploads blocked, View as reason", audit.includes("signed in") && audit.includes("two-factor") && audit.includes("malware") && audit.includes("Ticket 4821"), audit.slice(0, 400));
await maya.page.locator(".tab", { hasText: "Security & data" }).click();
check("IT admin: every signed-in session listed", await until(maya.page, () => document.querySelectorAll(".audit-row").length >= 4));

/* ---------- undo is safe with other editors ---------- */
await maya.page.goto(BASE + "/#/project/p-atlas/list");
await maya.page.waitForSelector(".task-row");
await maya.page.locator(".task-row", { hasText: "Live from Maya" }).locator(".checkbox").click();
await maya.page.waitForTimeout(400);
await maya.page.locator("body").click({ position: { x: 900, y: 120 } });
await maya.page.keyboard.press("Meta+z");
check("undo works on the server", await until(maya.page, () => {
  const row = [...document.querySelectorAll(".task-row")].find((r) => r.textContent.includes("Live from Maya"));
  return row && !row.className.includes("done");
}));

console.log("\nRESULT", pass, "passed,", fail, "failed");
console.log("ERRORS:", JSON.stringify(errs.slice(0, 8)));
await b.close();
process.exit(fail ? 1 : 0);
