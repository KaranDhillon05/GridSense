// Registers the TS/alias loader hook before the target script's imports run.
// Use as:  node --import ./scripts/register.mjs scripts/<harness>.mjs
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(resolve(here, "ts-loader.mjs")).href);
