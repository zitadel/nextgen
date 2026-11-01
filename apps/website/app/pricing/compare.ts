import {
  type Catalog,
  capitalize,
  type Licensed,
  licensedPrice,
  type Meter,
  meterPrice,
  type PlanId,
  type Package,
  short,
} from "./catalog";

// The plan comparison under the cards: every meter and every line billed on
// top, grouped by capability, each row saying per plan what is included and
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
  /** Introduce a use case before its authentication rows. */
  subgroup?: { title: string; guidance: string };
  /** The catalog meter or licensed line the row prices. */
  source?: string;
  /** The commercial package that includes this capability. */
  packageId?: string;
};

export type Group = { id: string; title: string; rows: Row[] };

const YES: Cell = { kind: "yes" };
const NO: Cell = { kind: "no" };
const CUSTOM: Cell = text("Custom");

function text(value: string, notes: string[] = []): Cell {
  return notes.length > 0 ? { kind: "text", text: value, notes } : { kind: "text", text: value };
}

function each(cell: (plan: PlanId) => Cell): Record<PlanId, Cell> {
  return { free: cell("free"), pro: cell("pro"), enterprise: cell("enterprise") };
}

function subgroup(title: string, guidance: string, rows: Row[]): Row[] {
  return rows.map((row, index) => (index === 0 ? { ...row, subgroup: { title, guidance } } : row));
}

/**
 * A meter's cell: its monthly allowance, then its price past it; Free stops at
 * the allowance.
 */
export function meterCell(meter: Meter, plan: PlanId): Cell {
  if (meter.plans && !meter.plans.includes(plan)) return NO;
  if (plan === "enterprise") return CUSTOM;
  const included = meter.allowance ? `${short(meter.allowance)} / month included` : undefined;
  if (plan === "free") return included ? text(included) : NO;
  const [price = "", ...more] = meterPrice(meter);
  return included ? text(included, [`Then ${price}`, ...more]) : text(price, more);
}

/** A line billed on top: its price where a plan may take it, Included where a plan has it. */
export function lineCell(line: Licensed, plan: PlanId): Cell {
  if (line.included_in?.includes(plan)) return text("Included");
  if (!line.plans.includes(plan)) return NO;
  return plan === "enterprise" ? CUSTOM : text(licensedPrice(line));
}

/** The package's account-wide entitlement; quotes never masquerade as free access. */
export function packageCell(entry: Package, plan: PlanId): Cell {
  if (!entry.plans.includes(plan)) return NO;
  const notes = entry.availability === "planned" ? ["Planned"] : [];
  return text(entry.included_in.includes(plan) ? "Included" : "Custom quote", notes);
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
      cells: each((plan) => meterCell(found, plan)),
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
  const packageRows = (id: string): Row[] => {
    const entry = catalog.packages.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`The price list has no package ${id}.`);
    return entry.features.map((feature) => ({
      label: feature,
      packageId: entry.id,
      cells: each((plan) => packageCell(entry, plan)),
    }));
  };

  const groups: Group[] = [
    {
      id: "platform",
      title: "Platform",
      rows: [
        {
          label: "Monthly active users",
          source: mau.id,
          cells: each(() => text("Never billed")),
        },
        ...catalog.core.resources.map((label) => ({ label, cells: each(() => text("Unlimited")) })),
        ...catalog.core.platform.map((label) => ({ label, cells: each(() => YES) })),
        {
          label: "Region selection",
          cells: each((plan) => text(`Choose per ${plans[plan].regions.scope}`)),
        },
        {
          label: requests.label,
          source: requests.id,
          cells: {
            free: text(`${free.limits.requests_per_second_per_project} RPS per project`, [
              `${short(free.limits.requests_per_month_per_account)} / month per account`,
            ]),
            pro: text(`${pro.limits.requests_per_second_per_project} RPS per project`),
            enterprise: CUSTOM,
          },
        },
        meterRow("email_messages"),
        meterRow("sms_messages"),
        {
          label: "Dev inbox and your own email provider",
          cells: each((plan) => (plans[plan].delivery_modes.includes("own_provider") ? YES : NO)),
        },
        {
          label: "Hide the Zitadel mark",
          cells: each((plan) => (plans[plan].attribution_mark === "hideable" ? YES : NO)),
        },
        lineRow("dedicated_deployment"),
      ],
    },
    {
      id: "authentication",
      title: "Authentication",
      rows: [
        ...subgroup(
          "B2C · Consumer apps",
          "Users, sign-in and basic MFA stay free. Find shared delivery and branding in Platform, and advanced policies and bot checks in Security & policies.",
          catalog.core.authentication.map((label) => ({ label, cells: each(() => YES) })),
        ),
        ...subgroup(
          "B2B · Business apps",
          "Customer organizations, core roles and basic MFA stay free. Add your customers' SSO and directories below; advanced policies and delegated administration are in Security & policies.",
          [meterRow("sso_users"), meterRow("directory_users")],
        ),
        ...subgroup(
          "M2M · Services & agents",
          "Service identities and credentials stay free. Compare token usage below; advanced authorization checks are in Security & policies.",
          [meterRow("m2m_tokens")],
        ),
      ],
    },
    {
      id: "security",
      title: "Security & policies",
      rows: [
        ...catalog.core.security.map((label) => ({ label, cells: each(() => YES) })),
        meterRow("bot_checks"),
        meterRow("authz_checks"),
        ...packageRows("governance"),
      ],
    },
    {
      id: "audit",
      title: "Audit & logs",
      rows: [
        {
          label: "Audit events kept",
          cells: each((plan) => text(`${plans[plan].event_retention_days} days`)),
        },
        ...packageRows("compliance"),
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
            pro: text(capitalize(proSupport), proSupportMore.map(capitalize)),
            enterprise: text(capitalize(enterprise.support)),
          },
        },
        lineRow("support_priority"),
        lineRow("tam_hours"),
        lineRow("private_slack"),
        {
          label: "Availability commitment",
          cells: each((plan) => {
            const sla = plans[plan].sla;
            if (!sla) return NO;
            return text(`${sla.target_percent}% ${sla.credits ? "SLA" : "target"}`, [
              sla.credits ? "With service credits" : "No service credits",
            ]);
          }),
        },
        lineRow("sla_9995"),
        lineRow("sla_9999", "99.99% SLA upgrade"),
        lineRow("addendum"),
      ],
    },
  ];

  // A meter or line the groups above do not place still shows, under Other,
  // until it gets a group; the spec fails while any does.
  const rest: Row[] = [
    ...catalog.meters
      .filter((candidate) => !placed.has(candidate.id))
      .map((candidate) => meterRow(candidate.id)),
    ...catalog.licensed
      .filter((candidate) => !placed.has(candidate.id) && candidate.tag !== "minimum spend")
      .map((candidate) => lineRow(candidate.id)),
  ];
  if (rest.length > 0) {
    groups.push({
      id: "other",
      title: "Other",
      rows: rest,
    });
  }
  return groups;
}
