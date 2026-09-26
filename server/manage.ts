import path from "node:path";
import { format } from "date-fns";
import { config } from "./config";
import { db } from "./api/db";
import { createSeed } from "./api/seed/generate";
import { freshState } from "./setup";
import { hashPassword, temporaryPassword } from "./password";

/**
 * Database maintenance from the command line (stop the server first):
 *
 *   npm run data:demo            fill an empty database with sample students and bookings
 *   npm run data:reset -- --yes  wipe everything and start again with the real catalogue
 *   npm run data:backup          write a backup copy now
 *   npm run data:password -- someone@badya.edu.eg   give an account a new temporary password
 */

const [cmd] = process.argv.slice(2);
const yes = process.argv.includes("--yes") || process.argv.includes("--force");

db.open(config.dbFile);
const backup = () => {
  const file = path.join(config.backupDir, `badya-spaces-before-${cmd}-${format(new Date(), "yyyyMMdd-HHmmss")}.db`);
  db.backupTo(file);
  console.log(`Backup written to ${file}`);
};

switch (cmd) {
  case "demo": {
    // A new install holds only the catalogue and the first admin — anything with students or bookings is real.
    const realData = !db.isEmpty && !db.isDemo && (db.state.bookings.length > 0 || db.state.users.some((u) => u.role === "student"));
    if (realData && !yes) {
      console.error("This database already has real data. Demo data would replace it.\nIf you are sure, run: npm run data:demo -- --force");
      process.exit(1);
    }
    if (!db.isEmpty) backup();
    db.replaceAll(createSeed(new Date().toISOString()));
    console.log(`Demo data loaded: ${db.state.users.length} people, ${db.state.bookings.length} bookings. Demo accounts appear on the sign-in page.`);
    break;
  }
  case "reset": {
    if (!yes) {
      console.error("This deletes every booking, student and setting and starts again with the real catalogue.\nIf you are sure, run: npm run data:reset -- --yes");
      process.exit(1);
    }
    if (!db.isEmpty) backup();
    db.replaceAll(freshState());
    console.log("Database reset. Start the server — the first super admin comes from BOOTSTRAP_ADMIN_EMAIL.");
    break;
  }
  case "backup":
    backup();
    break;
  case "password": {
    const who = process.argv.slice(3).find((a) => !a.startsWith("--"))?.trim().toLowerCase();
    const u = who && db.state.users.find((x) => x.email.toLowerCase() === who || x.universityId === who);
    if (!u) {
      console.error("No account with that email or university ID.\nUsage: npm run data:password -- someone@badya.edu.eg");
      process.exit(1);
    }
    const password = temporaryPassword();
    const hash = await hashPassword(password);
    await db.transaction(() => db.put("credentials", { id: u.id, hash, updatedAt: new Date().toISOString(), temporary: true }));
    console.log(`New temporary password for ${u.name} (${u.email}): ${password}`);
    break;
  }
  default:
    console.log("Usage: npm run data:demo | data:reset -- --yes | data:backup | data:password -- <email or university ID>");
}
db.close();
