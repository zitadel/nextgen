import { IdentifierShot } from "./identifier";
import { KEYSTROKES, TYPED } from "./typing";

// The cold open: the identifier step of the default login, close on its email
// field, a caret blinking on the beat in it. The address is typed, and Enter
// is the cut to the montage.

export function ColdOpen() {
  return (
    <IdentifierShot
      field={{
        label: "Email",
        type: "email",
        placeholder: "you@example.com",
        subtitle: "Enter your email to continue",
      }}
      text={TYPED}
      keys={KEYSTROKES}
    />
  );
}
