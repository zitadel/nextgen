import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote } from "@/lib/zitadel/rules/sso/shared";

export const DUPLICATE_SLUG: Rule = defineRule({
  id: "sso/duplicate-slug",
  severity: "error",
  each: (config) => {
    return config.connections.all.flatMap((connection) => {
      const first = config.connections.find(connection.slug);
      if (first === undefined || first === connection) {
        return [];
      }
      return [{ connection, slug: connection.slug, first }];
    });
  },
  file: (fact) => {
    return fact.connection.path;
  },
  says: (fact) => {
    return `connection slug ${quote(fact.slug)} is also used by ${fact.first.path}. A slug names one connection: change the slug here, or delete one of the two files.`;
  },
});
