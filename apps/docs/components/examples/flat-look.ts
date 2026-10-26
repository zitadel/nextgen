import type { StyledLoginExampleProps } from "./styled-login";

/**
 * The flat, hard-edged look the design guide's stylesheet sets, which its
 * example starts from. Apart from styled-login.tsx, a client module, so that
 * its story, which runs on the server, can read it too.
 */
export const flatLook: Required<StyledLoginExampleProps> = {
  fontFamily: '"Space Mono", ui-monospace, monospace',
  primary: "#0a0a0a",
  primaryForeground: "#c6ff00",
  radius: "0",
  uppercaseButtons: true,
  cardFrame: true,
};
