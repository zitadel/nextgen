/**
 * `<zitadel-login>` playground (`http://localhost:5173/?route=login`).
 *
 * MSW handlers in `packages/api-mock/src/handlers.ts` recognize fixture
 * emails and return `step.error` without advancing the flow machine.
 *
 * ## Screens
 *
 * | Screen | How to reach |
 * |--------|----------------|
 * | Combined sign-in | Purpose **Sign in** (default) |
 * | Sign up | Purpose **Sign up** |
 * | Passkey upsell | Happy-path sign-in/register → submit |
 * | Signed in | Passkey upsell → **Skip for now** or successful **Set up passkey** |
 *
 * ## Happy path
 *
 * 1. Purpose **Sign in**, email `alice@acme.com` (any password), **Sign in**.
 * 2. Passkey upsell → **Skip for now** → “You're signed in as”.
 *
 * Register: Purpose **Sign up**, any email except `exists@example.com`, **Sign up** → same passkey step.
 *
 * ## Fixture emails (error / edge demos)
 *
 * **Sign in** — submit **Sign in** on the identifier step:
 *
 * | Email | UI |
 * |-------|-----|
 * | `wrong@example.com` | Inline password error “Wrong email or password.” |
 * | `server@example.com` | Form alert “We couldn't complete your sign in.” |
 *
 * **Sign up** — submit **Sign up**:
 *
 * | Email | UI |
 * |-------|-----|
 * | `exists@example.com` | Inline email error “An account with this email already exists.” |
 *
 * **Passkey upsell** — use the sign-in email below, complete **Sign in**, then **Set up passkey**:
 *
 * | Email (on sign-in) | UI after **Set up passkey** |
 * |--------------------|-----------------------------|
 * | `passkey-cancel@example.com` | Alert: “Passkey setup was cancelled” |
 * | `passkey-unsupported@example.com` | Alert: “This device does not support passkeys” |
 * | `passkey-fail@example.com` | Alert: “Something went wrong. Please try again.” |
 *
 * Any other email on passkey upsell → advances to signed-in (mock WebAuthn success).
 *
 * Restart the dev server after changing `handlers.ts` so the MSW worker reloads.
 */
import { applyBranding } from "@zitadel/api-mock";

import type { ZitadelLogin } from "../../src/orchestrator/index.js";
import { brandingPresets, type BrandingPresetId } from "../branding-presets.js";

const PRESET_LABEL: Record<BrandingPresetId, string> = {
  centered: "Centered (light)",
  split: "Split (light)",
  dark: "Centered (dark)",
};

export function renderLoginPage(host: HTMLElement): void {
  host.innerHTML = `
    <style>
      .layout {
        flex: 1 1 auto;
        display: grid;
        grid-template-columns: minmax(300px, 340px) 1fr;
        min-height: 0;
      }
      .controls {
        padding: 20px 22px 24px;
        background: var(--surface);
        border-right: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: 20px;
        overflow-y: auto;
      }
      .controls h2 {
        font-size: 12px;
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--muted);
      }
      .preview-note {
        font-size: 12px;
        line-height: 1.55;
        color: var(--muted);
        background: rgba(255, 200, 100, 0.08);
        border: 1px solid rgba(255, 200, 100, 0.25);
        border-radius: 8px;
        padding: 12px 14px;
        margin: 0;
      }
      .preview-note strong {
        color: var(--text);
        display: block;
        margin-bottom: 6px;
      }
      .preview-note code,
      .demo-docs code {
        font-family: "SF Mono", "Fira Code", monospace;
        font-size: 10.5px;
        background: rgba(0, 0, 0, 0.3);
        padding: 2px 5px;
        border-radius: 4px;
        word-break: break-all;
      }
      .demo-docs {
        display: flex;
        flex-direction: column;
        gap: 0;
        font-size: 12px;
        line-height: 1.55;
        color: var(--muted);
        background: rgba(255, 200, 100, 0.06);
        border: 1px solid rgba(255, 200, 100, 0.2);
        border-radius: 8px;
        padding: 4px 0;
        margin: 0;
      }
      .demo-section {
        padding: 14px 14px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      .demo-section:last-child {
        border-bottom: none;
        padding-bottom: 12px;
      }
      .demo-section h3 {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.45px;
        color: var(--text);
        margin: 0 0 12px;
      }
      .demo-lead {
        margin: 0 0 12px;
        font-size: 11.5px;
        line-height: 1.5;
      }
      .demo-item {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 16px;
      }
      .demo-item:last-child {
        margin-bottom: 0;
      }
      .demo-email {
        display: block;
        width: fit-content;
        max-width: 100%;
      }
      .demo-outcome {
        margin: 0;
        font-size: 11.5px;
        line-height: 1.45;
      }
      .demo-footnote {
        margin: 0;
        padding: 12px 14px 14px;
        font-size: 10.5px;
        line-height: 1.5;
        opacity: 0.85;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
      }
      .controls label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: var(--muted);
      }
      .controls select,
      .controls button {
        background: rgba(108, 140, 255, 0.08);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 13px;
      }
      .controls button {
        cursor: pointer;
      }
      .controls button:hover {
        background: rgba(108, 140, 255, 0.18);
      }
      .events {
        flex: 1 1 auto;
        min-height: 120px;
        overflow: auto;
        background: rgba(0, 0, 0, 0.25);
        border-radius: 6px;
        padding: 8px;
        font-family: "SF Mono", "Fira Code", monospace;
        font-size: 11px;
        line-height: 1.5;
        color: var(--muted);
      }
      .frame {
        position: relative;
        background: #0b0d12;
        overflow: auto;
      }
      zitadel-login {
        display: block;
        width: 100%;
        min-height: 100%;
      }
    </style>
    <div class="layout">
      <aside class="controls">
        <p class="preview-note">
          <strong>MSW flow walk</strong>
          Typed <code>@zitadel/api</code> client; responses from
          <code>@zitadel/api-mock</code>.<br />
          Fixture emails below are handled in <code>handlers.ts</code>.<br />
          Recovery / MFA need a real backend.
        </p>
        <h2>Flow</h2>
        <label>
          <span>Purpose</span>
          <select id="purpose">
            <option value="login">Sign in</option>
            <option value="register">Sign up</option>
          </select>
        </label>
        <h2>Dev demos</h2>
        <div class="demo-docs">
          <section class="demo-section">
            <h3>Happy path</h3>
            <div class="demo-item">
              <strong class="demo-outcome">Sign in</strong>
              <code class="demo-email">alice@acme.com</code>
              <p class="demo-outcome">Any password → <strong>Sign in</strong> → passkey upsell → <strong>Skip for now</strong> → signed in</p>
            </div>
            <div class="demo-item">
              <strong class="demo-outcome">Sign up</strong>
              <p class="demo-outcome">Any email not listed below → <strong>Sign up</strong> → passkey → skip → signed in</p>
            </div>
          </section>

          <section class="demo-section">
            <h3>Sign in fixtures</h3>
            <p class="demo-lead">Submit <strong>Sign in</strong> on the combined card.</p>
            <div class="demo-item">
              <code class="demo-email">wrong@example.com</code>
              <p class="demo-outcome">Inline password error: “Wrong email or password.”</p>
            </div>
            <div class="demo-item">
              <code class="demo-email">server@example.com</code>
              <p class="demo-outcome">Form alert: “We couldn't complete your sign in.”</p>
            </div>
          </section>

          <section class="demo-section">
            <h3>Sign up fixture</h3>
            <p class="demo-lead">Submit <strong>Sign up</strong>.</p>
            <div class="demo-item">
              <code class="demo-email">exists@example.com</code>
              <p class="demo-outcome">Inline email error: account already exists.</p>
            </div>
          </section>

          <section class="demo-section">
            <h3>Passkey fixtures</h3>
            <p class="demo-lead">Enter email on <strong>Sign in</strong>, complete sign-in, then <strong>Set up passkey</strong>.</p>
            <div class="demo-item">
              <code class="demo-email">passkey-cancel@example.com</code>
              <p class="demo-outcome">“Passkey setup was cancelled”</p>
            </div>
            <div class="demo-item">
              <code class="demo-email">passkey-unsupported@example.com</code>
              <p class="demo-outcome">“This device does not support passkeys”</p>
            </div>
            <div class="demo-item">
              <code class="demo-email">passkey-fail@example.com</code>
              <p class="demo-outcome">“Something went wrong. Please try again.”</p>
            </div>
            <div class="demo-item">
              <p class="demo-outcome"><strong>Any other email</strong> — mock success → signed in</p>
            </div>
          </section>

          <p class="demo-footnote">
            Restart <code>pnpm --filter @zitadel/components dev</code> after editing <code>handlers.ts</code>.
          </p>
        </div>
        <h2>Branding</h2>
        <label>
          <span>Preset</span>
          <select id="preset">
            ${(Object.keys(brandingPresets) as BrandingPresetId[])
              .map((id) => `<option value="${id}">${PRESET_LABEL[id]}</option>`)
              .join("")}
          </select>
        </label>
        <button id="reset" type="button">Restart flow</button>
        <h2>Events</h2>
        <pre class="events" id="events"></pre>
      </aside>
      <section class="frame" id="frame"></section>
    </div>
  `;

  const select = host.querySelector<HTMLSelectElement>("#preset");
  const purposeSelect = host.querySelector<HTMLSelectElement>("#purpose");
  const resetButton = host.querySelector<HTMLButtonElement>("#reset");
  const frameEl = host.querySelector<HTMLElement>("#frame");
  const eventsEl = host.querySelector<HTMLPreElement>("#events");
  if (!select || !purposeSelect || !resetButton || !frameEl || !eventsEl) {
    throw new Error("Login playground markup is missing required nodes.");
  }
  const frame: HTMLElement = frameEl;
  const events: HTMLPreElement = eventsEl;

  function logEvent(name: string, detail: unknown): void {
    const time = new Date().toLocaleTimeString();
    events.textContent = `[${time}] ${name} ${JSON.stringify(detail)}\n${events.textContent}`;
  }

  function mount(presetId: BrandingPresetId): void {
    applyBranding(brandingPresets[presetId]);
    frame.innerHTML = "";
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = purposeSelect.value;
    // The project handle is configured once globally in `dev/main.ts`
    // (`configureZitadel({ projectId: "dev" })`); the element reads it via
    // `getZitadelConfig()`, so nothing per-instance is needed here.
    element.addEventListener("zitadel-flow-input", (event) =>
      logEvent("zitadel-flow-input", (event as CustomEvent).detail),
    );
    element.addEventListener("zitadel-flow-action", (event) =>
      logEvent("zitadel-flow-action", (event as CustomEvent).detail),
    );
    element.addEventListener("zitadel-flow-step", (event) =>
      logEvent("zitadel-flow-step", { step: (event as CustomEvent).detail.step.name }),
    );
    element.addEventListener("zitadel-flow-complete", (event) =>
      logEvent("zitadel-flow-complete", (event as CustomEvent).detail),
    );
    element.addEventListener("zitadel-flow-error", (event) =>
      logEvent("zitadel-flow-error", (event as CustomEvent).detail),
    );
    frame.appendChild(element);
  }

  const remount = () => mount(select.value as BrandingPresetId);
  select.addEventListener("change", remount);
  purposeSelect.addEventListener("change", remount);
  resetButton.addEventListener("click", remount);

  mount("centered");
}
