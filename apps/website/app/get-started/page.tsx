import { QuickstartCommands, RunWindow, SkillsLine } from "../blocks";
import { PhasePage, phaseMetadata } from "../phase-page";
import { historyRun } from "../showcase/runs";
import { Showcase } from "../showcase/showcase";

export const metadata = phaseMetadata("get-started");

// The quickstart's walkthrough: the commands to copy, as the front page's
// hero shows them, then each step as it runs (the showcase). It shows the
// files setup writes and the commands that publish a change, so this page
// has no Under the hood or Try it of its own.
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
                <QuickstartCommands
                  placement="showcase"
                  footer={<SkillsLine placement="showcase" className="text-xs" />}
                />
              </div>
              <Showcase />
            </div>
          ),
        },
        decide: {
          line: "What setup writes lands in your repo as files: the pages, the user model and the login flow. You read the diff and commit it, and each deploy records who made it, from which commit and why.",
          block: <RunWindow run={historyRun} placement="decide" />,
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
