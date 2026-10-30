import { type Brand, COLORS } from "../brands";
import type { IdentifierField } from "../scenes/identifier";
import { keystrokes } from "../scenes/typing";
import { beats } from "../timeline";

// What identifies a person is up to the user schema. After the cold open's
// email, the montage keeps the same view of the identifier step while it
// becomes each of these in turn, in a brand of its own, typed in quickly.

/** How long each identifier holds, in beats. */
export const IDENTIFIER_BEATS = 2;

export type Identifier = { brand: Brand; field: IdentifierField; text: string; keys: number[] };

const identifier = (brand: Brand, field: IdentifierField, text: string): Identifier => ({
  brand,
  field,
  text,
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
  ),
];
