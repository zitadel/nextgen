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
  VERCEL_COMMAND_DIMENSIONS,
  vercelEventKeys,
} from "../../../../src/lib/oclif/command-telemetry";
import type { GlobalOptions } from "../../../../src/lib/oclif/types";
import { VERCEL_MAX_PROPERTIES } from "../../../../src/lib/telemetry/vercel";

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
  properties?: string[];
};

type Component = {
  source: string;
  automatic?: string[];
  context?: string[];
  vercel?: { properties?: string[]; dimensions?: Record<string, string> };
  events: Record<string, EventDef>;
  dimensions?: Record<string, string[]>;
  profile?: { trigger: string; destinations: string[]; properties: string[] };
};

type Catalog = {
  header: { properties: string[]; except?: Record<string, string[]> };
  properties: Record<string, PropertyDef>;
  components: Record<string, Component>;
};

async function loadCatalog(): Promise<Catalog> {
  return parse(await readFile(catalogPath, "utf8")) as Catalog;
}

/** Stands for a command's own dimension among the properties a Vercel copy keeps. */
const DIMENSION = "<dimension>";

/** The header `component` sends: `<surface>` stands for the component. */
function headerOf(catalog: Catalog, component: string): string[] {
  const except = catalog.header.except?.[component] ?? [];
  return catalog.header.properties
    .map((property) => property.replace("<surface>", component))
    .filter((property) => !except.includes(property));
}

/** What an event of `component` carries: the header, the component's context and its own properties. */
function eventProperties(catalog: Catalog, component: string, event: EventDef): string[] {
  return [
    ...headerOf(catalog, component),
    ...(catalog.components[component]?.context ?? []),
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
  it("names every component as a surface", async () => {
    const catalog = await loadCatalog();
    expect(new Set(catalog.properties.surface?.values)).toEqual(
      new Set(Object.keys(catalog.components)),
    );
  });

  it("excepts only header properties, and only for its components", async () => {
    const catalog = await loadCatalog();
    for (const [component, properties] of Object.entries(catalog.header.except ?? {})) {
      expect(catalog.components[component], `the header excepts ${component}`).toBeDefined();
      for (const property of properties) {
        expect(catalog.header.properties, `${component} is excepted from ${property}`).toContain(
          property,
        );
      }
    }
  });

  it("defines every property its headers, contexts, events, dimensions and profiles use", async () => {
    const catalog = await loadCatalog();
    for (const [component, { context, events, dimensions, profile }] of Object.entries(
      catalog.components,
    )) {
      for (const property of [...headerOf(catalog, component), ...(context ?? [])]) {
        expect(catalog.properties[property], `${component} sends ${property}`).toBeDefined();
      }
      for (const [name, event] of Object.entries(events)) {
        for (const property of event.properties ?? []) {
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

  it("lists header and context properties once, never again in an event's body", async () => {
    const catalog = await loadCatalog();
    for (const [component, { context, events }] of Object.entries(catalog.components)) {
      const header = headerOf(catalog, component);
      for (const property of context ?? []) {
        expect(header, `${component}'s context repeats ${property}`).not.toContain(property);
      }
      const shared = [...header, ...(context ?? [])];
      for (const [name, event] of Object.entries(events)) {
        for (const property of event.properties ?? []) {
          expect(shared, `${component}.${name} repeats ${property}`).not.toContain(property);
        }
      }
    }
  });

  it("keeps the header of every Vercel copy within Vercel's limit", async () => {
    const catalog = await loadCatalog();
    for (const [component, { events, vercel }] of Object.entries(catalog.components)) {
      const copied = Object.entries(events).filter(([, event]) =>
        event.destinations.includes("vercel"),
      );
      for (const [name, event] of copied) {
        const kept = vercel?.properties ?? eventProperties(catalog, component, event);
        // Only a command's own dimension may push a listed property out.
        expect(
          kept.filter((key) => key !== DIMENSION).length,
          `${component}.${name}'s Vercel copy`,
        ).toBeLessThanOrEqual(VERCEL_MAX_PROPERTIES);
        expect(
          kept.slice(0, VERCEL_MAX_PROPERTIES),
          `${component}.${name}'s Vercel copy drops the header`,
        ).toEqual(expect.arrayContaining(headerOf(catalog, component)));
      }
      for (const key of (vercel?.properties ?? []).filter((key) => key !== DIMENSION)) {
        expect(
          copied.some(([, event]) => eventProperties(catalog, component, event).includes(key)),
          `${component}'s Vercel copy keeps ${key}, which none of its events carry`,
        ).toBe(true);
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

  it("sends the header on every lifecycle event, with cli as its surface", async () => {
    const header = headerOf(await loadCatalog(), "cli");
    const sent = commandEventProperties(meta(), "invocation-1");
    expect(Object.keys(sent)).toEqual(expect.arrayContaining(header));
    expect(sent.surface).toBe("cli");
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
      expect(new Set(eventProperties(catalog, "cli", definition)), event).toEqual(sent);
    }
  });

  it("copies every lifecycle event to Vercel as the catalog lists it", async () => {
    const { events, vercel } = cliOf(await loadCatalog());
    for (const [, event] of LIFECYCLE_EVENTS) {
      expect(events[event]?.destinations, event).toContain("vercel");
    }
    expect(Object.fromEntries(VERCEL_COMMAND_DIMENSIONS)).toEqual(vercel?.dimensions ?? {});
    for (const command of [...VERCEL_COMMAND_DIMENSIONS.keys(), "variable:list"]) {
      const dimension = VERCEL_COMMAND_DIMENSIONS.get(command);
      const listed = (vercel?.properties ?? []).flatMap((key) =>
        key !== DIMENSION ? [key] : dimension === undefined ? [] : [dimension],
      );
      expect(vercelEventKeys(command), command).toEqual(listed);
    }
  });

  it("copies to Vercel only a dimension the command records, of a type the copy sends", async () => {
    const catalog = await loadCatalog();
    const cli = cliOf(catalog);
    for (const [command, dimension] of Object.entries(cli.vercel?.dimensions ?? {})) {
      expect(
        cli.dimensions?.[command],
        `${command} copies ${dimension} without recording it`,
      ).toContain(dimension);
      expect(["string", "number", "boolean"], `${command} copies ${dimension}`).toContain(
        catalog.properties[dimension]?.type,
      );
    }
  });

  it("records only the dimensions the catalog lists for each command", async () => {
    const catalog = await loadCatalog();
    const cli = cliOf(catalog);
    const shared = [...headerOf(catalog, "cli"), ...(cli.context ?? [])];
    for (const [command, keys] of await recordedDimensions()) {
      const listed = cli.dimensions?.[command] ?? [];
      for (const key of keys) {
        expect(
          [...listed, ...shared],
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
