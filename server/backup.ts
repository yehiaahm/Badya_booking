import { readdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { format } from "date-fns";
import { config } from "./config";
import { db } from "./api/db";

const NAME = /^badya-spaces-(\d{4}-\d{2}-\d{2})\.db$/;

/** Take today's backup if there isn't one yet, and delete backups older than the retention window. */
export function dailyBackup() {
  const today = format(new Date(), "yyyy-MM-dd");
  const file = path.join(config.backupDir, `badya-spaces-${today}.db`);
  if (!existsSync(file)) {
    try {
      db.backupTo(file);
      console.log(`[backup] Saved ${file}`);
    } catch (e) {
      console.error("[backup] failed:", (e as Error).message);
    }
  }
  if (!existsSync(config.backupDir)) return;
  const keep = new Date(Date.now() - config.backupKeepDays * 86400_000);
  for (const f of readdirSync(config.backupDir)) {
    const m = NAME.exec(f);
    if (m && new Date(m[1]) < keep) rmSync(path.join(config.backupDir, f), { force: true });
  }
}
