import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { layoutChromeCss, zitadelTrustmarkInnerHtml } from "@zitadel/components";
import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

import "@zitadel/components/atoms";

/**
 * The trustmark is light-DOM chrome that the orchestrator styles from its own
 * adopted stylesheet, so a bare shell has to bring those rules itself. Adopted
 * into the document rather than written into a `<style>` element: lit drops
 * bindings inside `<style>`, which silently leaves the mark unstyled.
 * `:host(...)` rules in the sheet simply don't match here and are ignored.
 */
if (typeof CSSStyleSheet !== "undefined" && "adoptedStyleSheets" in document) {
  const chrome = new CSSStyleSheet();
  chrome.replaceSync(layoutChromeCss);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, chrome];
}

interface PageShellArgs {
  heading: string;
  body: string;
  withFooter: boolean;
}

/**
 * Page shell atom (`<zl-page-shell>`) — the full-bleed auth chrome that owns the
 * page surface, vertical centring, and the footer attribution slot.
 *
 * `layout: "fullscreen"` so the shell's `100vh` body isn't fighting the
 * centred-canvas padding.
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

export const Default: Story = {
  render: ({ heading, body, withFooter }) => html`
    <zl-page-shell>
      <div>
        <h1>${heading}</h1>
        <p>${body}</p>
      </div>
      ${withFooter
        ? html`<div slot="footer" class="zl-attribution zl-trustmark">
            <a
              class="zl-trustmark__mark"
              href="https://zitadel.com"
              aria-label="Secured with Zitadel"
              >${unsafeHTML(zitadelTrustmarkInnerHtml())}</a
            >
          </div>`
        : nothing}
    </zl-page-shell>
  `,
};
