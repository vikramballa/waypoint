// Boots the production server on a throwaway database, runs the server-mode
// browser suite against it, then shuts it down. Usage: npm run e2e:server
// (expects `npm run build && npm run -s build:server` to have run).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = process.env.PORT ?? "5190";
const dataDir = mkdtempSync(join(tmpdir(), "waypoint-e2e-"));
const server = spawn(process.execPath, ["--no-warnings=ExperimentalWarning", ".server/index.mjs"], {
  env: { ...process.env, SERVE_STATIC: "1", PORT: port, DATA_DIR: dataDir },
  stdio: ["ignore", "inherit", "inherit"],
});
const base = `http://127.0.0.1:${port}`;
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try {
    up = (await fetch(base + "/api/health")).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
if (!up) {
  console.error("server did not start");
  server.kill();
  process.exit(1);
}
const tests = spawn(process.execPath, ["scripts/e2e-server.mjs"], { env: { ...process.env, BASE: base }, stdio: "inherit" });
const code = await new Promise((r) => tests.on("exit", r));
server.kill("SIGTERM");
await new Promise((r) => server.on("exit", r));
rmSync(dataDir, { recursive: true, force: true });
process.exit(code ?? 1);
