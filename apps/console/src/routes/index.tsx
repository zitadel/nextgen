import { createComponent } from "@lit/react";
import { createFileRoute } from "@tanstack/react-router";
import {
  WalkingFixtureTransport,
  ZitadelLogin,
  ZlAction,
  ZlError,
  ZlField,
  ZlSubmit,
  type FlowDefinition,
  type WalkingFixtureOptions,
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

const demoFlow: FlowDefinition = {
  name: "console-demo-login",
  purposes: ["login"],
  initial_steps: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      type: "identifier",
      texts: {
        title_key: "identifier.title",
        description_key: "identifier.description",
      },
      fields: {
        email: {
          type: "email",
          text_key: "identifier.field.email",
          autocomplete: "username",
          required: true,
        },
      },
      actions: { submit: { text_key: "submit.continue", primary: true } },
      transitions: { submit: "password" },
    },
    {
      name: "password",
      type: "credential",
      texts: {
        title_key: "password.title",
        description_key: "password.description",
      },
      fields: {
        password: {
          type: "password",
          text_key: "password.field.password",
          autocomplete: "current-password",
          required: true,
        },
      },
      actions: { submit: { text_key: "submit.signin", primary: true } },
      transitions: { submit: "done" },
    },
    { name: "done", type: "complete", texts: { title_key: "complete.title" } },
  ],
};

const decorate: WalkingFixtureOptions["decorate"] = (step, ctx) => {
  if (step.name !== "password") return step;
  const values = ctx.payload.values as Record<string, string> | undefined;
  const email = values?.email?.trim();
  return email ? { ...step, identity: { display_name: email } } : step;
};

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const transport = react.useMemo(
    () =>
      new WalkingFixtureTransport({
        flow: demoFlow,
        purpose: "login",
        decorate,
      }),
    [],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-12 p-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Components preview</h1>
        <p className="text-zinc-600">
          Renders <code>@zitadel-nextgen/components</code> through{" "}
          <code>@lit/react</code>. The orchestrator below is wired to a{" "}
          <code>WalkingFixtureTransport</code> so the form runs end-to-end
          without a backend — type any email, then any password.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Atoms</h2>
        <div className="grid gap-6 rounded-lg border border-zinc-200 bg-white p-6 sm:grid-cols-2">
          <ZlFieldEl
            name="email"
            label="Email"
            type="email"
            autocomplete="username"
            placeholder="you@example.com"
            required
          />
          <ZlFieldEl
            name="password"
            label="Password"
            type="password"
            autocomplete="current-password"
            required
          />
          <ZlSubmitEl action="submit" label="Continue" />
          <ZlActionEl action="register" label="Create account" ghost />
          <div className="sm:col-span-2">
            <ZlErrorEl message="Those credentials don't match. Try again." />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">
          <code>&lt;zitadel-login&gt;</code>
        </h2>
        <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <ZitadelLoginEl
            purpose="login"
            transport={transport}
            project-id="console-preview"
          />
        </div>
      </section>
    </div>
  );
}
