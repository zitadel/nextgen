"use client";

import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { useId } from "react";

import { flatLook } from "./flat-look";
import { MockedLogin } from "./shared";

export interface StyledLoginExampleProps {
  /** `--zl-font-family-sans`, the login's typeface. */
  fontFamily?: string;
  /** `--zl-primary`, the primary button. */
  primary?: string;
  /** `--zl-primary-foreground`, the text on the primary button. */
  primaryForeground?: string;
  /** `--zl-radius-xs` to `--zl-radius-xl`, every corner. */
  radius?: string;
  /** `::part(button-root)`, the buttons' letter case. */
  uppercaseButtons?: boolean;
  /** `::part(card-card)`, a hard frame around the card in the primary colour. */
  cardFrame?: boolean;
}

/** The stylesheet an app sets these with, as the guide's example writes it. */
function stylesheet(
  {
    fontFamily,
    primary,
    primaryForeground,
    radius,
    uppercaseButtons,
    cardFrame,
  }: Required<StyledLoginExampleProps>,
  selector = "zitadel-login",
) {
  const radii = ["xs", "sm", "md", "lg", "xl"].map((size) => `  --zl-radius-${size}: ${radius};`);
  const rule = (part: string, ...declarations: string[]) => [
    "",
    `${selector}::part(${part}) {`,
    ...declarations.map((declaration) => `  ${declaration};`),
    "}",
  ];
  return [
    `${selector} {`,
    `  --zl-font-family-sans: ${fontFamily};`,
    `  --zl-primary: ${primary};`,
    `  --zl-primary-foreground: ${primaryForeground};`,
    ...radii,
    "}",
    ...(cardFrame
      ? rule("card-card", `border: 3px solid ${primary}`, `box-shadow: 6px 6px 0 ${primary}`)
      : []),
    ...(uppercaseButtons ? rule("button-root", "text-transform: uppercase") : []),
  ].join("\n");
}

/**
 * `<zitadel-login>` under a stylesheet built from the controls, shown below
 * it: guides/customize-design.mdx's example of the tokens and parts.
 */
export function StyledLoginExample(props: StyledLoginExampleProps) {
  const values = { ...flatLook, ...props };
  // The stylesheet reaches this example's login only, as an app's would reach
  // its own.
  const id = useId();
  return (
    <div className="flex w-full flex-col gap-4" data-styled-login={id}>
      <style>{stylesheet(values, `[data-styled-login="${id}"] zitadel-login`)}</style>
      <MockedLogin />
      <CodeBlock title="Your stylesheet" className="my-0">
        <Pre>{stylesheet(values)}</Pre>
      </CodeBlock>
    </div>
  );
}
