/**
 * What remains of the resource-sync module after `deploy` replaced `plan` and
 * `apply`. The sync loop, its plan renderer and the per-kind syncers are gone;
 * publishing is now the release pipeline under `lib/release/`. What stays is the
 * scaffold store (`state.ts`, imported directly) and the hashing/write-back
 * helpers that `setup-resources.ts` uses to materialise a project's files —
 * setup, not deploy, is what writes `.zitadel/`.
 */
export { hashForState, writeBackResource } from "./writeback";
