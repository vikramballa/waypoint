import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const routes = process.argv.slice(2);
const out = process.env.SHOTS_DIR || "shots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on("console", (m) => {
  if (m.type() === "error") console.log("PAGE ERROR:", m.text());
});
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", e.message));

const targets = routes.length
  ? routes
  : [
      "home",
      "project/p-atlas/list",
      "project/p-atlas/board",
      "project/p-atlas/timeline",
      "project/p-atlas/calendar",
      "project/p-atlas/dashboard",
      "my-tasks",
      "inbox",
      "goals",
      "portfolios",
    ];

for (const target of targets) {
  const [name] = target.split("?");
  await page.goto(`http://127.0.0.1:5175/#/${target}`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const file = `${out}/${name.replace(/\//g, "-")}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log("shot", file);
}

await browser.close();
