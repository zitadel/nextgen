import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    "period" | "user_meters" | "allowance" | "invoice" | "caps" | "self_hosted" | "packages",
    string
  >;
  plans: {
    free: Plan & {
      limits: {
        requests_per_second_per_project: number;
        requests_per_month_per_account: number;
        past_monthly_ceiling: string;
      };
      /** What happens past an allowance, where Free has no card to bill. */
      over_allowance: string;
    };
    pro: Plan & {
      minimum: { amount: number; interval: string };
      limits: { requests_per_second_per_project: number };
    };
    // Quoted, never listed: the page reads none of its minimums or rates.
    enterprise: Plan;
  };
  core: {
    platform: string[];
    resources: string[];
    authentication: string[];
    security: string[];
    billing: string;
  };
  packages: Package[];
  meters: Meter[];
  licensed: Licensed[];
  self_hosted: {
    unit: string;
    free: { license: string; support: string };
    pro: {
      prices: { installations_up_to: number; amount: number; interval: string }[];
      includes: string[];
      ticket_cap_per_year: number;
    };
    enterprise: { includes: string[] };
  };
};

type Plan = {
  label: string;
  event_retention_days: number;
  attribution_mark: "shown" | "hideable";
  delivery_modes: string[];
  support: string;
  sla: { target_percent: number; credits: boolean; note?: string } | null;
  regions: { scope: "project"; selection: "all_available" };
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
  kind: "users" | "activity" | "gauge";
  /** What one count is. */
  counts: string;
  /** What counts once a month for an enterprise integration. */
  dedupe?: string[];
  allowance: number | null;
  price: PerUnit | PerBand | null;
  /** The plans that may use it; every plan when unset. */
  plans?: PlanId[];
  /** Counts at most `at_most` users per connection or directory a month. */
  counted_per?: { key: string; at_most: number };
};

export type Package = {
  id: string;
  label: string;
  pricing: "included_in_plan" | "quoted";
  scope: "account";
  plans: PlanId[];
  included_in: PlanId[];
  features: string[];
  availability: "planned" | "available";
  note: string;
  retention_days?: number[];
  volume_unit?: string;
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

const COUNT = new Intl.NumberFormat("en-US");
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact" });
const REGIONS = new Intl.DisplayNames(["en"], { type: "region" });

/** A dollar amount as the page writes it: `$100`, `$36,000`, `$0.10`, `$0.015`. */
export function dollars(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 6,
  })}`;
}

/** A count as the page writes it: `1,000,000`. */
export function count(value: number): string {
  return COUNT.format(value);
}

/** A count as a table cell writes it: `1K`, `200K`, `1M`. */
export function short(value: number): string {
  return COMPACT.format(value);
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
      const per = meter.kind === "users" ? "per user" : "per unit";
      const lines = [price.display ?? `${dollars(price.unit_amount)} ${per}`];
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

/** What one connection or directory costs at most a month, for a meter counted per one. */
export function mostPer(meter: Meter): number | undefined {
  const { price, counted_per } = meter;
  if (price?.model !== "per_unit" || !counted_per) return undefined;
  return Math.round(counted_per.at_most * price.unit_amount * 100) / 100;
}

/**
 * A licensed line's price: `$1,000 a month`, `$100 a month per region`, or its
 * note when it has no amount. A line only Enterprise takes is quoted with the
 * rest of its contract, never listed.
 */
export function licensedPrice(line: Licensed): string {
  if (line.plans.every((plan) => plan === "enterprise")) return "In the Enterprise quote";
  if (line.amount === null) return line.note ?? "On request";
  return `${dollars(line.amount)} a${line.interval === "hour" ? "n" : ""} ${line.interval}${line.per ? ` per ${line.per}` : ""}`;
}
