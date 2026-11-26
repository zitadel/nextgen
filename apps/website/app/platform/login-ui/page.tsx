import { CodeFile, NumberedCommands } from "../../blocks";
import { appPath, deployCommand, dryRunCommand, setupCommand } from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";

export const metadata = featureMetadata("login-ui");

// The default login flow's password step, as the docs give it
// (apps/docs/content/docs/guides/sign-in-methods.mdx, How a step offers each
// method).
const STEP = `{
  "name": "password",
  "fields": ["x-auth-methods#password"],
  "actions": [
    { "name": "submit", "kind": "submit", "primary": true, "text_key": "password.action.signin" }
  ],
  "transitions": {
    "submit": { "target": "done" }
  }
}`;

export default function LoginUiPage() {
  return (
    <FeaturePage
      slug="login-ui"
      content={{
        points: [
          "Login, sign-up and profile pages that setup writes into your app.",
          "Your brand through the login's design tokens, in your own stylesheet.",
          "A login flow you edit as a file: which steps there are, what each asks for, where each leads.",
        ],
        asks: [
          {
            ask: "Use our brand on the login screen.",
            reply:
              "I set the login's design tokens to your colors and font in your stylesheet, so the login screens look like the rest of your app.",
          },
          {
            ask: "Ask for the company at sign-up.",
            reply:
              "Your user schema has a company field, and the sign-up step asks for it. Review the change, then deploy.",
          },
          {
            ask: "Ask for email and password on one screen.",
            reply:
              "The sign-in step asks for email and password together and goes straight to signed in. The change is ready for your review.",
          },
        ],
        hood: {
          line: "The login flow is a file in your repo. This is the default flow's password step, as the docs give it: what it asks for, its button, and where it leads.",
          artifact: <CodeFile title=".zitadel/flows/default-login.json" code={STEP} />,
        },
        tryIt: {
          line: "Run them in an empty folder for a new app.",
          content: (
            <div className="max-w-3xl">
              <NumberedCommands
                title={appPath}
                steps={[
                  { label: "Write the login pages into your app", command: setupCommand },
                  { label: "See what a change would put live", command: dryRunCommand },
                  { label: "Make it live", command: deployCommand },
                ]}
                placement="try_it"
              />
            </div>
          ),
        },
        questions: [
          {
            question: "Which frameworks are there components for?",
            answer:
              "Next.js, Nuxt, React, Vue, Angular, Svelte, Solid and Qwik, and app frameworks such as SvelteKit and TanStack Start.",
          },
          {
            question: "Can I change the text on the screens?",
            answer: "Yes. The copy is yours to change, in English, German and Italian.",
          },
          {
            question: "Do I write the screens myself?",
            answer: "No. Setup writes them into your app, and you change only what you want to.",
          },
        ],
      }}
    />
  );
}
