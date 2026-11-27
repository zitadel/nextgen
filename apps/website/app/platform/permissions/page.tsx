import { NumberedCommands } from "../../blocks";
import {
  appPath,
  grantCreateCommand,
  grantDeleteCommand,
  grantListCommand,
  membersCommand,
} from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";
import { HOODS } from "../../hoods";

export const metadata = featureMetadata("permissions");

export default function PermissionsPage() {
  return (
    <FeaturePage
      slug="permissions"
      content={{
        points: [
          "Viewer, editor and admin on each project, for people and for teams.",
          "Access that stops at a time you set.",
          "Every grant and revoke in the events, with who made it.",
        ],
        asks: [
          {
            ask: "Give support read access to users.",
            reply:
              "I gave the support team viewer access to the project. They can read your users and change nothing.",
          },
          {
            ask: "Who can delete users?",
            reply:
              "The project's admins, its owning team among them, and anything that holds the project secret, such as your backend.",
          },
          {
            ask: "Remove Alex's admin access.",
            reply:
              "I revoked Alex's admin grant, and the events record that you did. If Alex is in the team that owns the project, that access stays until Alex leaves the team.",
          },
        ],
        hood: HOODS.permissions,
        tryIt: {
          line: "Run them in your app's folder, once the project is claimed.",
          content: (
            <div className="max-w-3xl">
              <NumberedCommands
                title={appPath}
                steps={[
                  { label: "Give someone a role on the project", command: grantCreateCommand },
                  { label: "See every member and their strongest role", command: membersCommand },
                  { label: "See the grants", command: grantListCommand },
                  { label: "Take a grant away", command: grantDeleteCommand },
                ]}
                placement="try_it"
              />
            </div>
          ),
        },
        questions: [
          {
            question: "Which roles are there?",
            answer:
              "Viewer, editor and admin on each project. Admin includes editor, and editor includes viewer.",
          },
          {
            question: "Can access run out?",
            answer: "Yes. A grant can carry an expiry, and stops working at that time.",
          },
          {
            question: "How do I see who has access?",
            answer:
              "List the project's members: each with their strongest role and where it comes from.",
          },
        ],
      }}
    />
  );
}
