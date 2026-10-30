import type { Brand } from "../brands";
import type { IdentifierField } from "../scenes/identifier";
import { keystrokes } from "../scenes/typing";
import { beats, seconds } from "../timeline";

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
  keys: keystrokes(text, seconds(0.05), beats(IDENTIFIER_BEATS) - seconds(0.23), `id-${text}`),
});

// All four stay in the cold open's dark, each with a muted, deep brand colour
// on its button and a lighter tone of it on the field's ring, so the change
// reads as the identifier and the finish of the field, not as a new palette.
const MUTED = {
  purple: "#4a2f6b",
  olive: "#4d5b3a",
  slate: "#33465c",
  burgundy: "#6d2f38",
};

export const IDENTIFIERS: Identifier[] = [
  identifier(
    { theme: "dark", color: MUTED.purple, corners: "soft", headings: "serif" },
    {
      label: "Username",
      type: "text",
      placeholder: "your.name",
      subtitle: "Enter your username to continue",
    },
    "ada.lovelace",
    // Filled, ringed in the brand's purple.
    `& {
      --zl-ring: #8a6bb8;
      --zl-ring-outline: rgb(138 107 184 / 0.4);
    }
    &::part(input-wrap) {
      background: rgb(255 255 255 / 0.07);
    }`,
  ),
  identifier(
    { theme: "dark", color: MUTED.olive, corners: "sharp", headings: "sans" },
    {
      label: "Phone",
      type: "tel",
      placeholder: "079 000 00 00",
      subtitle: "Enter your phone number to continue",
    },
    "079 123 45 67",
    // A thick underline in the brand's olive, glowing faintly beneath.
    `&::part(input-wrap) {
      border-width: 0 0 2px;
      border-color: #8a9c6a;
      border-radius: 0;
      box-shadow: 0 10px 14px -10px rgb(138 156 106 / 0.7);
      background: linear-gradient(to top, rgb(138 156 106 / 0.12), transparent);
      padding-inline: 10px;
    }`,
  ),
  identifier(
    { theme: "dark", color: MUTED.slate, corners: "soft", headings: "mono" },
    {
      label: "Employee ID",
      type: "text",
      placeholder: "EMP-0000",
      subtitle: "Enter your employee ID",
    },
    "EMP-1815",
    // A thin outline and, apart from it, a second ring in the brand's slate;
    // a small capital label.
    `&::part(input-wrap) {
      border-color: #6f87a6;
      box-shadow:
        0 0 0 3px var(--zl-card),
        0 0 0 5px #6f87a6;
    }
    &::part(label) {
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }`,
  ),
  identifier(
    { theme: "dark", color: MUTED.burgundy, corners: "round", headings: "sans" },
    {
      label: "Customer number",
      type: "text",
      placeholder: "0000 0000",
      subtitle: "Enter your customer number",
    },
    "4021 7788",
    // A pill with a wide ring in the brand's burgundy, its digits apart.
    `&::part(input-wrap) {
      border-radius: 999px;
      border-color: #b25a66;
      box-shadow: 0 0 0 5px rgb(178 90 102 / 0.35);
      background: rgb(255 255 255 / 0.04);
      padding-inline: 18px;
    }
    &::part(input) {
      letter-spacing: 0.05em;
    }`,
  ),
];
