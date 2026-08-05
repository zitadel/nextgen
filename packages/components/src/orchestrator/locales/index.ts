/**
 * Built-in locale registry.
 *
 * Re-exports the individual dictionaries and provides a `builtinLocales`
 * map so the orchestrator can resolve a BCP 47 language tag to the
 * matching dictionary at runtime.
 */
export { en, type Locale } from "./en.js";
export { de } from "./de.js";
export { it } from "./it.js";
export { businessLocales } from "./business.js";

import { en, type Locale } from "./en.js";
import { de } from "./de.js";
import { it } from "./it.js";

export const builtinLocales: Readonly<Record<string, Locale>> = { en, de, it };
