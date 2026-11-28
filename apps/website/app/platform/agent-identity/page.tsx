import { NumberedCommands } from "../../blocks";
import { actorEventsCommand, appPath, userEventsCommand } from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";
import { HOODS } from "../../hoods";

export const metadata = featureMetadata("agent-identity");

export default function AgentsPage() {
  return (
    <FeaturePage
      slug="agent-identity"
      content={{
        points: [
          "Each agent signs in as itself, with only the access you give it.",
          "It acts for a user only after that user agrees.",
          "Every action names the agent and the user it acted for.",
        ],
        asks: [
          {
            ask: "Register our support agent.",
            reply:
              "Done. It has its own identity now and signs in as itself, with only the access you gave it.",
          },
          {
            ask: "Let it look up orders when a user agrees.",
            reply:
              "Users get a consent screen the first time it asks. Once they say yes, every look-up names both of them.",
          },
          {
            ask: "Show everything the support agent did today.",
            reply:
              "It signed in as itself and looked up orders, only for users who'd said yes. Each look-up names it and the user.",
          },
        ],
        hood: HOODS["agent-identity"],
        tryIt: {
          line: "Run them in your app's folder. They read the events every caller writes.",
          content: (
            <div className="max-w-3xl">
              <NumberedCommands
                title={appPath}
                steps={[
                  { label: "What one user did", command: actorEventsCommand },
                  {
                    label: "What happened to a user's account, whoever acted",
                    command: userEventsCommand,
                  },
                ]}
                placement="try_it"
                numbered={false}
              />
            </div>
          ),
        },
        questions: [
          {
            question: "How does an agent get its identity?",
            answer:
              "It signs in as itself, the way an app does, and gets only the access you give it.",
          },
          {
            question: "Can an agent act for one of my users?",
            answer:
              "Only with that user's consent, and every action names both the agent and the user.",
          },
          {
            question: "Does it work with MCP servers?",
            answer: "Yes. An MCP client signs in as an app, and your MCP server checks its token.",
          },
        ],
      }}
    />
  );
}
