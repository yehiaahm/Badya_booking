import { it } from "vitest";
import { createSeed } from "../../server/api/seed/generate";
it("seed timing", () => {
  const t0 = performance.now();
  const db = createSeed(new Date(2026, 8, 24, 14, 20).toISOString());
  const t1 = performance.now();
  const json = JSON.stringify(db);
  console.log("seed ms", Math.round(t1 - t0), "bookings", db.bookings.length, "json KB", Math.round(json.length / 1024), "stats", db.dailyStats.length, "waitlist", db.waitlist.length, "audit", db.audit.length);
  const byStatus: Record<string, number> = {};
  for (const b of db.bookings) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
  console.log(JSON.stringify(byStatus));
});
