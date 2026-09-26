// Runs the API server (restarts on change) and the Vite dev server together.
import { spawn } from "node:child_process";

// Dev tools often set PORT for the web server; the API always gets its own port.
const env = { ...process.env, API_PORT: process.env.API_PORT || "3000" };
const procs = [
  ["server", "npx", ["tsx", "watch", "--disable-warning=ExperimentalWarning", "server/index.ts"]],
  // Extra arguments (e.g. --open) go to Vite.
  ["web", "npx", ["vite", ...process.argv.slice(2)]],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"], shell: process.platform === "win32", env });
  const prefix = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join("\n") + "\n";
  p.stdout.on("data", (c) => process.stdout.write(prefix(c)));
  p.stderr.on("data", (c) => process.stderr.write(prefix(c)));
  p.on("exit", (code) => {
    console.log(`[${name}] stopped (${code ?? "signal"})`);
    stop();
  });
  return p;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill();
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
