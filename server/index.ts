/**
 * Entry point: `npm run server` (API on :5180, use with `npm run dev`) or
 * `npm start` (builds the SPA and serves everything from one origin).
 *
 * Env: PORT, HOST, DATA_DIR (default ./data), WAYPOINT_SECRET, WAYPOINT_HTTPS=1,
 *      WAYPOINT_DEMO_PASSWORD, SERVE_STATIC=1 (serve ./dist).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createApp, DEMO_PASSWORD } from "./app";
import { newToken } from "./auth";

const dataDir = resolve(process.env.DATA_DIR ?? "data");
mkdirSync(dataDir, { recursive: true });

// a stable signing key so download links / form tokens survive restarts
const secretFile = join(dataDir, "secret.key");
const secret =
  process.env.WAYPOINT_SECRET ??
  (existsSync(secretFile)
    ? readFileSync(secretFile, "utf8").trim()
    : (() => {
        const s = newToken(32);
        writeFileSync(secretFile, s, { mode: 0o600 });
        return s;
      })());

const staticDir = process.env.SERVE_STATIC === "1" ? resolve("dist") : null;
const port = Number(process.env.PORT ?? 5180);
const host = process.env.HOST ?? "127.0.0.1";

const app = createApp({
  dbFile: join(dataDir, "workspace.db"),
  secret,
  staticDir,
  https: process.env.WAYPOINT_HTTPS === "1",
  demoPassword: process.env.WAYPOINT_DEMO_PASSWORD ?? DEMO_PASSWORD,
});

app.server.listen(port, host, () => {
  console.log(`[waypoint] server on http://${host}:${port}${staticDir ? " (serving dist/)" : " (API only — run `npm run dev` for the UI)"}`);
  console.log(`[waypoint] data in ${dataDir} · demo sign-in: maya.chen@northwind.co / ${process.env.WAYPOINT_DEMO_PASSWORD ?? DEMO_PASSWORD}`);
});

const shutdown = () => {
  console.log("[waypoint] shutting down");
  app.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
