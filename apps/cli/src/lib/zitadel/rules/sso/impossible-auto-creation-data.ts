import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { propertyName } from "@/lib/zitadel/names";
import { closest } from "@/lib/zitadel/utils/spelling";
import { quote, readableProperties, standing, unreadable } from "@/lib/zitadel/rules/sso/shared";

/**
 * A connection that creates users automatically maps no claim to a property its schema requires of
 * every user.
 *
 * @remarks
 * Why it matters: Automatic creation can never complete for this schema. It is only a warning
 * because the project still deploys and can sign people in.
 *
 * Reported once: Only a mapping that fills something the schema defines is judged: a mapping that
 * fills nothing is reported by sso/empty-claim-mapping, and an unknown target by sso/orphaned-mapping-target. A required property that an unknown mapping target most likely meant is not
 * reported, because that typo is already an error.
 *
 * Fix: Map the property in the connection file to create users without asking.
 *
 * Origin: #3287 (Impossible Auto-Creation (Data) of #1083);
 * docs/design/idp/1-resource-model.md#validator-rules.
 */
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
      const fillsSomething = connection.mappings.some((row) => {
        return offer.schema.has(row.property);
      });
      if (!fillsSomething) {
        return [];
      }
      const entry = entries.find((candidate) => {
        return candidate.connection === connection;
      });
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
    return `${where}: ${quote(fact.slug)} creates users automatically, but a user of ${fact.schema.path} must end up with ${names} and claim_mapping of ${fact.connection.path} maps no claim to it, so automatic creation can never complete. Map ${names} in ${fact.connection.path} to create users without asking.`;
  },
});
