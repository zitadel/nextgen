import { NumberedCommands } from "../../blocks";
import { appPath, deployCommand, dryRunCommand, setupCommand } from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";
import { HOODS } from "../../hoods";

export const metadata = featureMetadata("login-ui");

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
              "Your login screens use your colors and font now, set in your own stylesheet, so they match the rest of your app.",
          },
          {
            ask: "Ask for the company at sign-up.",
            reply:
              "Sign-up asks for the company now, and it's stored with each user. Have a look, then deploy.",
          },
          {
            ask: "Ask for email and password on one screen.",
            reply:
              "Done. Sign-in asks for email and password on one screen and signs people straight in. It's ready for you to review.",
          },
        ],
        hood: HOODS["login-ui"],
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
