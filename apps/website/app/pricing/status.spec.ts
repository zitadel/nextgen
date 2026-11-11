import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AREAS } from "../choose-version/features";
import { readCatalog } from "./catalog";
import {
  combine,
  featureStatus,
  hubStatus,
  METER_FEATURES,
  METER_OWN,
  meterStatus,
  OWN,
  rowStatus,
  TRACKS,
  works,
} from "./status";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

describe("what works today, on the pricing page", () => {
  const catalog = readCatalog(ROOT);
  const labels = [
    ...catalog.core.platform,
    ...catalog.core.resources,
    ...catalog.core.authentication,
    ...catalog.core.security,
    ...catalog.hub_includes,
    ...catalog.hubs.flatMap((hub) => hub.features),
    ...catalog.plans.enterprise.compliance,
  ];
  const rows = new Set(AREAS.flatMap((area) => area.features.map((feature) => feature.name)));

  it("gives every feature the page names a status, from Choose a version or its own, never both", () => {
    for (const label of labels) {
      const tracked = label in TRACKS;
      const own = label in OWN;
      expect(tracked !== own, label).toBe(true);
      expect(() => featureStatus(label), label).not.toThrow();
    }
  });

  it("names only features the catalog has and rows Choose a version has", () => {
    for (const label of [...Object.keys(TRACKS), ...Object.keys(OWN)])
      expect(labels, label).toContain(label);
    for (const names of Object.values(TRACKS))
      for (const name of names) expect(rows.has(name), name).toBe(true);
  });

  it("takes a tracked feature's status from Choose a version's row", () => {
    for (const [label, names] of Object.entries(TRACKS))
      expect(featureStatus(label), label).toBe(combine(names.map(rowStatus)));
  });

  it("ties each listed meter to features its add-on sells, or to any add-on's", () => {
    const meters = new Map(catalog.meters.map((meter) => [meter.id, meter]));
    for (const [id, features] of Object.entries(METER_FEATURES)) {
      const meter = meters.get(id);
      expect(meter, id).toBeDefined();
      const hub = catalog.hubs.find((entry) => entry.id === meter!.hub);
      for (const label of features)
        expect(hub ? hub.features : catalog.hub_includes, `${id}: ${label}`).toContain(label);
    }
    for (const id of Object.keys(METER_OWN)) {
      expect(meters.has(id), id).toBe(true);
      expect(id in METER_FEATURES, id).toBe(false);
    }
    for (const meter of catalog.meters)
      expect(() => meterStatus(meter, catalog), meter.id).not.toThrow();
  });

  it("gives a shared meter a status of its own, never Available by default", () => {
    for (const meter of catalog.meters.filter((entry) => entry.price !== null && !entry.hub))
      expect(meter.id in METER_OWN || meter.id in METER_FEATURES, meter.id).toBe(true);
  });

  it("sells at least one add-on today, so the page's floor price is one you can buy", () => {
    expect(catalog.hubs.some((hub) => hub.pricing === "listed" && works(hubStatus(hub)))).toBe(
      true,
    );
  });
});

describe("combine", () => {
  it("is available only when every part is, and partly when any part works", () => {
    expect(combine(["available", "available"])).toBe("available");
    expect(combine(["available", "roadmap"])).toBe("partial");
    expect(combine(["partial", "roadmap"])).toBe("partial");
    expect(combine(["next", "roadmap"])).toBe("next");
    expect(combine(["roadmap"])).toBe("roadmap");
  });
});
