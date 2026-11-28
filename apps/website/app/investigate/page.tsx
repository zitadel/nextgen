import { CodeFile, NumberedCommands, RowList } from "../blocks";
import {
  appPath,
  correlationEventsCommand,
  failedRequestsCommand,
  userEventsCommand,
  userSignInsCommand,
} from "../commands";
import { PhasePage, phaseMetadata } from "../phase-page";

export const metadata = phaseMetadata("investigate");

// A failed password check as `event list --json` returns it, its fields and
// type from the API (apps/api/api/openapi/endpoints/events: event-base.yaml,
// the auth.check.failed event, its payload), its ID the spec's example, and
// the values that differ per sign-in left out.
const EVENT = `{
  "id": "evt_01HZYABCDEFGHJKMNPQRSTVWXY",
  "event_type": "auth.check.failed",
  "category": "auth",
  "user_id": "…",
  "correlation_id": "…",
  "payload": {
    "check_id": "…",
    "check_type": "Password",
    "auth_attempt_id": "…"
  }
}`;

export default function InvestigatePage() {
  return (
    <PhasePage
      slug="investigate"
      content={{
        hood: {
          line: "Every sign-in check is an event. This is a failed password check as the event list returns it, cut to the fields your agent reads first. The events of one sign-in share its correlation ID.",
          artifact: <CodeFile title="auth.check.failed" code={EVENT} />,
        },
        decide: {
          line: "Each event names who acted: a person, an app, or your agent acting for you. When the answer is a change you do not want, you decide whether to roll it back.",
          block: (
            <RowList
              title="Events"
              rows={[
                { term: "Your agent, for you", text: "Changed the password policy" },
                { term: "Dana", text: "Password check failed" },
                { term: "You", text: "Rolled back the login flow" },
              ]}
            />
          ),
        },
        tryIt: {
          line: "Run them in your app's folder, with an ID from an earlier result.",
          content: (
            <div className="flex max-w-3xl flex-col gap-4">
              <NumberedCommands
                title={appPath}
                steps={[
                  {
                    label: "Everything that happened to one user's account, whoever acted",
                    command: userEventsCommand,
                  },
                  { label: "Only that user's sign-ins", command: userSignInsCommand },
                  { label: "Everything one sign-in wrote", command: correlationEventsCommand },
                  { label: "The API requests that failed", command: failedRequestsCommand },
                ]}
                placement="try_it"
                numbered={false}
              />
              <p className="text-text-muted text-xs leading-5">
                A longer history of events is a paid add-on.
              </p>
            </div>
          ),
        },
        questions: [
          {
            question: "What does an event record?",
            answer:
              "What happened, when, to which user, and who did it. Sign-ins, sessions, changes and API requests are all events.",
          },
          {
            question: "Can I find everything one sign-in did?",
            answer: "Yes. The events of one sign-in share an ID, so one filter finds them all.",
          },
          {
            question: "Do events hold passwords or tokens?",
            answer: "No. Secrets, challenges and token values never appear in an event.",
          },
          {
            question: "Can I send events to my own tools?",
            answer:
              "Yes, when you run Zitadel on your servers: it can send each event to a webhook.",
          },
        ],
      }}
    />
  );
}
