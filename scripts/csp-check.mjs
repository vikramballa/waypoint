// Visits every route of the production build (`vite preview`, :5176) and fails
// on any Content-Security-Policy violation or page error.
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://127.0.0.1:5176";
const routes = ["/home", "/my-tasks", "/inbox", "/project/p-atlas/list", "/project/p-atlas/board",
  "/project/p-atlas/timeline", "/project/p-atlas/calendar", "/project/p-atlas/dashboard", "/goals",
  "/portfolios", "/reporting", "/search?q=atlas", "/ai-teammates", "/chat", "/meetings", "/workload",
  "/rules", "/project-templates", "/dev", "/service", "/agency", "/tables", "/pages", "/admin"];
const b = await chromium.launch();
const p = await b.newPage();
const problems = [];
p.on("pageerror", (e) => problems.push(`error: ${e.message}`));
p.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 160)}`); });
await p.exposeFunction("__csp", (v) => problems.push(`csp: ${v}`));
await p.addInitScript(() => document.addEventListener("securitypolicyviolation",
  (e) => window.__csp(`${e.violatedDirective} ${e.blockedURI}`)));
const res = await p.goto(BASE + "/#/home");
const header = res.headers()["content-security-policy"] ?? "";
for (const r of routes) { await p.goto(BASE + "/#" + r); await p.waitForTimeout(500); }
await p.keyboard.press("Meta+k"); await p.waitForTimeout(300);
console.log("header frame-ancestors:", header.includes("frame-ancestors 'none'"));
console.log(problems.length ? problems.join("\n") : `CSP OK — ${routes.length} routes, 0 violations`);
await b.close();
process.exit(problems.length ? 1 : 0);
