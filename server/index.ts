import { serve } from "@hono/node-server";
import { config } from "./config";
import { runAsSystem } from "./context";
import { tick } from "./api/core";
import { db } from "./api/db";
import { createApp } from "./app";
import { dailyBackup } from "./backup";
import { ensureAdmin, freshState } from "./setup";

db.open(config.dbFile);
if (db.isEmpty) {
  db.replaceAll(freshState());
  console.log("[setup] Created a new database with the university's facilities.");
}
await runAsSystem(() => ensureAdmin());

// Time-based work: reminders, no-shows, completions, expired offers.
const runTick = () => runAsSystem(() => tick(true)).catch((e) => console.error("[scheduler]", e));
void runTick();
const scheduler = setInterval(runTick, 30_000);

dailyBackup();
const backups = setInterval(dailyBackup, 3600_000);


const server = serve({ fetch: createApp().fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[server] Badya Spaces ${db.isDemo ? "(demo data) " : ""}running on http://${info.address === "::" ? "localhost" : info.address}:${info.port} — public address ${config.publicUrl}`);
});

function shutdown() {
  clearInterval(scheduler);
  clearInterval(backups);
  server.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
