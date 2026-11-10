import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { links } from "../links";
import { readCatalog } from "./catalog";
import { TIERS } from "./compare";
import { type PlanCard, planCards } from "./plans";
import { hubStatus, works } from "./status";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Everything a card says, as one string. */
function words(card: PlanCard): string {
  return [
    card.price,
    card.per,
    card.line,
    ...card.lists.flatMap((list) => [
      list.heading,
      ...list.items.flatMap((item) => [item.text, item.price ?? "", item.per ?? ""]),
    ]),
  ].join(" ");
}

describe("the pricing page's three cards", () => {
  const catalog = readCatalog(ROOT);
  const plans = planCards(catalog);

  it("shows the same three steps in the cloud and self-hosted, in the comparison's order", () => {
    for (const cards of [plans.cloud, plans.self_hosted]) {
      expect(cards.map((card) => card.id)).toEqual(TIERS);
      expect(cards.map((card) => card.name)).toEqual(["Free", "Add-ons", "Enterprise"]);
    }
  });

  it("starts free, names where add-ons start, and never lists an Enterprise price", () => {
    for (const cards of [plans.cloud, plans.self_hosted]) {
      const [free, addons, enterprise] = cards as [PlanCard, PlanCard, PlanCard];
      expect(free.price).toBe("$0");
      expect(`${addons.price} ${addons.per}`).toBe("From $100 / month per add-on");
      expect(enterprise.price).toBe("Custom");
      expect(enterprise.action.href).toBe(links.contact);
      expect(words(enterprise)).not.toMatch(/\$/);
    }
  });

  it("prices only the add-ons that work today, and tags the others", () => {
    for (const cards of [plans.cloud, plans.self_hosted]) {
      const menu = cards[1]!.lists.find((list) => list.priced)!.items;
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
    }
  });

  it("offers self-hosted support tickets as a line of their own", () => {
    const menu = plans.self_hosted[1]!.lists.find((list) => list.priced)!.items;
    expect(menu.at(-1)).toEqual({ text: "Support tickets", price: "$2,000", per: "/ year" });
    expect(words(plans.cloud[1]!)).not.toContain("Support tickets");
  });

  it("says something everywhere", () => {
    for (const card of [...plans.cloud, ...plans.self_hosted])
      expect(words(card), card.name).not.toMatch(/undefined|NaN|null/);
  });
});
