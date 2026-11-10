import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { links } from "../links";
import { readCatalog } from "./catalog";
import { TIERS } from "./compare";
import {
  type Deployment,
  OWN_SERVERS,
  type PlanCard,
  type PlanHead,
  type PlanItem,
  planCards,
} from "./plans";
import { hubStatus, works } from "./status";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DEPLOYMENTS = ["cloud", "self_hosted"] as const;

/** A card's name and price for one deployment. */
function head(card: PlanCard, deployment: Deployment): PlanHead {
  return deployment === "self_hosted" && card.own ? card.own : card;
}

/** What a card lists for one deployment. */
function items(card: PlanCard, deployment: Deployment): PlanItem[] {
  return card.lists
    .filter((list) => !list.only || list.only === deployment)
    .flatMap((list) => list.items)
    .filter((item) => !item.only || item.only === deployment);
}

/** Everything a card says for one deployment, as one string. */
function words(card: PlanCard, deployment: Deployment): string {
  const { name, price, per, line } = head(card, deployment);
  return [
    name,
    price,
    per,
    line,
    ...items(card, deployment).flatMap((item) => [item.text, item.price ?? "", item.per ?? ""]),
  ].join(" ");
}

describe("the pricing page's three cards", () => {
  const catalog = readCatalog(ROOT);
  const cards = planCards(catalog);
  const [free, addons, enterprise] = cards as [PlanCard, PlanCard, PlanCard];

  it("shows three steps, in the comparison's order", () => {
    expect(cards.map((card) => card.id)).toEqual(TIERS);
    expect(cards.map((card) => card.name)).toEqual(["Free", "Add-ons", "Enterprise"]);
  });

  it("starts free, names where add-ons start, and never lists an Enterprise price", () => {
    expect(free.price).toBe("$0");
    expect(`${addons.price} ${addons.per}`).toBe("From $100 / month per add-on");
    expect(enterprise.price).toBe("Custom");
    for (const deployment of DEPLOYMENTS) {
      expect(enterprise.action[deployment].href).toBe(links.contact);
      expect(words(enterprise, deployment)).not.toMatch(/\$/);
    }
  });

  it("starts a self-hosted installation on the base, which carries its license and support", () => {
    expect(free.own).toMatchObject({
      name: "Self-hosted",
      price: "$200",
      per: "/ month per installation",
    });
    expect(free.action.self_hosted.href).toBe(links.contact);
    const own = items(free, "self_hosted").map((item) => item.text);
    expect(own).toEqual(
      expect.arrayContaining([
        ...catalog.self_hosted.base.includes,
        "For each production installation, billed yearly",
      ]),
    );
    // Only the first step changes its name and price.
    expect(addons.own).toBeUndefined();
    expect(enterprise.own).toBeUndefined();
    // Support comes with the base, so nothing sells it again.
    expect(words(addons, "self_hosted")).not.toMatch(/ticket/i);
  });

  it("is the same offer self-hosted: every card keeps what it lists in the cloud, but what only the cloud has", () => {
    const cloudOnly = cards.flatMap((card) =>
      items(card, "cloud").filter((item) => item.only === "cloud"),
    );
    expect(cloudOnly.map((item) => item.text)).toEqual([
      "Community support",
      "Tickets any time, answered the next business day",
      "99.95% uptime SLA with service credits",
      "Dedicated infrastructure, on request",
    ]);
    for (const card of cards) {
      const own = items(card, "self_hosted").map((item) => item.text);
      for (const item of items(card, "cloud").filter((entry) => !entry.only))
        expect(own, card.name).toContain(item.text);
    }
  });

  it("lists what differs on your own servers first, in the catalog's words", () => {
    const { self_hosted: self } = catalog;
    const differs = [self.base.includes, self.hubs.includes, self.enterprise.includes];
    cards.forEach((card, index) => {
      const [first] = card.lists;
      expect(first, card.name).toMatchObject({ heading: OWN_SERVERS, only: "self_hosted" });
      expect(first?.items.map((item) => item.text)).toEqual(
        expect.arrayContaining(differs[index] ?? []),
      );
      expect(card.lists.filter((list) => list.only)).toHaveLength(1);
    });
  });

  it("sells, in a customer's words: no license terms, and no open-source edition", () => {
    for (const card of cards)
      for (const deployment of DEPLOYMENTS)
        expect(words(card, deployment), card.name).not.toMatch(
          /dual|AGPL|open.source|true-up|github/i,
        );
    for (const card of cards)
      for (const deployment of DEPLOYMENTS)
        expect(card.action[deployment].href, card.name).not.toBe(links.github);
  });

  it("prices only the add-ons that work today, and tags the others", () => {
    const menu = addons.lists.find((list) => list.priced)!.items;
    for (const hub of catalog.hubs) {
      const item = menu.find((entry) => entry.text === hub.label)!;
      if (works(hubStatus(hub))) {
        expect(`${item.price} ${item.per}`, hub.id).toBe(
          `$${hub.base.amount} / ${hub.base.interval}`,
        );
      } else {
        expect(item.price, hub.id).toBeUndefined();
        expect(item.status, hub.id).toBe(hubStatus(hub));
      }
    }
  });

  it("says something everywhere", () => {
    for (const card of cards)
      for (const deployment of DEPLOYMENTS)
        expect(words(card, deployment), card.name).not.toMatch(/undefined|NaN|null/);
  });
});
