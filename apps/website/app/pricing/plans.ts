import { links } from "../links";
import { type Catalog, capitalize, days, dollars, type Hub, hubPrice } from "./catalog";
import { lowestHub, type TierId } from "./compare";
import { combine, type FeatureStatus, featureStatus, hubStatus, works } from "./status";

// The offer in three steps: start free, turn on add-ons, or move to an
// Enterprise contract. The page shows them as three cards under a Cloud /
// Self-hosted switch. Self-hosting is the same product, so the cards keep
// their features and prices: what differs on your own servers is a short list
// of its own on each card, and the few lines that hold only for one are marked
// `only`. The first step is where they part: the cloud starts free, a
// self-hosted installation starts on a base that carries its license and
// support. The page sells; the open-source edition is in the questions.
// Every price comes from the catalog; only the wording is written here.

export type Deployment = "cloud" | "self_hosted";

export type PlanItem = {
  text: string;
  /** Set while it doesn't fully work: the tag beside it. */
  status?: FeatureStatus;
  /** A priced list's price and what it is per: `$100`, `/ month`. */
  price?: string;
  per?: string;
  /** Shown for one deployment only. */
  only?: Deployment;
};

export type PlanList = {
  heading: string;
  /** A menu of things to pick, each with its price, rather than what is included. */
  priced?: boolean;
  items: PlanItem[];
  /** Shown for one deployment only. */
  only?: Deployment;
};

/** A card's name and price. */
export type PlanHead = {
  name: string;
  /** `$0`, `From $100`, or `Custom` for Enterprise, which is quoted. */
  price: string;
  per: string;
  line: string;
};

export type PlanCard = PlanHead & {
  id: TierId;
  /** The name and price self-hosted, where they differ from the cloud's. */
  own?: PlanHead;
  lists: PlanList[];
  /** Where the card's button goes, which depends on where Zitadel runs. */
  action: Record<Deployment, { label: string; href: string }>;
};

/** The heading of what differs when Zitadel runs on the customer's servers. */
export const OWN_SERVERS = "On your own servers:";

/** The add-ons as a menu: a price for one that works today, its status for one still to come. */
function menu(hubs: Hub[]): PlanItem[] {
  return hubs.map((hub) => {
    const status = hubStatus(hub);
    return works(status) && hub.base.amount !== null
      ? { text: hub.label, price: hubPrice(hub), per: `/ ${hub.base.interval}` }
      : { text: hub.label, status };
  });
}

/** What a card says only for self-hosting, in the catalog's words. */
function ownServers(items: string[]): PlanList {
  return { heading: OWN_SERVERS, only: "self_hosted", items: items.map((text) => ({ text })) };
}

/** The three cards. */
export function planCards(catalog: Catalog): PlanCard[] {
  const { free, pro, enterprise } = catalog.plans;
  const self = catalog.self_hosted;
  const keys = catalog.licensed.find((line) => line.id === "private_keys");
  const terms = catalog.licensed.find((line) => line.id === "addendum");
  const [compliance = "", ...moreCompliance] = enterprise.compliance;
  const contact = { label: "Contact us", href: links.contact };

  return [
    {
      id: "free",
      name: "Free",
      price: dollars(0),
      per: "no card needed",
      line: "Everything you need to sign users in.",
      own: {
        name: self.base.label,
        price: dollars(self.base.amount),
        per: `/ ${self.base.interval} per installation`,
        line: "Everything you need to sign users in, on your own servers.",
      },
      lists: [
        ownServers([
          ...self.base.includes,
          `For each ${self.base.per}, billed ${self.base.billed}`,
        ]),
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
            // The self-hosted base carries support tickets (above).
            { text: `${capitalize(free.support)} support`, only: "cloud" },
          ],
        },
      ],
      action: {
        cloud: { label: "Start building", href: links.quickstart },
        self_hosted: contact,
      },
    },
    {
      id: "addons",
      name: "Add-ons",
      price: `From ${lowestHub(catalog)}`,
      per: "/ month per add-on",
      line: "Turn on what your app needs. Pay only for that.",
      lists: [
        ownServers(self.hubs.includes),
        { heading: "Add any of:", priced: true, items: menu(catalog.hubs) },
        {
          heading: "With any add-on:",
          items: [
            {
              text: "Production basics: your branding, a custom domain, managed email and SMS",
              status: combine(catalog.hub_includes.map(featureStatus)),
            },
            // The self-hosted base carries support tickets already.
            { text: capitalize(pro.support), only: "cloud" },
          ],
        },
      ],
      action: {
        cloud: { label: "See the add-ons", href: "#add-ons" },
        self_hosted: contact,
      },
    },
    {
      id: "enterprise",
      name: enterprise.label,
      price: "Custom",
      per: "annual contract",
      line: "The add-ons on one contract, with compliance and 24x7 support.",
      lists: [
        ownServers(self.enterprise.includes),
        {
          heading: "Everything in Add-ons, plus:",
          items: [
            // Uptime and infrastructure are ours to promise only where we run it.
            ...(enterprise.sla
              ? [
                  {
                    text: `${enterprise.sla.target_percent}% uptime SLA with service credits`,
                    only: "cloud" as const,
                  },
                ]
              : []),
            { text: capitalize(enterprise.support) },
            { text: `${days(enterprise.event_retention_days)} of audit events` },
            ...(keys ? [{ text: keys.label }] : []),
            { text: "Dedicated infrastructure, on request", only: "cloud" },
            ...(terms ? [{ text: terms.label }] : []),
            {
              text: `Compliance: ${[compliance, ...moreCompliance.map(lowerFirst)].join(", ")}`,
              status: combine(enterprise.compliance.map(featureStatus)),
            },
          ],
        },
      ],
      action: { cloud: contact, self_hosted: contact },
    },
  ];
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
