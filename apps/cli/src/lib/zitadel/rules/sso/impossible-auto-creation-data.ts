import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { propertyName } from "@/lib/zitadel/names";
import { closest } from "@/lib/zitadel/utils/spelling";
import { quote, readableProperties, standing, unreadable } from "@/lib/zitadel/rules/sso/shared";

export const IMPOSSIBLE_AUTO_CREATION_DATA: Rule = defineRule({
  id: "sso/impossible-auto-creation-data",
  severity: "warning",
  each: (config) => {
    const entries = standing(config);
    return config.flows.pinnedOffers.flatMap((offer) => {
      const connection = offer.connection;
      if (connection === undefined || !connection.createsUsers) {
        return [];
      }
      // A mapping that fills nothing the schema defines is already reported
      // by sso/empty-claim-mapping, or as an unknown target; this rule only
      // judges a mapping that fills something.
      const fillsSomething = connection.mappings.some((row) => {
        return offer.schema.has(row.property);
      });
      if (!fillsSomething) {
        return [];
      }
      const entry = entries.find((candidate) => {
        return candidate.connection === connection;
      });
      // A mapping target no listing schema defines that is the nearest name to
      // a required property is a typo sso/orphaned-mapping-target reports.
      const meant =
        entry === undefined
          ? []
          : connection.mappings
              .filter((row) => {
                return unreadable(entry, row.property);
              })
              .map((row) => {
                return closest(
                  row.property,
                  readableProperties(entry).filter((name) => {
                    return !connection.maps(name);
                  }),
                );
              });
      const missing = [
        ...new Set(
          offer.schema.requiredByServer.map((path) => {
            return path.split(".")[0] ?? path;
          }),
        ),
      ].filter((name) => {
        return !connection.maps(propertyName(name)) && !meant.includes(name);
      });
      if (missing.length === 0) {
        return [];
      }
      return [{ ...offer, connection, missing }];
    });
  },
  file: (fact) => {
    return fact.flow.path;
  },
  steps: {
    step: (fact) => {
      return fact.step.name;
    },
    cause: (fact) => {
      return fact.slug;
    },
  },
  says: (fact, where) => {
    const names = fact.missing.map(quote).join(", ");
    return `${where}: ${quote(fact.slug)} creates users automatically, but a user of ${fact.schema.path} must end up with ${names} and claim_mapping of ${fact.connection.path} maps no claim to it, so automatic creation can never complete and every new user is asked for it instead. Map ${names} in ${fact.connection.path} to create users without asking.`;
  },
});
