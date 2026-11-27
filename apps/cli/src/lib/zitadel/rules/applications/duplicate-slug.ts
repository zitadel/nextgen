import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";

/**
 * Two application files claim the same slug.
 *
 * @remarks
 * Why it matters: A release pins one application per slug, so the server
 * refuses the release (`rel.invalid`) after the deploy has started.
 *
 * Reported once: Only the second and later files are reported; the first file,
 * in path order, is the application the slug stands for.
 *
 * Fix: Change the slug in the file named, or delete one of the two files.
 *
 * Origin: #2790; the build bundle's handle rules in
 * `apps/api/api/openapi/endpoints/releases/build/configuration-bundle.yaml`.
 */
export const DUPLICATE_SLUG: Rule = defineRule({
  id: "application/duplicate-slug",
  severity: "error",
  each: (config) => {
    return config.applications.all.flatMap((application) => {
      const first = config.applications.find(application.slug);
      if (first === undefined || first === application) {
        return [];
      }
      return [{ application, first }];
    });
  },
  file: (fact) => {
    return fact.application.path;
  },
  says: (fact) => {
    return `application slug ${JSON.stringify(fact.application.slug)} is also used by ${fact.first.path}. A slug names one application: change the slug here, or delete one of the two files.`;
  },
});
