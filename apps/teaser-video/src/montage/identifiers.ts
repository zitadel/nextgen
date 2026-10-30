import { type Brand, COLORS } from "../brands";
import type { IdentifierField } from "../scenes/identifier";
import { keystrokes } from "../scenes/typing";
import { beats } from "../timeline";

// What identifies a person is up to the user schema. After the cold open's
// email, the montage keeps the same view of the identifier step while it
// becomes each of these in turn, typed in quickly, in a brand of its own and
// with the field restyled as an app can restyle it: through the --zl-*
// properties and `zl-field`'s CSS parts (input-wrap, input, label).

/** How long each identifier holds, in beats. */
export const IDENTIFIER_BEATS = 2;

export type Identifier = {
  brand: Brand;
  field: IdentifierField;
  text: string;
  keys: number[];
  /** How the app restyles the field: a rule for `zl-field`'s parts, `&` standing for the field. */
  look: string;
};

const identifier = (
  brand: Brand,
  field: IdentifierField,
  text: string,
  look: string,
): Identifier => ({
  brand,
  field,
  text,
  look,
  // Typed from the cut, done well before the next one, so the value rests a
  // moment with the caret blinking after it.
  keys: keystrokes(text, 3, beats(IDENTIFIER_BEATS) - 14, `id-${text}`),
});

export const IDENTIFIERS: Identifier[] = [
  identifier(
    { theme: "light", color: COLORS.blue, corners: "soft", headings: "serif" },
    {
      label: "Username",
      type: "text",
      placeholder: "your.name",
      subtitle: "Enter your username to continue",
    },
    "ada.lovelace",
    // A soft glow in the brand's blue instead of the grey ring.
    `& { --zl-ring-outline: color-mix(in srgb, ${COLORS.blue} 30%, transparent); }`,
  ),
  identifier(
    { theme: "dark", color: COLORS.green, corners: "round", headings: "sans" },
    {
      label: "Phone",
      type: "tel",
      placeholder: "079 000 00 00",
      subtitle: "Enter your phone number to continue",
    },
    "079 123 45 67",
    // A filled pill: no border, no ring, the brand's green as its fill.
    `&::part(input-wrap) {
      border-color: transparent;
      box-shadow: none;
      background: color-mix(in srgb, ${COLORS.green} 18%, transparent);
    }`,
  ),
  identifier(
    { theme: "light", color: COLORS.purple, corners: "sharp", headings: "mono" },
    {
      label: "Employee ID",
      type: "text",
      placeholder: "EMP-0000",
      subtitle: "Enter your employee ID",
    },
    "EMP-1815",
    // An underline alone, and a small capital label above it.
    `&::part(input-wrap) {
      border-width: 0 0 2px;
      border-color: ${COLORS.purple};
      border-radius: 0;
      box-shadow: none;
      background: transparent;
      padding-inline: 0;
    }
    &::part(label) {
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }`,
  ),
  identifier(
    { theme: "dark", color: COLORS.orange, corners: "soft", headings: "serif" },
    {
      label: "Customer number",
      type: "text",
      placeholder: "0000 0000",
      subtitle: "Enter your customer number",
    },
    "4021 7788",
    // A heavy border with a wide halo, and larger, spaced digits.
    `&::part(input-wrap) {
      border: 2px solid ${COLORS.orange};
      box-shadow: 0 0 0 6px color-mix(in srgb, ${COLORS.orange} 22%, transparent);
    }
    &::part(input) {
      font-size: 17px;
      letter-spacing: 0.08em;
    }`,
  ),
];
