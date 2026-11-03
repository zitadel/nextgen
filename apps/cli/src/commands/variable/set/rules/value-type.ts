import { refuses } from "../../../../lib/oclif/rules";
import { parseVariableValue, type VariableType } from "../../../../lib/variables";

/** Refuses a value that does not parse as the type `--as` names. */
export const valueTypeRule = refuses(
  (view) => {
    const { value } = view.args;
    return (
      typeof value === "string" && !parseVariableValue(value, view.flags.as as VariableType).ok
    );
  },
  {
    message: '"{value}" is not a valid {as} value.',
    hint: "A boolean variable is exactly `true` or `false`, and a number is a JSON number such as 5, -1.5 or 1e3. Pass --as string to keep it as text.",
  },
);
