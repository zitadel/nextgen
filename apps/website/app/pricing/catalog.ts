import { readFileSync } from "node:fs";
import { join } from "node:path";

import { count, dollars } from "./format";

export { count, dollars };

// The pricing page's data: the cloud's proposed price list, read from the
// repository when the site builds. apps/cloud-functions bills from the same
// file (src/pricing/catalog.ts), so a changed price changes it in one place;
// the page never types a price itself. Only the fields the page shows are
// typed here. turbopackIgnore keeps Turbopack from tracing the repository
// into the page, as in changelog/entries.ts.

/** The catalog, from the repository's root. */
const CATALOG = "apps/cloud-functions/src/pricing/catalog.json";

export type PlanId = "free" | "pro" | "enterprise";

export type Catalog = {
  version: string;
  /** `proposal` until the prices are final. */
  status: string;
  /** ISO 4217, lower case. */
  currency: string;
  conventions: Record<
    | "period"
    | "hubs"
    | "basics"
    | "user_meters"
    | "tiers"
    | "allowance"
    | "invoice"
    | "caps"
    | "preview"
    | "roadmap"
    | "capacity"
    | "bot_checks"
    | "self_hosted",
    string
  >;
  /** `free` is Core and `pro` is Pay as you go; the ids stay what billing knows. */
  plans: {
    free: Plan & {
      limits: { requests_per_second_per_project: number };
      /** What happens past an allowance, where Core has no card to bill. */
      over_allowance: string;
    };
    pro: Plan & {
      limits: { requests_per_second_per_project: number };
    };
    // Quoted, never listed: the page reads none of its minimums or rates.
    enterprise: Plan & {
      /** What Enterprise offers while the next version is in preview. */
      preview: string;
      /** The compliance features Enterprise includes, by label; their status is in status.ts. */
      compliance: string[];
    };
  };
  core: {
    platform: string[];
    resources: string[];
    authentication: string[];
    security: string[];
    billing: string;
  };
  /** The production basics: what every hub includes, whichever is turned on. */
  hub_includes: string[];
  hubs: Hub[];
  meters: Meter[];
  licensed: Licensed[];
  self_hosted: {
    unit: string;
    /**
     * What every production installation pays before add-ons. Its `includes`, and those of
     * `hubs` and `enterprise`, are what differs from the cloud, as the cards list it.
     */
    base: {
      label: string;
      amount: number;
      interval: string;
      per: string;
      billed: string;
      includes: string[];
    };
    /** `per`: what an add-on's base fee is charged for, such as a production installation. */
    hubs: { license: string; per: string; metering: string; includes: string[] };
    enterprise: { includes: string[] };
  };
};

export type HubId =
  | "consumer"
  | "multi_tenancy"
  | "agentic"
  | "security_analytics"
  | "extensibility";

/** A hub: turned on per account for a monthly base fee, with its own meters. */
export type Hub = {
  id: HubId;
  label: string;
  /** One line under the name: who it is for. */
  line: string;
  /** `null` while quoted. */
  base: { amount: number | null; interval: string };
  pricing: "listed" | "quoted";
  plans: PlanId[];
  /** What it adds, by label; whether each works today is in status.ts. */
  features: string[];
};

type Plan = {
  label: string;
  event_retention_days: number;
  attribution_mark: "shown" | "hideable";
  delivery_modes: string[];
  support: string;
  sla: { target_percent: number; credits: boolean; note?: string } | null;
  /** The regions a plan's projects choose from, at no charge. */
  regions: { scope: "project"; selection: string[] | "all_available" };
};

export type PerUnit = { model: "per_unit"; unit_amount: number; display?: string };
export type PerBand = {
  model: "per_band";
  bands: {
    id: string;
    countries: string[];
    unit_amount: number | null;
  }[];
};

export type Meter = {
  id: string;
  label: string;
  /** `configured`: things set up, such as connections or themes, counted once a month. */
  kind: "users" | "activity" | "configured" | "gauge";
  /** One counted unit, singular: user, token, check. */
  unit?: string;
  /** What one count is. */
  counts: string;
  /** What counts once a month for an enterprise integration. */
  dedupe?: string[];
  /** Included once the meter's hub is on; for a shared meter, once any hub is. */
  allowance: number | null;
  /** A shared meter's included amount where a particular hub is on, when that hub includes more. */
  hub_allowance?: Partial<Record<HubId, number>>;
  /** Free on Pay as you go before its add-on is on; `null` when only an add-on offers it. */
  free_allowance?: number | null;
  /** The hub that sells it; `null` for a gauge or a meter every hub offers. */
  hub?: HubId | null;
  price: PerUnit | PerBand | null;
  /** The plans that may use it; every plan when unset. */
  plans?: PlanId[];
  /** Counts at most `at_most` users per connection or directory a month. */
  counted_per?: { key: string; at_most: number };
};

/** A recurring plan fee or an add-on billed separately from metered usage. */
export type Licensed = {
  id: string;
  label: string;
  amount: number | null;
  interval: string;
  per?: string;
  plans: PlanId[];
  included_in?: PlanId[];
  note?: string;
  tag: string;
};

/** The catalog. `next build` runs in apps/website, two folders below the repository's root. */
export function readCatalog(
  root = join(/* turbopackIgnore: true */ process.cwd(), "..", ".."),
): Catalog {
  return JSON.parse(
    readFileSync(/* turbopackIgnore: true */ join(root, CATALOG), "utf8"),
  ) as Catalog;
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact" });
const REGIONS = new Intl.DisplayNames(["en"], { type: "region" });

/** A number of days: `1 day`, `30 days`. */
export function days(value: number): string {
  return `${count(value)} day${value === 1 ? "" : "s"}`;
}

/** A count as a table cell writes it: `1K`, `200K`, `1M`. */
export function short(value: number): string {
  return COMPACT.format(value);
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A plan's regions as the page writes them: `EU`, or every available one. */
export function regionList(selection: string[] | "all_available"): string {
  return selection === "all_available"
    ? "Every available region"
    : and(selection.map((code) => code.toUpperCase()));
}

/** The catalog's notes as sentences: capitalized, ending in a period. */
export function sentence(text: string): string {
  const capitalized = capitalize(text.trim());
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

/** Words as a phrase: `Pro`, `Pro and Enterprise`, `A, B and C`. */
function and(words: string[]): string {
  return words.length > 1
    ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
    : (words[0] ?? "");
}

/** The meters the page lists: those a price applies to. */
export function listedMeters(catalog: Catalog): Meter[] {
  return catalog.meters.filter((meter) => meter.price !== null);
}

/**
 * What a meter costs past its allowance, one line per part: the price, what
 * one connection or directory costs at most.
 */
export function meterPrice(meter: Meter): string[] {
  const { price } = meter;
  if (!price) return ["Never billed"];
  switch (price.model) {
    case "per_unit": {
      const per = meter.unit ?? (meter.kind === "users" ? "user" : "unit");
      const lines = [price.display ?? `${dollars(price.unit_amount)} per ${per}`];
      const most = mostPer(meter);
      if (most !== undefined) {
        lines.push(`At most ${dollars(most)} per ${meter.counted_per?.key} a month`);
      }
      return lines;
    }
    case "per_band": {
      // The first priced band leads with its price; the others name their place first.
      const lines: string[] = [];
      for (const band of price.bands) {
        const where =
          band.countries.length > 0
            ? and(band.countries.map((code) => REGIONS.of(code) ?? code))
            : "Other countries";
        lines.push(
          band.unit_amount === null
            ? `${where}: quote required`
            : `${where}: ${dollars(band.unit_amount)} per message`,
        );
      }
      return lines;
    }
  }
}

/** A hub's meters, in the catalog's order. */
export function hubMeters(catalog: Catalog, hub: HubId): Meter[] {
  return catalog.meters.filter((meter) => meter.hub === hub && meter.price !== null);
}

/** An amount of a meter's unit: `100K users / month`, `2 connections`. */
export function included(meter: Meter, amount: number): string {
  const unit = meter.unit ?? "unit";
  const per = meter.kind === "configured" ? "" : " / month";
  return `${short(amount)} ${amount === 1 ? unit : `${unit}s`}${per}`;
}

/** A hub's base fee as a card writes it: `$100`, or `Custom` while quoted. */
export function hubPrice(hub: Hub): string {
  return hub.base.amount === null ? "Custom" : dollars(hub.base.amount);
}

/** What one connection or directory costs at most a month, for a meter counted per one. */
export function mostPer(meter: Meter): number | undefined {
  const { price, counted_per } = meter;
  if (price?.model !== "per_unit" || !counted_per) return undefined;
  return Math.round(counted_per.at_most * price.unit_amount * 100) / 100;
}

/**
 * A licensed line's price: `$1,000 a month`, `$75 an hour`, or its
 * note when it has no amount. A line only Enterprise takes is quoted with the
 * rest of its contract, never listed.
 */
export function licensedPrice(line: Licensed): string {
  if (line.plans.every((plan) => plan === "enterprise")) return "In the Enterprise quote";
  if (line.amount === null) return line.note ?? "On request";
  return `${dollars(line.amount)} a${line.interval === "hour" ? "n" : ""} ${line.interval}${line.per ? ` per ${line.per}` : ""}`;
}
