import ts from "typescript";
import { readFileSync, writeFileSync, globSync } from "node:fs";

const KEYS = new Set([
  "message",
  "pretty",
  "title",
  "reason",
  "hint",
  "description",
  "summary",
  "label",
  "empty",
  "heading",
  "detail",
  "text",
  "placeholder",
  "boxTitle",
  "problem",
  "note",
]);
const CALLS =
  /^(consola\.(info|success|start|warn|error|log|ready|fail|box|debug)|reportWarning|refuse|refusal)$/;
const files = globSync("src/**/*.ts").sort();
const out = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const textOf = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node))
      return [node.head.text, ...node.templateSpans.map((s) => "${_}" + s.literal.text)].join("");
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = textOf(node.left),
        r = textOf(node.right);
      if (l !== undefined && r !== undefined) return l + r;
    }
    return undefined;
  };
  const push = (ctx, node) => {
    const t = textOf(node);
    if (t === undefined || !/\s/.test(t)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push(`${file}:${line + 1}\t${ctx}\t${JSON.stringify(t)}`);
  };
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && KEYS.has(node.name.text)) {
      push(node.name.text, node.initializer);
    } else if (
      ts.isPropertyDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      KEYS.has(node.name.text) &&
      node.initializer
    ) {
      push(node.name.text, node.initializer);
    } else if (ts.isCallExpression(node)) {
      const fn = node.expression.getText(sf);
      if (CALLS.test(fn)) for (const a of node.arguments) push(fn, a);
      if (
        /^(this\.note|w\.note|wizard\.note|ui\.note|chain\.note|report\.(done|skipped|warning)|step\.(done|detail|fail))$/.test(
          fn,
        )
      )
        for (const a of node.arguments) push(fn, a);
      if (/ZitadelError$/.test(fn))
        node.arguments.forEach((a, i) => {
          if (i === 1) push("ZitadelError", a);
        });
    } else if (
      ts.isNewExpression(node) &&
      node.expression.getText(sf) === "ZitadelError" &&
      node.arguments
    ) {
      node.arguments.forEach((a, i) => {
        if (i === 1) push("ZitadelError", a);
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
writeFileSync(process.argv[2], out.join("\n") + "\n");
console.log(out.length);
