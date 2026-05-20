import { createComponent } from "@lit/react";
import { createFileRoute } from "@tanstack/react-router";
import { applyBranding } from "@zitadel-nextgen/api-mock";
import {
  ZitadelLogin,
  ZlAction,
  ZlError,
  ZlField,
  ZlSubmit,
  type Branding,
} from "@zitadel-nextgen/components";
import react from "react";

const ZitadelLoginEl = createComponent({
  tagName: "zitadel-login",
  elementClass: ZitadelLogin,
  react,
});
const ZlFieldEl = createComponent({
  tagName: "zl-field",
  elementClass: ZlField,
  react,
});
const ZlSubmitEl = createComponent({
  tagName: "zl-submit",
  elementClass: ZlSubmit,
  react,
});
const ZlActionEl = createComponent({
  tagName: "zl-action",
  elementClass: ZlAction,
  react,
});
const ZlErrorEl = createComponent({
  tagName: "zl-error",
  elementClass: ZlError,
  react,
});

const brandingPresets = {
  centered: {
    layout: "centered",
    palette: {
      primary: "#4A90D9",
      on_primary: "#FFFFFF",
      background: "#F8FAFC",
      surface: "#FFFFFF",
      muted: "#F1F5F9",
      border: "#E2E8F0",
      text: "#0F172A",
      text_muted: "#64748B",
      link: "#2563EB",
    },
    typography: { font_family: "'Inter', ui-sans-serif, system-ui, sans-serif" },
    shape: { radius: "md", density: "regular" },
  } satisfies Branding,
  dark: {
    layout: "centered",
    palette: {
      primary: "#7C9CFF",
      on_primary: "#0A0A0A",
      background: "#0A0A0A",
      surface: "#111111",
      muted: "#1A1A1A",
      border: "#262626",
      text: "#FAFAFA",
      text_muted: "#A1A1AA",
      link: "#9DBBFF",
    },
    typography: { font_family: "'Inter', ui-sans-serif, system-ui, sans-serif" },
    shape: { radius: "md", density: "regular" },
    theme: { mode: "dark" },
  } satisfies Branding,
} as const;

type PresetId = keyof typeof brandingPresets;

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [presetId, setPresetId] = react.useState<PresetId>("centered");
  const [mountKey, setMountKey] = react.useState(0);

  react.useEffect(() => {
    applyBranding(brandingPresets[presetId]);
    setMountKey((n) => n + 1);
  }, [presetId]);

  return (
    <div className="mx-auto max-w-5xl space-y-12 p-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Components preview</h1>
        <p className="text-zinc-600">
          Renders <code>@zitadel-nextgen/components</code> through <code>@lit/react</code>. The
          composed <code>&lt;zitadel-login&gt;</code> orchestrator below calls the typed Flow API in{" "}
          <code>@zitadel-nextgen/api</code>; requests are intercepted in dev by an MSW worker driven
          by <code>@zitadel-nextgen/api-mock</code>'s xstate flow machine. Type any email, then any
          password to walk the canonical flow.
        </p>
      </header>

      <section className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              <code>&lt;zitadel-login&gt;</code>
            </h2>
            <p className="text-sm text-zinc-600">
              Drop-in orchestrator. Backed by <code>@zitadel-nextgen/api-mock</code> in dev.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-wide text-zinc-500">Branding</label>
            <select
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value as PresetId)}
            >
              <option value="centered">Centered (light)</option>
              <option value="dark">Centered (dark)</option>
            </select>
            <button
              type="button"
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm hover:bg-zinc-50"
              onClick={() => setMountKey((n) => n + 1)}
            >
              Restart
            </button>
          </div>
        </header>
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <ZitadelLoginEl key={mountKey} purpose="login" project-id="console-preview" />
        </div>
      </section>

      <section className="space-y-4">
        <header>
          <h2 className="text-xl font-semibold">Atoms</h2>
          <p className="text-sm text-zinc-600">
            Standalone samples — these are individual primitives, not a working form. The composed
            form is the orchestrator above.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          <AtomCard
            tag="<zl-field>"
            description="Form-associated text input. Email variant with placeholder."
          >
            <ZlFieldEl
              name="email-sample"
              label="Email"
              type="email"
              autocomplete="username"
              placeholder="you@example.com"
            />
          </AtomCard>

          <AtomCard
            tag="<zl-field>"
            description="Required password variant. Shows the asterisk + native validity."
          >
            <ZlFieldEl
              name="password-sample"
              label="Password"
              type="password"
              autocomplete="current-password"
              required
            />
          </AtomCard>

          <AtomCard
            tag="<zl-submit>"
            description="Primary submit. Wired to the surrounding form's submit cycle."
          >
            <ZlSubmitEl action="submit-sample" label="Continue" />
          </AtomCard>

          <AtomCard
            tag="<zl-action>"
            description="Secondary action. Ghost variant for low-emphasis links."
          >
            <ZlActionEl action="register-sample" label="Create account" ghost />
          </AtomCard>

          <AtomCard
            tag="<zl-error>"
            description="Step-level error region. Hidden when message is empty."
            full
          >
            <ZlErrorEl message="Sample error message — would appear after a failed submit." />
          </AtomCard>
        </div>
      </section>
    </div>
  );
}

function AtomCard({
  tag,
  description,
  full,
  children,
}: {
  tag: string;
  description: string;
  full?: boolean;
  children: react.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-zinc-200 bg-white p-4 shadow-sm ${
        full ? "sm:col-span-2" : ""
      }`}
    >
      <div className="mb-3">
        <code className="text-sm font-semibold text-zinc-900">{tag}</code>
        <p className="mt-1 text-xs text-zinc-500">{description}</p>
      </div>
      {children}
    </div>
  );
}
