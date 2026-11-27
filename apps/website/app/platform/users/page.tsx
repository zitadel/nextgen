import { NumberedCommands } from "../../blocks";
import {
  appPath,
  deployCommand,
  dryRunCommand,
  invitationCommand,
  userListCommand,
} from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";
import { HOODS } from "../../hoods";

export const metadata = featureMetadata("users");

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
        hood: HOODS.users,
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
