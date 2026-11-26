import { NumberedCommands, RowList } from "../blocks";
import {
  actorEventsCommand,
  appPath,
  grantDeleteCommand,
  grantListCommand,
  userEventsCommand,
} from "../commands";
import { PhasePage, phaseMetadata } from "../phase-page";

export const metadata = phaseMetadata("govern");

export default function GovernPage() {
  return (
    <PhasePage
      slug="govern"
      content={{
        asks: [
          {
            ask: "Let our support agent look up orders for a user.",
            reply:
              "Done. The support agent can look up a user's orders once that user agrees, and each look-up names the agent and the user.",
          },
          {
            ask: "Show what our agents did for Dana.",
            reply:
              "Only the support agent acted for her: it looked up her orders after she agreed.",
          },
          {
            ask: "Remove the support agent's access.",
            reply:
              "Removed. The agent's requests are refused from now on, and the events show that you removed it.",
          },
        ],
        hood: {
          line: "Every event carries the fields that name who acted and for whom. These are their descriptions in the API.",
          artifact: (
            // The shared event fields' descriptions in the API
            // (apps/api/api/openapi/endpoints/events/event-base.yaml), cut
            // to their first sentence.
            <RowList
              title="Event fields"
              rows={[
                { term: "actor_id", text: "The ID of the actor that triggered the event." },
                {
                  term: "user_id",
                  text: "The ID of the user the event concerns, whoever triggered it.",
                },
                { term: "client_id", text: "The application or agent that produced the event." },
                { term: "delegation_type", text: "The kind of delegation. Absent when unset." },
              ]}
            />
          ),
        },
        decide: {
          line: "Your users decide what an agent may do for them, and you can take an agent's access away at any time. Every action names the agent and the user it acted for.",
          block: (
            <RowList
              title="Events"
              rows={[
                { term: "Support agent", text: "Signed in as itself" },
                { term: "Dana", text: "Gave Support agent consent to see her orders" },
                { term: "Support agent, for Dana", text: "Looked up her orders" },
                { term: "You", text: "Removed Support agent's access" },
              ]}
            />
          ),
        },
        tryIt: {
          line: "Run them in your app's folder. They cover the people and teams with access to your project.",
          content: (
            <div className="max-w-3xl">
              <NumberedCommands
                title={appPath}
                steps={[
                  {
                    label: "What happened to a user's account, whoever acted",
                    command: userEventsCommand,
                  },
                  { label: "What one user did", command: actorEventsCommand },
                  { label: "Who has access to your project", command: grantListCommand },
                  { label: "Take a grant away", command: grantDeleteCommand },
                ]}
                placement="try_it"
                numbered={false}
              />
            </div>
          ),
        },
        questions: [
          {
            question: "How does an agent I ship get its identity?",
            answer:
              "It signs in as itself, the way an app does, and gets only the access you give it.",
          },
          {
            question: "Can an agent act for one of my users?",
            answer:
              "Only with that user's consent, and every action names both the agent and the user.",
          },
          {
            question: "Can I take an agent's access away?",
            answer: "Yes. Remove its access, and the agent's requests are refused from then on.",
          },
        ],
      }}
    />
  );
}
