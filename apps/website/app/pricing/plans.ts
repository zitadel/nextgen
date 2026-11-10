import { links } from "../links";
import { type Catalog, capitalize, days, dollars, type Hub, hubPrice } from "./catalog";
import { lowestHub, type TierId } from "./compare";
import { combine, type FeatureStatus, featureStatus, hubStatus, works } from "./status";

// The offer in three steps, for each place Zitadel runs: start free, turn on
// add-ons, or move to an Enterprise contract. The page shows them as three
// cards under a Cloud / Self-hosted switch. Every price comes from the catalog;
// only the wording is written here.

export type Deployment = "cloud" | "self_hosted";

export type PlanItem = {
  text: string;
  /** Set while it doesn't fully work: the tag beside it. */
  status?: FeatureStatus;
  /** A priced list's price and what it is per: `$100`, `/ month`. */
  price?: string;
  per?: string;
};

export type PlanList = {
  heading: string;
  /** A menu of things to pick, each with its price, rather than what is included. */
  priced?: boolean;
  items: PlanItem[];
};

export type PlanCard = {
  id: TierId;
  name: string;
  /** `$0`, `From $100`, or `Custom` for Enterprise, which is quoted. */
  price: string;
  per: string;
  line: string;
  lists: PlanList[];
  action: { label: string; href: string };
};

/** The add-ons as a menu: a price for one that works today, its status for one still to come. */
function menu(hubs: Hub[]): PlanItem[] {
  return hubs.map((hub) => {
    const status = hubStatus(hub);
    return works(status) && hub.base.amount !== null
      ? { text: hub.label, price: hubPrice(hub), per: `/ ${hub.base.interval}` }
      : { text: hub.label, status };
  });
}

/** The three cards for each deployment. */
export function planCards(catalog: Catalog): Record<Deployment, PlanCard[]> {
  const { free, pro, enterprise } = catalog.plans;
  const self = catalog.self_hosted;
  const from = { price: `From ${lowestHub(catalog)}`, per: "/ month per add-on" };
  const keys = catalog.licensed.find((line) => line.id === "private_keys");
  const terms = catalog.licensed.find((line) => line.id === "addendum");
  const [compliance = "", ...moreCompliance] = enterprise.compliance;

  return {
    cloud: [
      {
        id: "free",
        name: "Free",
        price: dollars(0),
        per: "no card needed",
        line: "Everything you need to sign users in.",
        lists: [
          {
            heading: "Included:",
            items: [
              { text: "Unlimited users, console seats and teams for your customers" },
              { text: "Passwords and passkeys" },
              // The catalog's own labels, each with its status: MFA is free, and says so
              // before it ships.
              ...[...catalog.core.authentication, ...catalog.core.security]
                .filter((label) => /up to|1 free|MFA for everyone/.test(label))
                .map((text) => ({ text, status: featureStatus(text) })),
              { text: "Active users and API requests never billed" },
              { text: `${capitalize(free.support)} support` },
            ],
          },
        ],
        action: { label: "Start building", href: links.quickstart },
      },
      {
        id: "addons",
        name: "Add-ons",
        ...from,
        line: "Turn on what your app needs. Pay only for that.",
        lists: [
          { heading: "Everything in Free, plus any of:", priced: true, items: menu(catalog.hubs) },
          {
            heading: "With any add-on:",
            items: [
              {
                text: "Production basics: your branding, a custom domain, managed email and SMS",
                status: combine(catalog.hub_includes.map(featureStatus)),
              },
              { text: capitalize(pro.support) },
            ],
          },
        ],
        action: { label: "See the add-ons", href: "#add-ons" },
      },
      {
        id: "enterprise",
        name: enterprise.label,
        price: "Custom",
        per: "annual contract",
        line: "The add-ons on one contract, with compliance and an SLA.",
        lists: [
          {
            heading: "Everything in Add-ons, plus:",
            items: [
              ...(enterprise.sla
                ? [{ text: `${enterprise.sla.target_percent}% uptime SLA with service credits` }]
                : []),
              { text: capitalize(enterprise.support) },
              { text: `${days(enterprise.event_retention_days)} of audit events` },
              ...(keys ? [{ text: keys.label }] : []),
              { text: "Dedicated infrastructure, on request" },
              ...(terms ? [{ text: terms.label }] : []),
              {
                text: `Compliance: ${[compliance, ...moreCompliance.map(lowerFirst)].join(", ")}`,
                status: combine(enterprise.compliance.map(featureStatus)),
              },
            ],
          },
        ],
        action: { label: "Contact us", href: links.contact },
      },
    ],
    self_hosted: [
      {
        id: "free",
        name: "Free",
        price: dollars(0),
        per: "open source",
        line: "Run Zitadel on your own servers.",
        lists: [
          {
            heading: "Included:",
            items: [
              { text: "Everything in the cloud's Free" },
              { text: "Unlimited users and installations" },
              { text: `Open source under ${self.free.license}` },
              { text: `${capitalize(self.free.support)} support` },
            ],
          },
        ],
        action: { label: "View on GitHub", href: links.github },
      },
      {
        id: "addons",
        name: "Add-ons",
        ...from,
        line: "The cloud's add-ons, licensed for the servers you run.",
        lists: [
          {
            heading: "Everything in Free, plus any of:",
            priced: true,
            items: [
              ...menu(catalog.hubs),
              {
                text: self.support.label,
                price: dollars(self.support.amount),
                per: `/ ${self.support.interval}`,
              },
            ],
          },
          {
            heading: "With any add-on:",
            items: [
              ...self.hubs.includes.map((text) => ({ text })),
              { text: capitalize(self.hubs.metering) },
            ],
          },
        ],
        action: { label: "Contact us", href: links.contact },
      },
      {
        id: "enterprise",
        name: enterprise.label,
        price: "Custom",
        per: "annual contract",
        line: "For regulated and air-gapped installations.",
        lists: [
          {
            heading: "Everything in Add-ons, plus:",
            items: self.enterprise.includes.map((text) => ({ text })),
          },
        ],
        action: { label: "Contact us", href: links.contact },
      },
    ],
  };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
