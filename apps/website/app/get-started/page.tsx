import { ChangeHistory, NumberedCommands, SkillsLine } from "../blocks";
import { appPath, devCommand, setupCommand, startCommand } from "../commands";
import { PhasePage, phaseMetadata } from "../phase-page";
import { Showcase } from "../showcase/showcase";

export const metadata = phaseMetadata("get-started");

// The commands of README.md's quick start (commands.ts), as numbered steps.
const STEPS = [
  { label: "Start Zitadel on your machine", command: startCommand },
  { label: "Add sign-in to your app", command: setupCommand },
  { label: "Run your app", command: devCommand },
];

// The quickstart's walkthrough: the commands to copy, then each step as it
// runs (the showcase). It shows the files setup writes and the commands that
// publish a change, so this page has no Under the hood or Try it of its own.
export default function GetStartedPage() {
  return (
    <PhasePage
      slug="get-started"
      content={{
        walkthrough: {
          line: "Run these in an empty folder. Each step below shows what it writes into your app and the login it serves.",
          content: (
            <div className="flex flex-col gap-20 md:gap-28">
              <div className="max-w-[42rem]">
                <NumberedCommands
                  title={appPath}
                  note="Node 24+"
                  steps={STEPS}
                  placement="showcase"
                  copyAll
                  footer={<SkillsLine placement="showcase" className="text-xs" />}
                />
              </div>
              <Showcase />
            </div>
          ),
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
