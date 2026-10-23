import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  CLI_COMMAND_COMPLETED,
  CLI_COMMAND_FAILED,
  CLI_COMMAND_STARTED,
  commandEventProperties,
  deviceProfileProperties,
} from "../../../../src/lib/oclif/command-telemetry";
import type { GlobalOptions } from "../../../../src/lib/oclif/types";

/**
 * `docs/product-analytics-events.yaml` is the contract for what the CLI may
 * send. Reading the sources rather than running the commands is deliberate:
 * consent gates the transport, so a command test proves nothing about what an
 * event or a dimension is *called*, which is the part that reaches the
 * analytics tools and cannot be renamed later without breaking saved reports.
 */
const catalogPath = join(
  import.meta.dirname,
  "../../../../../../docs/product-analytics-events.yaml",
);
const srcDir = join(import.meta.dirname, "../../../../src");
const commandsDir = join(srcDir, "commands");
const baseCommand = join(srcDir, "lib/oclif/base.ts");

type PropertyDef = {
  type: string;
  values?: unknown[];
  description: string;
};

type EventDef = {
  status: string;
  plan?: string;
  trigger: string;
  destinations: string[];
  include?: string[];
  properties?: string[];
};

type Catalog = {
  properties: Record<string, PropertyDef>;
  groups: Record<string, { description: string; properties: string[] }>;
  components: Record<
    string,
    {
      source: string;
      automatic?: string[];
      events: Record<string, EventDef>;
      dimensions?: Record<string, string[]>;
      profile?: { trigger: string; destinations: string[]; properties: string[] };
    }
  >;
};

async function loadCatalog(): Promise<Catalog> {
  return parse(await readFile(catalogPath, "utf8")) as Catalog;
}

/** An event's properties, its groups' included. */
function eventProperties(catalog: Catalog, event: EventDef): string[] {
  return [
    ...(event.include ?? []).flatMap((group) => catalog.groups[group]?.properties ?? []),
    ...(event.properties ?? []),
  ];
}

function cliOf(catalog: Catalog) {
  const cli = catalog.components.cli;
  if (!cli) {
    throw new Error("the catalog has no cli component");
  }
  return cli;
}

/** The keys an object literal names, spreads left out. */
function literalKeys(node: ts.Expression | undefined): string[] {
  if (!node || !ts.isObjectLiteralExpression(node)) {
    return [];
  }
  return node.properties.flatMap((property) => {
    if (ts.isShorthandPropertyAssignment(property)) {
      return [property.name.text];
    }
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ) {
      return [property.name.text];
    }
    return [];
  });
}

/** Every call in `file` that `matches` accepts. */
async function callsIn(
  file: string,
  matches: (call: ts.CallExpression) => boolean,
): Promise<ts.CallExpression[]> {
  const source = ts.createSourceFile(
    file,
    await readFile(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && matches(node)) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

function calls(name: string): (call: ts.CallExpression) => boolean {
  return (call) =>
    ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === name;
}

/** The command id oclif gives a file under `src/commands`, such as `variables:set`. */
function commandId(file: string): string {
  const segments = file.replace(/\.ts$/, "").split(sep);
  if (segments.at(-1) === "index") {
    segments.pop();
  }
  return segments.join(":");
}

/** The dimensions each command passes to `recordTelemetry`, by command id. */
async function recordedDimensions(): Promise<Map<string, Set<string>>> {
  const files = (await readdir(commandsDir, { recursive: true })).filter((file) =>
    file.endsWith(".ts"),
  );
  const recorded = new Map<string, Set<string>>();
  for (const file of files) {
    const keys = (await callsIn(join(commandsDir, file), calls("recordTelemetry"))).flatMap(
      (call) => literalKeys(call.arguments[0]),
    );
    if (keys.length > 0) {
      const id = commandId(file);
      recorded.set(id, new Set([...(recorded.get(id) ?? []), ...keys]));
    }
  }
  return recorded;
}

/** Each lifecycle event, by the constant `BaseCommand` tracks it with. */
const LIFECYCLE_EVENTS = [
  ["CLI_COMMAND_STARTED", CLI_COMMAND_STARTED],
  ["CLI_COMMAND_COMPLETED", CLI_COMMAND_COMPLETED],
  ["CLI_COMMAND_FAILED", CLI_COMMAND_FAILED],
] as const;

/** The properties `BaseCommand` adds to `commandEventProperties` where it tracks `constant`. */
async function lifecycleExtras(constant: string): Promise<string[]> {
  const tracks = await callsIn(
    baseCommand,
    (call) =>
      calls("track")(call) &&
      call.arguments[0] !== undefined &&
      ts.isIdentifier(call.arguments[0]) &&
      call.arguments[0].text === constant,
  );
  return tracks.flatMap((track) => {
    const bag = track.arguments[1];
    return bag && ts.isCallExpression(bag) ? literalKeys(bag.arguments[2]) : [];
  });
}

function meta(): GlobalOptions {
  return {
    cwd: "/work/app",
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "setup",
    cliVersion: "0.1.0",
    source: "https://api.zitadel.cloud",
    verbose: false,
    debug: false,
    env: {},
    isTTY: false,
  };
}

/** `Telemetry.track` stamps these on every event. */
const STAMPED = ["distinct_id", "$insert_id"];

describe("product analytics catalog", () => {
  it("defines every property and group its events, dimensions and profiles use", async () => {
    const catalog = await loadCatalog();
    for (const [component, { events, dimensions, profile }] of Object.entries(catalog.components)) {
      for (const [name, event] of Object.entries(events)) {
        for (const group of event.include ?? []) {
          expect(catalog.groups[group], `${component}.${name} includes ${group}`).toBeDefined();
        }
        for (const property of eventProperties(catalog, event)) {
          expect(
            catalog.properties[property],
            `${component}.${name} uses ${property}`,
          ).toBeDefined();
        }
      }
      for (const [command, keys] of Object.entries(dimensions ?? {})) {
        for (const key of keys) {
          expect(catalog.properties[key], `${component} ${command} records ${key}`).toBeDefined();
        }
      }
      for (const key of profile?.properties ?? []) {
        expect(catalog.properties[key], `${component}'s profile sends ${key}`).toBeDefined();
      }
    }
  });

  it("types and describes every property", async () => {
    const catalog = await loadCatalog();
    for (const [name, property] of Object.entries(catalog.properties)) {
      expect(["string", "number", "boolean", "list"], `${name}'s type`).toContain(property.type);
      expect(property.description, `${name} has no description`).toBeTruthy();
      if (property.values !== undefined) {
        expect(property.values.length, `${name} lists no values`).toBeGreaterThan(0);
      }
      // Mixpanel's own properties keep its `$` and `mp_` prefixes.
      expect(name, `${name} is not snake_case`).toMatch(/^(\$|mp_)?[a-z][a-z0-9_]*$/);
    }
  });

  it("marks every event emitted or planned, with the ticket that plans it", async () => {
    const catalog = await loadCatalog();
    for (const [component, { events }] of Object.entries(catalog.components)) {
      for (const [name, event] of Object.entries(events)) {
        expect(name, `${component}.${name} is not snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(["emitted", "planned"], `${component}.${name}'s status`).toContain(event.status);
        if (event.status === "planned") {
          expect(event.plan, `${component}.${name} names no ticket`).toMatch(/^#\d+$/);
        }
        expect(event.trigger, `${component}.${name} has no trigger`).toBeTruthy();
        expect(event.destinations.length, `${component}.${name} goes nowhere`).toBeGreaterThan(0);
        for (const destination of event.destinations) {
          expect(["mixpanel", "vercel"], `${component}.${name} goes to ${destination}`).toContain(
            destination,
          );
        }
      }
    }
  });
});

describe("CLI telemetry against the catalog", () => {
  it("emits only lifecycle events the catalog lists as emitted", async () => {
    const { events } = cliOf(await loadCatalog());
    for (const [, event] of LIFECYCLE_EVENTS) {
      expect(events[event]?.status, `${event} is not in the catalog as emitted`).toBe("emitted");
    }
  });

  it("sends exactly the properties the catalog lists on each lifecycle event", async () => {
    const catalog = await loadCatalog();
    const { events } = cliOf(catalog);
    const base = [...Object.keys(commandEventProperties(meta(), "invocation-1")), ...STAMPED];
    for (const [constant, event] of LIFECYCLE_EVENTS) {
      const definition = events[event];
      if (!definition) {
        throw new Error(`${event} is not in the catalog`);
      }
      const sent = new Set([...base, ...(await lifecycleExtras(constant))]);
      expect(new Set(eventProperties(catalog, definition)), event).toEqual(sent);
    }
  });

  it("records only the dimensions the catalog lists for each command", async () => {
    const catalog = await loadCatalog();
    const cli = cliOf(catalog);
    const lifecycle = catalog.groups.cli_lifecycle?.properties ?? [];
    for (const [command, keys] of await recordedDimensions()) {
      const listed = cli.dimensions?.[command] ?? [];
      for (const key of keys) {
        expect(
          [...listed, ...lifecycle],
          `${command} records ${key}, which the catalog does not list`,
        ).toContain(key);
      }
    }
  });

  it("lists no dimension a command does not record", async () => {
    const recorded = await recordedDimensions();
    for (const [command, keys] of Object.entries(cliOf(await loadCatalog()).dimensions ?? {})) {
      for (const key of keys) {
        expect([...(recorded.get(command) ?? [])], `${command} never records ${key}`).toContain(
          key,
        );
      }
    }
  });

  it("sends exactly the properties the catalog lists on the install profile", async () => {
    const { profile } = cliOf(await loadCatalog());
    const sent = Object.keys(deviceProfileProperties(meta(), "09233195-cd34-468c"));
    expect(new Set(profile?.properties)).toEqual(new Set(sent));
  });
});
