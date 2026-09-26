// One-off helper: wrap interface text in t() across the .tsx files.
// Usage: node scripts/i18n-codemod.mjs [--dry] file...
// Handles JSX text, text props, UI object properties (as getters at module
// level), toast/setError arguments and simple template literals. Anything with
// a plural ternary is left alone and reported for manual handling.
import fs from "node:fs";
import ts from "typescript";

const ATTRS = new Set(["placeholder", "title", "aria-label", "alt", "label", "description", "hint", "body", "confirmLabel", "subtitle", "text", "loadingText"]);
const PROPS = new Set(["label", "title", "body", "description", "hint", "text", "detail", "sub", "help", "confirm"]);
const CALLS = new Set(["toast.success", "toast.error", "toast.info", "setError"]);
const hasLetters = (s) => /[A-Za-z]{2,}/.test(s);
const dry = process.argv.includes("--dry");
const files = process.argv.slice(2).filter((f) => !f.startsWith("--"));
const manual = [];

function placeholderName(expr, used) {
  let base = "v";
  if (ts.isIdentifier(expr)) base = expr.text;
  else if (ts.isPropertyAccessExpression(expr)) base = expr.name.text;
  else if (ts.isCallExpression(expr)) {
    const c = expr.expression;
    base = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "v";
    base = base.replace(/^(fmt|format)/, "").replace(/^./, (x) => x.toLowerCase()) || "v";
  }
  base = base.replace(/[^A-Za-z0-9]/g, "") || "v";
  let name = base;
  let i = 2;
  while (used.has(name)) name = `${base}${i++}`;
  used.add(name);
  return name;
}

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const add = (start, end, text) => edits.push({ start, end, text });
  const insideFunction = (node) => {
    for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return true;
    return false;
  };
  // Files that already use a local `t` get the translator as `tr` so nothing is shadowed.
  let localT = false;
  (function scan(n) {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) && ts.isIdentifier(n.name) && n.name.text === "t") localT = true;
    ts.forEachChild(n, scan);
  })(sf);
  const fn = localT ? "tr" : "t";
  const tCall = (key, vars) => (vars && vars.length ? `${fn}(${JSON.stringify(key)}, { ${vars.map(([n, e]) => (n === e ? n : `${n}: ${e}`)).join(", ")} })` : `${fn}(${JSON.stringify(key)})`);

  /** Template literal → t("text {x}", { x }). Returns null when it needs manual work. */
  function templateToT(node) {
    if (ts.isNoSubstitutionTemplateLiteral(node)) return hasLetters(node.text) ? tCall(node.text) : null;
    const used = new Set();
    let key = node.head.text;
    const vars = [];
    for (const span of node.templateSpans) {
      const exprText = span.expression.getText(sf);
      if (/===\s*1\s*\?|!==\s*1\s*\?|\?\s*"[a-z]/.test(exprText)) return null; // plural or word choice — do by hand
      const name = placeholderName(span.expression, used);
      vars.push([name, exprText]);
      key += `{${name}}` + span.literal.text;
    }
    return hasLetters(key.replace(/\{\w+\}/g, "")) ? tCall(key, vars) : null;
  }

  function visit(node) {
    // JSX text
    if (ts.isJsxText(node) && hasLetters(node.text)) {
      const raw = src.slice(node.pos, node.end);
      const lead = raw.match(/^\s*/)[0];
      const trail = raw.match(/\s*$/)[0];
      const core = raw.trim().replace(/\s*\n\s*/g, " ");
      const before = lead.includes("\n") ? lead : lead ? `{" "}` : "";
      const after = trail.includes("\n") ? trail : trail ? `{" "}` : "";
      add(node.getStart(sf, false) - 0, node.getEnd(), `${before}{${tCall(core)}}${after}`);
      // getStart for JsxText includes leading trivia handling; use full range
      edits[edits.length - 1].start = node.pos;
      return;
    }
    // Text props
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (ATTRS.has(name)) {
        const init = node.initializer;
        if (ts.isStringLiteral(init) && hasLetters(init.text)) {
          add(init.getStart(sf), init.getEnd(), `{${tCall(init.text)}}`);
          return;
        }
        if (ts.isJsxExpression(init) && init.expression && (ts.isTemplateExpression(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))) {
          const r = templateToT(init.expression);
          if (r) add(init.expression.getStart(sf), init.expression.getEnd(), r);
          else manual.push(`${file}:${sf.getLineAndCharacterOfPosition(init.getStart(sf)).line + 1} ${name}`);
          return;
        }
      }
    }
    // Template literal as a JSX child
    if (ts.isJsxExpression(node) && node.expression && (ts.isTemplateExpression(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression)) && ts.isJsxElement(node.parent)) {
      const r = templateToT(node.expression);
      if (r) add(node.expression.getStart(sf), node.expression.getEnd(), r);
      else manual.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} child`);
      return;
    }
    // UI object properties
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && PROPS.has(node.name.text) && ts.isStringLiteral(node.initializer) && hasLetters(node.initializer.text)) {
      if (insideFunction(node)) add(node.initializer.getStart(sf), node.initializer.getEnd(), tCall(node.initializer.text));
      else add(node.getStart(sf), node.getEnd(), `get ${node.name.text}() {\n    return ${tCall(node.initializer.text)};\n  }`);
      return;
    }
    // toast.*("…", "…") and setError("…")
    if (ts.isCallExpression(node) && CALLS.has(node.expression.getText(sf))) {
      for (const a of node.arguments) {
        if (ts.isStringLiteral(a) && hasLetters(a.text)) add(a.getStart(sf), a.getEnd(), tCall(a.text));
        else if (ts.isTemplateExpression(a) || ts.isNoSubstitutionTemplateLiteral(a)) {
          const r = templateToT(a);
          if (r) add(a.getStart(sf), a.getEnd(), r);
          else manual.push(`${file}:${sf.getLineAndCharacterOfPosition(a.getStart(sf)).line + 1} call`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!edits.length) continue;
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (!/from "@\/i18n"/.test(out)) {
    const lastImport = [...out.matchAll(/^import .*;$/gm)].at(-1);
    const at = lastImport ? lastImport.index + lastImport[0].length : 0;
    out = out.slice(0, at) + (localT ? `
import { t as tr } from "@/i18n";` : `
import { t } from "@/i18n";`) + out.slice(at);
  }
  if (!dry) fs.writeFileSync(file, out);
  console.log(`${file}: ${edits.length} strings`);
}
if (manual.length) console.log("\nNeeds manual translation (plurals / word choice):\n" + manual.join("\n"));
