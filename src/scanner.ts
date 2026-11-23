import * as ts from 'typescript';

export interface FoundComponent {
  exportName: string; // 'default' or the named export
  name: string;       // display name
  line: number;
}

const isCap = (n: string) => /^[A-Z]/.test(n);
const hasMod = (n: ts.Node, k: ts.SyntaxKind) =>
  ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === k);

function looksLikeComponent(e: ts.Expression, sf: ts.SourceFile): boolean {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isClassExpression(e)) return true;
  if (ts.isCallExpression(e)) return /(memo|forwardRef|observer|styled)/.test(e.expression.getText(sf));
  return false;
}

export function findComponents(fileName: string, text: string): FoundComponent[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const out: FoundComponent[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && hasMod(st, ts.SyntaxKind.ExportKeyword)) {
      const name = st.name?.text;
      if (hasMod(st, ts.SyntaxKind.DefaultKeyword)) {
        if (isCap(name ?? 'Default')) out.push({ exportName: 'default', name: name ?? 'Default', line: lineOf(st) });
      } else if (name && isCap(name)) {
        out.push({ exportName: name, name, line: lineOf(st) });
      }
    } else if (ts.isVariableStatement(st) && hasMod(st, ts.SyntaxKind.ExportKeyword)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && isCap(d.name.text) && d.initializer && looksLikeComponent(d.initializer, sf)) {
          out.push({ exportName: d.name.text, name: d.name.text, line: lineOf(st) });
        }
      }
    } else if (ts.isClassDeclaration(st) && hasMod(st, ts.SyntaxKind.ExportKeyword) && st.name && isCap(st.name.text)) {
      const isDef = hasMod(st, ts.SyntaxKind.DefaultKeyword);
      out.push({ exportName: isDef ? 'default' : st.name.text, name: st.name.text, line: lineOf(st) });
    } else if (ts.isExportAssignment(st) && !st.isExportEquals) {
      const e = st.expression;
      if (ts.isIdentifier(e) ? isCap(e.text) : looksLikeComponent(e, sf)) {
        out.push({ exportName: 'default', name: ts.isIdentifier(e) ? e.text : 'Default', line: lineOf(st) });
      }
    }
  }
  return out;
}
