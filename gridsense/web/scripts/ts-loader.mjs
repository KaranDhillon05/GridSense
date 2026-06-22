// Minimal Node ESM loader so dev scripts can import the REAL sim engine (.ts)
// without adding a bundler. Resolves the "@/*" -> "./src/*" tsconfig alias,
// transpiles .ts/.tsx on the fly with the installed TypeScript compiler, and
// lets .json imports through. Dev-only; never part of the Next build.
//
// Used as the customization for `module.register` (see register.mjs).

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";
import { readFileSync, existsSync, statSync } from "node:fs";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = pathResolve(here, "..", "src");

// TS source uses extensionless imports ("./network", "@/lib/sim/types"). Probe
// the same candidates tsc/Next would: exact, +.ts/.tsx/.json, /index.ts.
function probe(absNoExt) {
  if (existsSync(absNoExt) && statSync(absNoExt).isFile()) return absNoExt;
  for (const ext of [".ts", ".tsx", ".json", ".mjs", ".js"]) {
    if (existsSync(absNoExt + ext)) return absNoExt + ext;
  }
  for (const idx of ["/index.ts", "/index.tsx", "/index.js"]) {
    if (existsSync(absNoExt + idx)) return absNoExt + idx;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let absBase = null;
  if (specifier.startsWith("@/")) {
    absBase = pathResolve(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    if (context.parentURL && context.parentURL.startsWith("file:")) {
      absBase = pathResolve(dirname(fileURLToPath(context.parentURL)), specifier);
    }
  }
  if (absBase) {
    const hit = probe(absBase);
    if (hit) return nextResolve(pathToFileURL(hit).href, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    const json = readFileSync(fileURLToPath(url), "utf8");
    return {
      format: "module",
      source: `export default ${json};`,
      shortCircuit: true,
    };
  }
  if (url.endsWith(".ts") || url.endsWith(".tsx")) {
    const path = fileURLToPath(url);
    const source = readFileSync(path, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.Preserve,
        verbatimModuleSyntax: false,
      },
      fileName: path,
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
