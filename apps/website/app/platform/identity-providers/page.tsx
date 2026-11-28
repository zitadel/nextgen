import { NumberedCommands } from "../../blocks";
import {
  appPath,
  deployCommand,
  googleDisableCommand,
  googleEnableCommand,
  idpListCommand,
} from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";
import { HOODS } from "../../hoods";

export const metadata = featureMetadata("identity-providers");

export default function IdentityProvidersPage() {
  return (
    <FeaturePage
      slug="identity-providers"
      content={{
        points: [
          "Google, or any provider that publishes OpenID Connect discovery.",
          "One change adds its button to your sign-in, sign-up and password steps.",
          "The provider's claims, such as email or name, fill your user's fields.",
        ],
        asks: [
          {
            ask: "Add sign-in with GitHub.",
            reply:
              "I can't: GitHub uses plain OAuth, not OpenID Connect. Google or any OpenID Connect provider works, though. Want Google instead?",
          },
          {
            ask: "Show which providers we offer.",
            reply:
              "Just Google, on sign-in, sign-up and the password step. Its connection is a file in your repo.",
          },
          {
            ask: "Remove the Google button.",
            reply:
              "Done, Google's off your sign-in. If that leaves anyone without a way in, deploy warns you first.",
          },
        ],
        hood: HOODS["identity-providers"],
        tryIt: {
          line: "Run them in your app's folder, once setup has run and Google's OAuth client exists.",
          content: (
            <div className="max-w-3xl">
              <NumberedCommands
                title={appPath}
                steps={[
                  { label: "Add Google as a way to sign in", command: googleEnableCommand },
                  { label: "See the connections", command: idpListCommand },
                  { label: "Take Google off again", command: googleDisableCommand },
                  { label: "Make it live", command: deployCommand },
                ]}
                placement="try_it"
              />
            </div>
          ),
        },
        questions: [
          {
            question: "Which providers work?",
            answer: "Google, and any provider that publishes OpenID Connect discovery.",
          },
          {
            question: "Where do the client secrets go?",
            answer:
              "They are stored on the project, the secret encrypted. The connection file in your repo holds only references.",
          },
          {
            question: "Can a provider fill in user fields?",
            answer:
              "Yes. Map the provider's claims, such as email or name, to the fields of your user schema.",
          },
        ],
      }}
    />
  );
}
