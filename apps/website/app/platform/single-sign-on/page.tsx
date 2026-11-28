import { NumberedCommands } from "../../blocks";
import {
  appPath,
  customSsoCommand,
  deployCommand,
  dryRunCommand,
  idpListCommand,
} from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";
import { HOODS } from "../../hoods";

export const metadata = featureMetadata("single-sign-on");

export default function SingleSignOnPage() {
  return (
    <FeaturePage
      slug="single-sign-on"
      content={{
        points: [
          "A connection to each customer's OpenID Connect provider.",
          "Their people sign in with their work accounts, on your sign-in screens.",
          "No secret in your repo: the client secret is stored on the project, encrypted.",
        ],
        asks: [
          {
            ask: "Connect this customer's single sign-on.",
            reply:
              "Their OpenID Connect provider is connected and part of your sign-in now. When you deploy, their people can sign in with their work accounts. Should I deploy?",
          },
          {
            ask: "Which customers use single sign-on?",
            reply:
              "These ones, each through their own provider. Here's each connection and when it was added.",
          },
          {
            ask: "Turn off passwords for this customer.",
            reply:
              "Done. Their people sign in through their own provider only; everyone else keeps their password.",
          },
        ],
        hood: HOODS["single-sign-on"],
        tryIt: {
          line: "Run them in your app's folder. The first asks for the provider's issuer and client.",
          content: (
            <div className="max-w-3xl">
              <NumberedCommands
                title={appPath}
                steps={[
                  { label: "Connect an OpenID Connect provider", command: customSsoCommand },
                  { label: "See the connections", command: idpListCommand },
                  { label: "See what would go live", command: dryRunCommand },
                  { label: "Make it live", command: deployCommand },
                ]}
                placement="try_it"
              />
            </div>
          ),
        },
        questions: [
          {
            question: "Which providers can a customer bring?",
            answer: "Any provider that speaks OpenID Connect and publishes its discovery document.",
          },
          {
            question: "Does a customer's secret end up in my repo?",
            answer:
              "No. The connection file holds references, and the client secret is stored on the project, encrypted.",
          },
          {
            question: "Do their people need a new password?",
            answer:
              "No. They sign in with their work account at their provider, and your app never sees that password.",
          },
        ],
      }}
    />
  );
}
