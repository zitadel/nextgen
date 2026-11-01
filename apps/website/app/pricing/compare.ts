import {
  type Catalog,
  capitalize,
  type Licensed,
  licensedPrice,
  type Meter,
  meterPrice,
  type PlanId,
  short,
} from "./catalog";

// The plan comparison under the cards: every meter and every line billed on
// top, grouped by who needs it, each row saying per plan what is included and
// what past it costs. Enterprise's column says Custom wherever a price would
// stand, because Enterprise is quoted, never listed.

export const PLANS: PlanId[] = ["free", "pro", "enterprise"];

/** What one plan's column says on a row. */
export type Cell =
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "text"; text: string; notes?: string[] };

export type Row = {
  label: string;
  cells: Record<PlanId, Cell>;
  /** The catalog meter or line the row prices, so the spec can find every one. */
  source?: string;
};

export type Group = { id: string; title: string; line: string; rows: Row[] };

const YES: Cell = { kind: "yes" };
const NO: Cell = { kind: "no" };
const CUSTOM: Cell = text("Custom");

function text(value: string, notes: string[] = []): Cell {
  return notes.length > 0 ? { kind: "text", text: value, notes } : { kind: "text", text: value };
}

function each(cell: (plan: PlanId) => Cell): Record<PlanId, Cell> {
  return { free: cell("free"), pro: cell("pro"), enterprise: cell("enterprise") };
}

/**
 * A meter's cell: its monthly allowance, then its price past it; Free stops at
 * the allowance. A retention the plan keeps anyway is included.
 */
export function meterCell(meter: Meter, plan: PlanId, catalog: Catalog): Cell {
  if (meter.plans && !meter.plans.includes(plan)) return NO;
  if (meter.retention_days && meter.retention_days <= catalog.plans[plan].event_retention_days) {
    return text("Included");
  }
  if (plan === "enterprise") return CUSTOM;
  const included = meter.allowance ? `${short(meter.allowance)} / month included` : undefined;
  if (plan === "free") return included ? text(included) : NO;
  const [price = "", ...more] = meterPrice(meter, catalog);
  return included ? text(included, [`Then ${price}`, ...more]) : text(price, more);
}

/** A line billed on top: its price where a plan may take it, Included where a plan has it. */
export function lineCell(line: Licensed, plan: PlanId): Cell {
  if (line.included_in?.includes(plan)) return text("Included");
  if (!line.plans.includes(plan)) return NO;
  return plan === "enterprise" ? CUSTOM : text(licensedPrice(line));
}

/** The comparison's groups, in the order the page shows them. */
export function compareGroups(catalog: Catalog): Group[] {
  const { free, pro, enterprise } = catalog.plans;
  const plans = catalog.plans;
  const meters = new Map(catalog.meters.map((meter) => [meter.id, meter]));
  const lines = new Map(catalog.licensed.map((line) => [line.id, line]));
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
  const meterRow = (id: string, label?: string): Row => {
    const found = meter(id);
    return {
      label: label ?? found.label,
      cells: each((plan) => meterCell(found, plan, catalog)),
      source: id,
    };
  };
  const lineRow = (id: string, label?: string): Row => {
    const found = line(id);
    return {
      label: label ?? found.label,
      cells: each((plan) => lineCell(found, plan)),
      source: id,
    };
  };

  const mau = meter("monthly_active_users");
  const requests = meter("api_requests");
  const [proSupport = "", ...proSupportMore] = pro.support.split("; ");

  const groups: Group[] = [
    {
      id: "platform",
      title: "Platform",
      line: "What every plan runs on.",
      rows: [
        {
          label: "Monthly active users",
          source: mau.id,
          cells: {
            free: text(`Up to ${short(free.limits.core_mau_sized_for)} / month`),
            pro: meterCell(mau, "pro", catalog),
            enterprise: CUSTOM,
          },
        },
        { label: "Teams and console seats", cells: each(() => text("Unlimited")) },
        // The login is a component the customer runs in its own app, so its
        // domain is the customer's on every plan.
        { label: "Login in your own app, on your domain", cells: each(() => YES) },
        {
          label: "Audit events kept",
          cells: each((plan) => text(`${plans[plan].event_retention_days} days`)),
        },
      ],
    },
    {
      id: "b2c",
      title: "B2C",
      line: "Sign-in for consumers at scale: delivery, bot defence and your brand.",
      rows: [
        meterRow("email_users", "Managed email"),
        meterRow("sms_users", "Managed SMS"),
        {
          label: "Dev inbox and your own email provider",
          cells: each((plan) => (plans[plan].delivery_modes.includes("own_provider") ? YES : NO)),
        },
        { label: "Basic bot challenges", cells: each(() => text("Unlimited")) },
        meterRow("bot_checks"),
        {
          label: "Hide the Zitadel mark",
          cells: each((plan) => (plans[plan].attribution_mark === "hideable" ? YES : NO)),
        },
      ],
    },
    {
      id: "b2b",
      title: "B2B",
      line: "Selling to companies: their SSO and directories, their policies and their permissions.",
      rows: [
        meterRow("sso_users"),
        meterRow("directory_users"),
        meterRow("policy_users"),
        meterRow("authz_users"),
      ],
    },
    {
      id: "m2m",
      title: "M2M and APIs",
      line: "Machines and agents calling your APIs, and the API itself.",
      rows: [
        meterRow("m2m_tokens"),
        {
          label: requests.label,
          source: requests.id,
          cells: {
            free: text(`${free.limits.requests_per_second_per_project} / second per project`, [
              `${short(free.limits.requests_per_month_per_account)} / month per account`,
            ]),
            pro: text("Never billed"),
            enterprise: text("Never billed"),
          },
        },
      ],
    },
    {
      id: "audit",
      title: "Audit trail",
      line: "How long you keep who did what past the plan's own days, and where it streams.",
      rows: [
        meterRow("retained_users_90d", "Retention to 90 days"),
        meterRow("retained_users_400d", "Retention to 400 days"),
        lineRow("event_sink"),
      ],
    },
    {
      id: "compliance",
      title: "Compliance",
      line: "Uptime, regions and the terms your customers' auditors ask for.",
      rows: [
        {
          label: "Uptime SLA",
          cells: each((plan) => {
            const sla = plans[plan].sla;
            if (!sla) return NO;
            return text(`${sla.target_percent}%`, sla.credits ? ["With service credits"] : []);
          }),
        },
        lineRow("sla_9995"),
        lineRow("sla_9999", "99.99% SLA"),
        {
          label: "Regions",
          cells: each((plan) => {
            const regions = plans[plan].regions;
            return Array.isArray(regions)
              ? text(regions.map((region) => region.toUpperCase()).join(", "))
              : text(capitalize(regions.split("; ")[0] ?? regions));
          }),
        },
        lineRow("region", "Regions outside the EU"),
        lineRow("dedicated_deployment"),
        lineRow("addendum"),
      ],
    },
    {
      id: "support",
      title: "Support",
      line: "Who answers, and how fast.",
      rows: [
        {
          label: "Support",
          cells: {
            free: text(capitalize(free.support)),
            pro: text(capitalize(proSupport), proSupportMore.map(capitalize)),
            enterprise: text(capitalize(enterprise.support)),
          },
        },
        lineRow("support_priority"),
        lineRow("tam_hours"),
        lineRow("private_slack"),
      ],
    },
  ];

  // A meter or line the groups above do not place still shows, under Other,
  // until it gets a group; the spec fails while any does.
  const rest: Row[] = [
    ...catalog.meters
      .filter((candidate) => !placed.has(candidate.id) && !candidate.pool_of)
      .map((candidate) => meterRow(candidate.id)),
    ...catalog.licensed
      .filter((candidate) => !placed.has(candidate.id) && candidate.tag !== "minimum spend")
      .map((candidate) => lineRow(candidate.id)),
  ];
  if (rest.length > 0) {
    groups.push({
      id: "other",
      title: "Other",
      line: "Everything else on the price list.",
      rows: rest,
    });
  }
  return groups;
}
