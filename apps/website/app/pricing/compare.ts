import {
  type Catalog,
  capitalize,
  days,
  dollars,
  type Hub,
  type HubId,
  hubMeters,
  hubPrice,
  included,
  type Licensed,
  licensedPrice,
  type Meter,
  meterPrice,
  regionList,
  sentence,
} from "./catalog";
import {
  type FeatureStatus,
  featureStatus,
  hubStatus,
  METER_FEATURES,
  meterStatus,
  notYet,
  works,
} from "./status";

// The comparison under the cards, in the cards' three columns: Free, Add-ons
// and Enterprise. The core rows come first, then the production basics any
// add-on brings and the usage any add-on meters, then a group per add-on that
// works today with its base fee and its meters; its features are in the
// add-on list. An add-on still to come gets one row under What's coming,
// without a price. A feature that doesn't fully work yet carries its status
// (status.ts) beside its label. Free's column says what costs nothing,
// Add-ons' what an add-on includes and costs past that; Enterprise's says
// Custom wherever a price would stand, because Enterprise is quoted, never
// listed. Free and Add-ons are the catalog's plan ids `free` and `pro`.

export type TierId = "free" | "addons" | "enterprise";
export const TIERS: TierId[] = ["free", "addons", "enterprise"];

/** What one tier's column says on a row. */
export type Cell =
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "text"; text: string; notes?: string[] };

export type Row = {
  label: string;
  /** One line under the label that says what the row covers. */
  detail?: string;
  cells: Record<TierId, Cell>;
  /** Name a part of a group before its rows. */
  subgroup?: { title: string };
  /** The catalog meter, hub or licensed line the row prices. */
  source?: string;
  /** Set while it doesn't fully work: the tag beside its label. */
  status?: Exclude<FeatureStatus, "available">;
};

export type Group = {
  id: string;
  title: string;
  rows: Row[];
};

const YES: Cell = { kind: "yes" };
const NO: Cell = { kind: "no" };
const CUSTOM: Cell = text("Custom");
const INCLUDED: Cell = text("Included");

/** What a core platform row covers, keyed by its label in the catalog. */
export const PLATFORM_DETAILS: Record<string, string> = {
  "Versioned releases, previews and rollbacks":
    "A release pins your user schemas, sign-in flows, login branding, identity providers and policies together",
};

function text(value: string, notes: string[] = []): Cell {
  return notes.length > 0 ? { kind: "text", text: value, notes } : { kind: "text", text: value };
}

function every(cell: Cell): Record<TierId, Cell> {
  return { free: cell, addons: cell, enterprise: cell };
}

/** A row nothing free offers: its cell with an add-on and on Enterprise. */
function paid(addons: Cell, enterprise: Cell = addons): Record<TierId, Cell> {
  return { free: NO, addons, enterprise };
}

/** A row's status, set only while it doesn't fully work. */
function tagged(status: FeatureStatus): Pick<Row, "status"> {
  return status === "available" ? {} : { status };
}

/** A feature row: its cells, tagged with its status. */
function featureRow(label: string, cells: Record<TierId, Cell>): Row {
  return { label, cells, ...tagged(featureStatus(label)) };
}

function subgroup(title: string, rows: Row[]): Row[] {
  return rows.map((row, index) => (index === 0 ? { ...row, subgroup: { title } } : row));
}

/**
 * A meter's cell: the free amount under Free, what an add-on includes and
 * costs past it under Add-ons, Custom under Enterprise. The row's group says
 * which add-on.
 */
export function meterCell(meter: Meter, tier: TierId, later: string[] = []): Cell {
  const gaps = later.length > 0 ? [`Not yet: ${later.join(", ")}`] : [];
  if (tier === "enterprise") return text("Custom", gaps);
  if (tier === "free") {
    return meter.free_allowance ? text(included(meter, meter.free_allowance)) : NO;
  }
  const [price = "", ...more] = meterPrice(meter);
  if (meter.allowance) {
    return text(`${included(meter, meter.allowance)} included`, [
      `Then ${price}`,
      ...more,
      ...gaps,
    ]);
  }
  return text(price, [...more, ...gaps]);
}

/** What an add-on still to come says where a price would stand. */
export const NOT_PRICED = "Not priced yet";

/** An add-on still to come: no price until it is Coming next, then its planned one. */
export function comingCell(hub: Hub, tier: TierId): Cell {
  if (tier === "enterprise") {
    return text(hub.pricing === "quoted" ? "Custom quote" : "In the commitment");
  }
  if (tier === "free" || !hub.plans.includes("pro")) return NO;
  if (hubStatus(hub) === "next" && hub.base.amount !== null) {
    return text(`Planned: ${hubPrice(hub)} / ${hub.base.interval}`);
  }
  return text(NOT_PRICED);
}

/** A line billed on top: its price with an add-on, Included where Enterprise has it. */
export function lineCell(line: Licensed, tier: TierId): Cell {
  if (tier === "enterprise") {
    if (line.included_in?.includes("enterprise")) return INCLUDED;
    return line.plans.includes("enterprise") ? CUSTOM : NO;
  }
  if (tier === "free" || !line.plans.includes("pro")) return NO;
  // A listed line says what its price buys.
  return text(licensedPrice(line), line.note && line.amount !== null ? [sentence(line.note)] : []);
}

/** A row with one more note under its Add-ons cell. */
function noted(row: Row, note: string): Row {
  const { addons } = row.cells;
  if (addons.kind !== "text") return row;
  return {
    ...row,
    cells: { ...row.cells, addons: text(addons.text, [...(addons.notes ?? []), note]) },
  };
}

/** The hub's base fee row. */
export function hubBaseCell(hub: Hub, tier: TierId): Cell {
  if (tier === "enterprise") {
    return text(hub.pricing === "quoted" ? "Custom quote" : "In the commitment");
  }
  if (tier === "free" || !hub.plans.includes("pro")) return NO;
  return text(`${hubPrice(hub)} / ${hub.base.interval}`);
}

/** The comparison's groups, in the order the page shows them. */
export function compareGroups(catalog: Catalog): Group[] {
  const { free, pro, enterprise } = catalog.plans;
  const meters = new Map(catalog.meters.map((meter) => [meter.id, meter]));
  const lines = new Map(catalog.licensed.map((line) => [line.id, line]));
  const hubs = new Map(catalog.hubs.map((hub) => [hub.id, hub]));
  const placed = new Set<string>();

  function meter(id: string): Meter {
    const found = meters.get(id);
    if (!found) throw new Error(`The price list has no meter ${id} (app/pricing/compare.ts).`);
    placed.add(id);
    return found;
  }
  function line(id: string): Licensed {
    const found = lines.get(id);
    if (!found) throw new Error(`The price list has no line ${id} (app/pricing/compare.ts).`);
    placed.add(id);
    return found;
  }
  const byTier = (cell: (tier: TierId) => Cell): Record<TierId, Cell> => ({
    free: cell("free"),
    addons: cell("addons"),
    enterprise: cell("enterprise"),
  });
  const meterRow = (id: string, label?: string): Row => {
    const found = meter(id);
    const status = meterStatus(found, catalog);
    // A meter that partly works names the features it counts that don't yet.
    const later = status === "partial" ? notYet(found) : [];
    const row: Row = {
      label: label ?? found.label,
      cells: byTier((tier) => meterCell(found, tier, later)),
      source: id,
      ...tagged(status),
    };
    // An add-on that includes more of a shared meter says so.
    return Object.entries(found.hub_allowance ?? {}).reduce(
      (result, [hubId, amount]) =>
        noted(
          result,
          `${included(found, amount)} included with ${hubs.get(hubId as HubId)?.label ?? hubId}`,
        ),
      row,
    );
  };
  const lineRow = (id: string, label?: string): Row => {
    const found = line(id);
    return {
      label: label ?? found.label,
      cells: byTier((tier) => lineCell(found, tier)),
      source: id,
    };
  };
  // An add-on's features are in the add-on list; here are only what it costs.
  const hubGroup = (hub: Hub): Group => ({
    id: `hub-${hub.id}`,
    title: `${hub.label} add-on`,
    rows: [
      {
        label: "Base fee",
        source: hub.id,
        cells: byTier((tier) => hubBaseCell(hub, tier)),
      },
      ...hubMeters(catalog, hub.id).map((entry) => meterRow(entry.id)),
    ],
  });
  // An add-on still to come is one row, its meters unpriced with it.
  const comingRow = (hub: Hub): Row => {
    for (const entry of hubMeters(catalog, hub.id)) placed.add(entry.id);
    return {
      label: `${hub.label} add-on`,
      detail: hub.line,
      source: hub.id,
      cells: byTier((tier) => comingCell(hub, tier)),
      ...tagged(hubStatus(hub)),
    };
  };
  const working = catalog.hubs.filter((hub) => works(hubStatus(hub)));
  const coming = catalog.hubs.filter((hub) => !works(hubStatus(hub)));

  const mau = meter("monthly_active_users");
  const perSecond = (plan: typeof free | typeof pro) =>
    `Up to ${plan.limits.requests_per_second_per_project} a second per project`;
  // The usage every add-on meters. A basic one of them counts shows as its meter's row, once.
  const usage = ["email_messages", "sms_messages", "verified_bot_checks", "custom_domains"];
  const platform = ["m2m_tokens", "authz_checks", "siem_sinks"];
  const metered = new Set(usage.flatMap((id) => METER_FEATURES[id] ?? []));

  const groups: Group[] = [
    {
      id: "core",
      title: "Included in every account",
      rows: [
        { label: "Monthly active users", source: mau.id, cells: every(text("Never billed")) },
        ...catalog.core.resources.map((label) => featureRow(label, every(text("Unlimited")))),
        ...catalog.core.platform.map((label) => ({
          ...featureRow(label, every(YES)),
          ...(PLATFORM_DETAILS[label] ? { detail: PLATFORM_DETAILS[label] } : {}),
        })),
        {
          label: "Region, chosen per project",
          cells: {
            free: text(regionList(free.regions.selection)),
            addons: text(regionList(pro.regions.selection)),
            enterprise: text(regionList(enterprise.regions.selection)),
          },
        },
        ...subgroup(
          "Sign-in",
          catalog.core.authentication.map((label) => featureRow(label, every(YES))),
        ),
        ...subgroup(
          "Protection",
          catalog.core.security.map((label) => featureRow(label, every(YES))),
        ),
      ],
    },
    {
      id: "every-hub",
      title: "Production basics, with any add-on",
      rows: [
        ...catalog.hub_includes
          .filter((label) => !metered.has(label))
          .map((label) => featureRow(label, paid(YES))),
        {
          label: "Dev inbox or your own email provider",
          cells: every(YES),
        },
      ],
    },
    {
      id: "usage",
      title: "Usage, with any add-on",
      rows: [...usage, ...platform].map((id) => meterRow(id)),
    },
    ...working.map(hubGroup),
    {
      id: "capacity",
      title: "Capacity",
      rows: [
        {
          label: "API requests",
          cells: {
            free: text("Never billed", [perSecond(free)]),
            addons: text("Never billed", [perSecond(pro)]),
            enterprise: CUSTOM,
          },
        },
        lineRow("extra_capacity"),
        lineRow("dedicated_infrastructure"),
      ],
    },
    {
      id: "audit",
      title: "Audit & compliance",
      rows: [
        {
          label: "Audit log retention",
          cells: {
            free: text(days(free.event_retention_days)),
            addons: text(days(pro.event_retention_days)),
            enterprise: text(days(enterprise.event_retention_days)),
          },
        },
        // Compliance is part of Enterprise, never an add-on of its own.
        ...enterprise.compliance.map((label) => ({
          label,
          cells: paid(NO, INCLUDED),
          ...tagged(featureStatus(label)),
        })),
      ],
    },
    {
      id: "support",
      title: "Support & agreements",
      rows: [
        {
          label: "Support",
          cells: {
            free: text(capitalize(free.support)),
            addons: text(capitalize(pro.support)),
            enterprise: text(capitalize(enterprise.support)),
          },
        },
        lineRow("support_priority"),
        lineRow("tam_hours"),
        lineRow("private_slack"),
        {
          label: "Uptime commitment",
          cells: {
            free: free.sla ? text(`${free.sla.target_percent}% target`) : NO,
            addons: pro.sla
              ? text(`${pro.sla.target_percent}% target`, ["No service credits"])
              : NO,
            enterprise: enterprise.sla
              ? text(`${enterprise.sla.target_percent}% SLA`, ["With service credits"])
              : NO,
          },
        },
        lineRow("sla_9999", "99.99% uptime SLA"),
        lineRow("private_keys"),
        lineRow("addendum"),
      ],
    },
  ];
  if (coming.length > 0) {
    groups.push({ id: "coming", title: "What's coming", rows: coming.map(comingRow) });
  }

  // A meter or line the groups above do not place still shows, under Other,
  // until it gets a group; the spec fails while any does.
  const rest: Row[] = [
    ...catalog.meters
      .filter((candidate) => !placed.has(candidate.id))
      .map((candidate) => meterRow(candidate.id)),
    ...catalog.licensed
      .filter((candidate) => !placed.has(candidate.id))
      .map((candidate) => lineRow(candidate.id)),
  ];
  if (rest.length > 0) groups.push({ id: "other", title: "Other", rows: rest });
  return groups;
}

/** The lowest base fee of the listed add-ons that work today, at least in part. */
export function lowestHub(catalog: Catalog): string {
  const amounts = catalog.hubs.flatMap((hub) =>
    hub.pricing === "listed" && hub.base.amount !== null && works(hubStatus(hub))
      ? [hub.base.amount]
      : [],
  );
  return dollars(Math.min(...amounts));
}
