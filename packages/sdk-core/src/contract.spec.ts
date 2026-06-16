import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ZITADEL_LOGIN_EVENTS, ZITADEL_LOGOUT_EVENTS } from './types.js';

/**
 * The element↔contract drift guard.
 *
 * The `<zitadel-login>` / `<zitadel-logout>` orchestrator elements in
 * `@zitadel/components` emit their widget events as bare string literals
 * (`emit(this, "zitadel-…")`). This test scans that source and asserts the set
 * of emitted `zitadel-*` events is EXACTLY the set declared in the SPA contract
 * ({@link ZITADEL_LOGIN_EVENTS} + {@link ZITADEL_LOGOUT_EVENTS}). Adding or
 * removing an `emit(...)` in the element therefore fails here until the contract
 * is updated to match — and updating the contract in turn forces every SDK
 * (via their contract-driven forwarding tests) to wire or drop the event.
 */
const orchestratorDir = fileURLToPath(
  new URL('../../components/src/orchestrator/', import.meta.url),
);

function emittedWidgetEvents(): string[] {
  const events = new Set<string>();
  for (const file of readdirSync(orchestratorDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) {
      continue;
    }
    const source = readFileSync(`${orchestratorDir}${file}`, 'utf8');
    for (const match of source.matchAll(
      /emit\(\s*this\s*,\s*["'](zitadel-[a-z-]+)["']/g,
    )) {
      const name = match[1];
      if (name) {
        events.add(name);
      }
    }
  }
  return [...events].sort();
}

describe('SPA widget contract ↔ @zitadel/components', () => {
  it('declares exactly the events the orchestrator elements emit', () => {
    const declared = [...ZITADEL_LOGIN_EVENTS, ...ZITADEL_LOGOUT_EVENTS].sort();
    expect(emittedWidgetEvents()).toEqual(declared);
  });
});
