import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import ts from "typescript";

const inputs = process.argv.slice(2);
if (inputs.length < 2) throw new Error("usage: node scripts/inventory-controls.mjs OUTPUT SOURCE...");
const [output, ...sources] = inputs;
const interactive = new Set(["button", "input", "select", "textarea", "summary"]);

const clean = value => value.replace(/\s+/g, " ").trim();
const attr = (node, name, sourceFile) => {
  const item = node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.text === name);
  if (!item || !ts.isJsxAttribute(item)) return null;
  if (!item.initializer) return "true";
  return clean(item.initializer.getText(sourceFile).replace(/^['\"{]|['\"}]$/g, ""));
};
const textContent = (node, sourceFile) => {
  const parent = node.parent;
  if (!ts.isJsxElement(parent)) return "";
  return clean(parent.children.map(child => {
    if (ts.isJsxText(child)) return child.text;
    if (ts.isJsxExpression(child) && child.expression) return child.expression.getText(sourceFile);
    return "";
  }).join(" "));
};
const enclosingLabel = (node, sourceFile) => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(sourceFile) === "label") return textContent(parent.openingElement, sourceFile);
    if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) continue;
    if (!ts.isJsxExpression(parent)) break;
  }
  return "";
};
const conditions = (node, sourceFile) => {
  const found = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isConditionalExpression(parent)) found.push(parent.condition.getText(sourceFile));
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) found.push(parent.left.getText(sourceFile));
    if (ts.isCallExpression(parent) && parent.expression.getText(sourceFile).endsWith(".map")) found.push(`each ${parent.expression.expression.getText(sourceFile)}`);
    if (ts.isFunctionDeclaration(parent) || ts.isSourceFile(parent)) break;
  }
  return [...new Set(found.map(clean))];
};

const rows = [];
for (const source of sources) {
  const path = resolve(source);
  const sourceFile = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const element = node.tagName.getText(sourceFile);
      if (interactive.has(element)) {
        const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const aria = attr(node, "aria-label", sourceFile) ?? attr(node, "aria-labelledby", sourceFile);
        const name = aria || (element === "button" || element === "summary" ? textContent(node, sourceFile) : enclosingLabel(node, sourceFile)) || `DYNAMIC_RENDERED_NAME@${basename(path)}:${location.line + 1}`;
        const signature = `${basename(path)}:${location.line + 1}|${element}|${name}|${attr(node, "role", sourceFile) ?? element}|${conditions(node, sourceFile).join("|")}`;
        rows.push({
          id: `SRC-${createHash("sha1").update(signature).digest("hex").slice(0, 10).toUpperCase()}`,
          source: `${source}:${location.line + 1}`,
          element,
          role: attr(node, "role", sourceFile) ?? (element === "input" ? attr(node, "type", sourceFile) ?? "textbox" : element),
          accessibleNameExpression: name,
          prerequisites: conditions(node, sourceFile),
          disabledExpression: attr(node, "disabled", sourceFile),
          expectedVisibleEffect: element === "button" || element === "summary" ? "Named action or disclosure produces its rendered state change or feedback." : "Rendered value/selection changes visibly and is consumed by the enclosing save or filter action.",
          pointer: "click/select/type as applicable",
          keyboard: element === "textarea" || element === "input" ? "Tab and text/editing keys" : "Tab plus Enter/Space/arrows as applicable",
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}
rows.sort((a, b) => a.source.localeCompare(b.source, undefined, { numeric: true }));
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(resolve(output), `${JSON.stringify({ generatedAt: new Date().toISOString(), sources, count: rows.length, rows }, null, 2)}\n`);
console.log(`Inventoried ${rows.length} JSX control declarations in ${sources.length} source files.`);
