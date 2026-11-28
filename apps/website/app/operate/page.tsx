import { CodeFile, NumberedCommands, RunWindow } from "../blocks";
import {
  appPath,
  deployCommand,
  dryRunCommand,
  grantListCommand,
  policyTestCommand,
  rollbackCommand,
} from "../commands";
import { PhasePage, phaseMetadata } from "../phase-page";
import { historyRun } from "../showcase/runs";

export const metadata = phaseMetadata("operate");

// The password policy in the format the docs give it
// (apps/docs/content/docs/guides/password-policy.mdx), with the minimum the
// ask on this page sets.
const POLICY = `{
  "$schema": "../meta/policy.json",
  "operation": "auth.factor.password.set",
  "config": { "min_length": 12 }
}`;

export default function OperatePage() {
  return (
    <PhasePage
      slug="operate"
      content={{
        hood: {
          line: "A policy is a file in your repo. This is the password policy once your agent asks for 12 characters. Deploy refuses a setting it does not know, or a value out of bounds, before anything is sent.",
          artifact: (
            <CodeFile title=".zitadel/policies/auth.factor.password.set.json" code={POLICY} />
          ),
        },
        decide: {
          line: "Every change is a diff you read before it goes live. A dry run shows it against what is live, each release records who built it and from which commit, and a rollback puts the release before back.",
          block: <RunWindow run={historyRun} placement="decide" />,
        },
        tryIt: {
          line: "Run them in your app's folder, once setup has run.",
          content: (
            <div className="max-w-3xl">
              <NumberedCommands
                title={appPath}
                steps={[
                  { label: "Test your policies", command: policyTestCommand },
                  { label: "See what would go live", command: dryRunCommand },
                  { label: "Make it live", command: deployCommand },
                  { label: "Undo the last deploy", command: rollbackCommand },
                  { label: "See who has access", command: grantListCommand },
                ]}
                placement="try_it"
              />
            </div>
          ),
        },
        questions: [
          {
            question: "What can my agent change?",
            answer:
              "Sign-in methods, single sign-on connections, policies, your user model, the login flow and the look of the login screens. Each is a file in your repo.",
          },
          {
            question: "Can I check a change before it goes live?",
            answer:
              "Yes. A dry run shows the diff against what is live, and your policy tests run before you deploy.",
          },
          {
            question: "How do I undo a change?",
            answer:
              "Roll back the deployment. The release before goes live again, and your users keep their data.",
          },
          {
            question: "Who can change the configuration?",
            answer:
              "Anyone with editor or admin access to the project. Viewers can read it and change nothing.",
          },
        ],
      }}
    />
  );
}
