/**
 * `<zitadel-login>` playground. Mounts the orchestrator with a
 * {@link WalkingFixtureTransport} that walks a real flow definition via
 * `step.transitions`. Branding can be switched live and the password step's
 * identity is hydrated from whatever the user types into the identifier
 * field.
 *
 * It is still a fixture: the in-memory flow only models the happy login
 * path. Real branching flows (register, recovery, MFA) come from the Flow
 * API once `@zitadel-nextgen/api` is wired up.
 */
import { WalkingFixtureTransport, type ZitadelLogin } from "../../src/orchestrator/index.js";
import {
  brandingPresets,
  decorateLoginStep,
  loginFlow,
  type BrandingPresetId,
} from "../fixtures/index.js";

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
        grid-template-columns: 280px 1fr;
        min-height: 0;
      }
      .controls {
        padding: 24px;
        background: var(--surface);
        border-right: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .controls h2 {
        font-size: 13px;
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--muted);
      }
      .preview-note {
        font-size: 11px;
        line-height: 1.5;
        color: var(--muted);
        background: rgba(255, 200, 100, 0.08);
        border: 1px solid rgba(255, 200, 100, 0.25);
        border-radius: 6px;
        padding: 8px 10px;
      }
      .preview-note strong {
        color: var(--text);
        display: block;
        margin-bottom: 4px;
      }
      .preview-note code {
        font-family: "SF Mono", "Fira Code", monospace;
        background: rgba(0, 0, 0, 0.3);
        padding: 1px 4px;
        border-radius: 3px;
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
          <strong>Fixture-driven happy path.</strong>
          The orchestrator walks an in-memory <code>FlowDefinition</code>
          (identifier &rarr; password &rarr; done) via
          <code>WalkingFixtureTransport</code>. Whatever email you type carries
          forward as the identity on the password step. Branching flows
          (register, recovery, MFA) arrive once
          <code>@zitadel-nextgen/api</code> ships.
        </p>
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
  const resetButton = host.querySelector<HTMLButtonElement>("#reset");
  const frameEl = host.querySelector<HTMLElement>("#frame");
  const eventsEl = host.querySelector<HTMLPreElement>("#events");
  if (!select || !resetButton || !frameEl || !eventsEl) {
    throw new Error("Login playground markup is missing required nodes.");
  }
  const frame: HTMLElement = frameEl;
  const events: HTMLPreElement = eventsEl;

  function logEvent(name: string, detail: unknown): void {
    const time = new Date().toLocaleTimeString();
    events.textContent = `[${time}] ${name} ${JSON.stringify(detail)}\n${events.textContent}`;
  }

  function mount(presetId: BrandingPresetId): void {
    frame.innerHTML = "";
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.transport = new WalkingFixtureTransport({
      flow: loginFlow,
      branding: brandingPresets[presetId],
      decorate: decorateLoginStep,
    });
    element.purpose = "login";
    element.addEventListener("zitadel-flow-input", (event) =>
      logEvent("zitadel-flow-input", (event as CustomEvent).detail),
    );
    element.addEventListener("zitadel-flow-action", (event) =>
      logEvent("zitadel-flow-action", (event as CustomEvent).detail),
    );
    element.addEventListener("zitadel-flow-step", (event) =>
      logEvent("zitadel-flow-step", { step: (event as CustomEvent).detail.step.name }),
    );
    element.addEventListener("zitadel-flow-error", (event) =>
      logEvent("zitadel-flow-error", (event as CustomEvent).detail),
    );
    frame.appendChild(element);
  }

  select.addEventListener("change", () => mount(select.value as BrandingPresetId));
  resetButton.addEventListener("click", () => mount(select.value as BrandingPresetId));

  mount("centered");
}
