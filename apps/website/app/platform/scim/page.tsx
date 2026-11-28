import { NumberedCommands } from "../../blocks";
import { appPath, customSsoCommand, idpListCommand } from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";
import { HOODS } from "../../hoods";

export const metadata = featureMetadata("scim");

export default function ScimPage() {
  return (
    <FeaturePage
      slug="scim"
      content={{
        points: [
          "A SCIM endpoint for each customer's directory, for its users and groups.",
          "One person, one account: someone the directory added signs in through the same connection.",
          "A token for each directory, which Zitadel shows once.",
        ],
        asks: [
          {
            ask: "Sync Acme's people from Entra with SCIM.",
            reply:
              "Done: Acme's admin gets a SCIM address and a token for Entra ID. From then on, people Acme adds show up in your app, and people who leave lose access.",
          },
          {
            ask: "Who did Acme's directory add this week?",
            reply: "These people, all added by Acme's directory, and each one's history says so.",
          },
          {
            ask: "Stop syncing Acme's directory.",
            reply:
              "Its token's revoked, so it can't add or change anyone now. The people it already added stay.",
          },
        ],
        hood: HOODS.scim,
        tryIt: {
          line: "Provisioning builds on a customer's sign-in connection. These connect an OpenID Connect provider such as Entra ID and list your connections: they sign people in, and provision no one.",
          content: (
            <div className="max-w-3xl">
              <NumberedCommands
                title={appPath}
                steps={[
                  { label: "Connect an OpenID Connect provider", command: customSsoCommand },
                  { label: "See the connections", command: idpListCommand },
                ]}
                placement="try_it"
              />
            </div>
          ),
        },
        questions: [
          {
            question: "Which directories can push people in?",
            answer: "Any that speaks SCIM 2.0, such as Okta and Entra ID.",
          },
          {
            question: "Does a synced person need to sign up?",
            answer:
              "No. Their directory creates them, and they sign in through the same connection without a linking step.",
          },
          {
            question: "Who sets up a customer's directory?",
            answer: "The customer's admin, for their own organization, beside its single sign-on.",
          },
        ],
      }}
    />
  );
}
