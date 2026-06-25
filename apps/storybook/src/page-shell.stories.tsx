import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { zitadelAttributionPillInnerHtml } from "@zitadel/shared-component-styles/attribution-markup";
import { PageShell, Pill, ZitadelAttributionPillLabel } from "@zitadel/ui-react";
import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

import { renderReact } from "./react-render.js";

import "@zitadel/components/atoms";

interface PageShellArgs {
  heading: string;
  body: string;
  withFooter: boolean;
}

/**
 * Page shell atom — the Lit web component (`<zl-page-shell>`) and its paired
 * React implementation (`<PageShell>`) side by side. The full-bleed auth chrome
 * that owns the dark surface, vertical centring, and footer attribution slot.
 *
 * `layout: "fullscreen"` so the shell's `100vh` body isn't fighting the
 * centred-canvas padding. One controls-driven story per renderer.
 */
const meta: Meta<PageShellArgs> = {
  title: "Atoms/Page Shell",
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: {
    heading: "Welcome back",
    body: "This is the centred main region of the page shell.",
    withFooter: true,
  },
  argTypes: {
    heading: { control: "text" },
    body: { control: "text" },
    withFooter: { control: "boolean", description: "Render the footer attribution pill." },
  },
};

export default meta;
type Story = StoryObj<PageShellArgs>;

export const Lit: Story = {
  render: ({ heading, body, withFooter }) => html`
    <zl-page-shell>
      <div>
        <h1>${heading}</h1>
        <p>${body}</p>
      </div>
      ${withFooter
        ? html`<zl-pill slot="footer" href="https://zitadel.com" aria-label="Secured with Zitadel"
            >${unsafeHTML(zitadelAttributionPillInnerHtml())}</zl-pill
          >`
        : nothing}
    </zl-page-shell>
  `,
};

export const React: Story = {
  render: ({ heading, body, withFooter }) =>
    renderReact(
      <PageShell
        footer={
          withFooter ? (
            <Pill href="https://zitadel.com" aria-label="Secured with Zitadel">
              <ZitadelAttributionPillLabel />
            </Pill>
          ) : undefined
        }
      >
        <div>
          <h1>{heading}</h1>
          <p>{body}</p>
        </div>
      </PageShell>,
    ),
};
