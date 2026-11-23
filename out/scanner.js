"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.findComponents = findComponents;
const ts = __importStar(require("typescript"));
const isCap = (n) => /^[A-Z]/.test(n);
const hasMod = (n, k) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === k);
function looksLikeComponent(e, sf) {
    while (ts.isParenthesizedExpression(e))
        e = e.expression;
    if (ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isClassExpression(e))
        return true;
    if (ts.isCallExpression(e))
        return /(memo|forwardRef|observer|styled)/.test(e.expression.getText(sf));
    return false;
}
function findComponents(fileName, text) {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    const out = [];
    const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
    for (const st of sf.statements) {
        if (ts.isFunctionDeclaration(st) && hasMod(st, ts.SyntaxKind.ExportKeyword)) {
            const name = st.name?.text;
            if (hasMod(st, ts.SyntaxKind.DefaultKeyword)) {
                if (isCap(name ?? 'Default'))
                    out.push({ exportName: 'default', name: name ?? 'Default', line: lineOf(st) });
            }
            else if (name && isCap(name)) {
                out.push({ exportName: name, name, line: lineOf(st) });
            }
        }
        else if (ts.isVariableStatement(st) && hasMod(st, ts.SyntaxKind.ExportKeyword)) {
            for (const d of st.declarationList.declarations) {
                if (ts.isIdentifier(d.name) && isCap(d.name.text) && d.initializer && looksLikeComponent(d.initializer, sf)) {
                    out.push({ exportName: d.name.text, name: d.name.text, line: lineOf(st) });
                }
            }
        }
        else if (ts.isClassDeclaration(st) && hasMod(st, ts.SyntaxKind.ExportKeyword) && st.name && isCap(st.name.text)) {
            const isDef = hasMod(st, ts.SyntaxKind.DefaultKeyword);
            out.push({ exportName: isDef ? 'default' : st.name.text, name: st.name.text, line: lineOf(st) });
        }
        else if (ts.isExportAssignment(st) && !st.isExportEquals) {
            const e = st.expression;
            if (ts.isIdentifier(e) ? isCap(e.text) : looksLikeComponent(e, sf)) {
                out.push({ exportName: 'default', name: ts.isIdentifier(e) ? e.text : 'Default', line: lineOf(st) });
            }
        }
    }
    return out;
}
//# sourceMappingURL=scanner.js.map