import { refuses } from "../../../../lib/oclif/rules";

/** Refuses `--secret` with a type other than string, because a secret is stored as a string. */
export const secretAsStringRule = refuses(
  (view) => view.flags.secret === true && view.flags.as !== "string",
  {
    message: "A secret is stored as a string.",
    hint: "Drop --as, or drop --secret for a non-credential number or boolean.",
  },
);
