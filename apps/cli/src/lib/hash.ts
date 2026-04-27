import { createHash } from "node:crypto";

import { stableStringify } from "./json";

export function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}
