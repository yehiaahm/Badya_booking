// Lists interface text that has no Arabic translation yet.
// Usage: npm run i18n:check            → missing keys
//        npm run i18n:check -- --all   → every key (JSON)
import fs from "node:fs";
import path from "node:path";

const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f) && !p.includes(`${path.sep}i18n${path.sep}`)) files.push(p);
  }
})("src");

// t("…"), tr("…"), tx("…") and the plural key of tn(n, "…", "…")
const single = /\b(?:t|tr|tx)\(\s*("(?:[^"\\]|\\.)*")/g;
const plural = /\btn\(\s*[^,]+,\s*"(?:[^"\\]|\\.)*",\s*("(?:[^"\\]|\\.)*")/g;
const keys = new Map();
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  for (const rx of [single, plural]) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(s))) {
      const k = JSON.parse(m[1]);
      if (!keys.has(k)) keys.set(k, path.relative(".", f));
    }
  }
}

const ar = fs.readFileSync("src/i18n/ar.ts", "utf8");
const have = new Set();
for (const m of ar.matchAll(/^\s*("(?:[^"\\]|\\.)*"):/gm)) have.add(JSON.parse(m[1]));

if (process.argv.includes("--all")) {
  console.log(JSON.stringify([...keys.keys()].sort(), null, 1));
} else {
  const missing = [...keys].filter(([k]) => !have.has(k)).sort((a, b) => a[1].localeCompare(b[1]));
  for (const [k, f] of missing) console.log(`${f}\t${JSON.stringify(k)}`);
  console.log(`\n${missing.length} of ${keys.size} strings need Arabic.`);
  if (missing.length) process.exitCode = 1;
}
