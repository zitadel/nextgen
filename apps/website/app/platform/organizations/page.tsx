import { NumberedCommands } from "../../blocks";
import {
  appPath,
  teamCreateCommand,
  teamDeactivateCommand,
  teamGetCommand,
  teamListCommand,
} from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";
import { HOODS } from "../../hoods";

export const metadata = featureMetadata("organizations");

export default function OrganizationsPage() {
  return (
    <FeaturePage
      slug="organizations"
      content={{
        points: [
          "An organization for each customer, as a team in your project, with a name no other customer has.",
          "Each customer's own members and admins, its own sign-in and its own brand.",
          "A customer that leaves is deactivated, and its team stays on record for your audit.",
        ],
        asks: [
          {
            ask: "Give each customer its own organization and admins.",
            reply:
              "Done. Each customer has its own organization now, and its admins look after their own people.",
          },
          {
            ask: "Which customers do we have?",
            reply: "Here's every customer, with when each one was created.",
          },
          {
            ask: "Acme left. Turn off their organization.",
            reply: "Acme's organization is off. Its history stays on record for your audit.",
          },
        ],
        hood: HOODS.organizations,
        tryIt: {
          line: "Run them in your app's folder, once setup has run.",
          content: (
            <div className="max-w-3xl">
              <NumberedCommands
                title={appPath}
                steps={[
                  { label: "Create a team for a customer", command: teamCreateCommand },
                  { label: "See your customers' teams", command: teamListCommand },
                  { label: "Read one team", command: teamGetCommand },
                  { label: "Deactivate a customer's team", command: teamDeactivateCommand },
                ]}
                placement="try_it"
              />
            </div>
          ),
        },
        questions: [
          {
            question: "Is each organization a project of its own?",
            answer:
              "No. Each customer is a team inside your one project, so one deploy reaches every customer.",
          },
          {
            question: "Can two customers have the same name?",
            answer: "No. A team's name is unique in the project, ignoring case.",
          },
          {
            question: "What happens when a customer leaves?",
            answer:
              "Deactivate its team. The team stays on record with its history, for your audit.",
          },
        ],
      }}
    />
  );
}
