import { CodeFile, NumberedCommands } from "../../blocks";
import {
  appPath,
  deployCommand,
  dryRunCommand,
  invitationCommand,
  userListCommand,
} from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";

export const metadata = featureMetadata("users");

// The user schema's properties once the company is added: the default schema
// (packages/config/defaults/default-human-user.json) with the property the
// front page's recorded session added (showcase/sessions.ts, Add a field).
const PROPERTIES = `"properties": {
  "email": {
    "type": "string",
    "format": "email",
    "x-unique": "project",
    "description": "The user's email address."
  },
  "company": {
    "type": "string",
    "description": "The user's company."
  }
}`;

export default function UsersPage() {
  return (
    <FeaturePage
      slug="users"
      content={{
        points: [
          "Your user model as a JSON Schema in your repo: the fields, which are required, which are unique.",
          "Sign-up asks for the fields you choose.",
          "Invitations that give a colleague a role on your project, as a link.",
        ],
        asks: [
          {
            ask: "Add a company field.",
            reply:
              "Your user schema has a company field, and the sign-up step asks for it. Review the change, then deploy.",
          },
          {
            ask: "Invite Dana as an admin.",
            reply:
              "I created an admin invitation for Dana. Send her the link yourself; it expires in 72 hours.",
          },
          {
            ask: "Import our users from Zitadel v4.",
            reply:
              "I imported your users from Zitadel v4 into this project. They keep their email addresses and sign in as before.",
          },
        ],
        hood: {
          line: "Your user model is a JSON Schema in your repo. These are its properties once your agent adds the company, as the recorded session on the front page wrote it.",
          artifact: <CodeFile title=".zitadel/schemas/default-human-user.json" code={PROPERTIES} />,
        },
        tryIt: {
          line: "Run them in your app's folder, once setup has run.",
          content: (
            <div className="max-w-3xl">
              <NumberedCommands
                title={appPath}
                steps={[
                  { label: "See your users", command: userListCommand },
                  { label: "Invite a colleague with a link", command: invitationCommand },
                  { label: "See what a schema change would put live", command: dryRunCommand },
                  { label: "Make it live", command: deployCommand },
                ]}
                placement="try_it"
              />
            </div>
          ),
        },
        questions: [
          {
            question: "Can I add any field I need?",
            answer:
              "Yes. Add a property to your user schema, mark it required or unique, and sign-up can ask for it.",
          },
          {
            question: "What happens to users when the schema changes?",
            answer:
              "They stay on the revision they signed up with until you move them, with the data the new revision needs.",
          },
          {
            question: "Who can invite people?",
            answer:
              "Project admins. An invitation is a link that gives a role to whoever opens it and signs in, for 72 hours.",
          },
        ],
      }}
    />
  );
}
