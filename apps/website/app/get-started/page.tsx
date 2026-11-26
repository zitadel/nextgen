import { ChangeHistory, CodeFile, NumberedCommands } from "../blocks";
import { appPath, devCommand, setupCommand, startCommand } from "../commands";
import { CallToAction } from "../cta";
import { PhasePage, phaseMetadata } from "../phase-page";

export const metadata = phaseMetadata("get-started");

// The user schema setup writes (packages/config/defaults/default-human-user.json),
// cut to the keys that decide how people sign in.
const SCHEMA = `{
  "objectType": "human-user",
  "x-identifier": "email",
  "x-auth-methods": {
    "password": {
      "enabled": true
    },
    "passkey": {
      "enabled": true
    }
  },
  "required": [
    "email"
  ],
  "properties": {
    "email": {
      "type": "string",
      "format": "email",
      "x-unique": "project"
    }
  }
}`;

// The commands of README.md's quick start, as the front page shows them.
const STEPS = [
  { label: "Start Zitadel on your machine", command: startCommand },
  { label: "Add sign-in to your app", command: setupCommand },
  { label: "Run your app", command: devCommand },
];

export default function GetStartedPage() {
  return (
    <PhasePage
      slug="get-started"
      content={{
        asks: [
          {
            ask: "Add sign-in to my app.",
            reply:
              "Setup added the login, sign-up and profile pages to your app. I signed up a test user and signed in again to check that it works.",
          },
          {
            ask: "Add passkeys.",
            reply:
              "Passkeys are on in your user schema, and the sign-in and sign-up steps offer them. The change is ready for your review.",
          },
          {
            ask: "Use our brand on the login screen.",
            reply:
              "I set the login's design tokens to your colors and font in your stylesheet, so the login screens look like the rest of your app.",
          },
        ],
        hood: {
          line: "Your user model is a file in your repo. This is the one setup writes, cut to how people sign in: by email, with a password or a passkey. Your agent edits it like any other code.",
          artifact: <CodeFile title=".zitadel/schemas/default-human-user.json" code={SCHEMA} />,
        },
        decide: {
          line: "What setup writes lands in your repo as files: the pages, the user model and the login flow. You read the diff and commit it, and each deploy records who made it, from which commit and why.",
          block: (
            <ChangeHistory
              changes={[
                { change: "Add sign-in", agent: true },
                { change: "Add passkeys", agent: true },
                { change: "Use our brand on the login screen", agent: true },
                { change: "Update the logo", agent: false },
              ]}
            />
          ),
        },
        tryIt: {
          line: "Run these in an empty folder. The quickstart walks you through each step.",
          content: (
            <div className="flex max-w-3xl flex-col items-start gap-7">
              <div className="w-full">
                <NumberedCommands
                  title={appPath}
                  note="Node 24+"
                  steps={STEPS}
                  placement="try_it"
                  copyAll
                />
              </div>
              <CallToAction placement="try_it" />
            </div>
          ),
        },
        questions: [
          {
            question: "What do I need to start?",
            answer:
              "Node.js 24 or newer and an empty folder. Zitadel runs on your machine without Docker or Go.",
          },
          {
            question: "Can I add it to an app I already have?",
            answer: "Yes. Run setup in your app's folder, and it adds sign-in to the app you have.",
          },
          {
            question: "Where do users and passwords live?",
            answer:
              "In Zitadel, not in your app. On your machine it runs locally, and in production in Zitadel Cloud or on your servers.",
          },
          {
            question: "How does my agent know what to do?",
            answer:
              "Add the Zitadel skills to your project. Your agent then drives the CLI, which answers every command in JSON.",
          },
        ],
      }}
    />
  );
}
