import { NumberedCommands } from "../../blocks";
import {
  appPath,
  deployCommand,
  dryRunCommand,
  googleEnableCommand,
  passkeyEnableCommand,
} from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";
import { HOODS } from "../../hoods";

export const metadata = featureMetadata("sign-in");

export default function SignInPage() {
  return (
    <FeaturePage
      slug="sign-in"
      content={{
        points: [
          "Passkeys and passwords, each switched on or off in your user schema.",
          "A button for Google or any OpenID Connect provider on your sign-in screens.",
          "A password policy that checks every new password, in a file you deploy.",
        ],
        asks: [
          {
            ask: "Add passkeys.",
            reply:
              "Passkeys are on in your user schema, and the sign-in and sign-up steps offer them. Deploy once you have reviewed the change.",
          },
          {
            ask: "Let people sign in with Google.",
            reply:
              "I connected Google with the client you created. Once you deploy, the sign-in, sign-up and password steps offer Continue with Google.",
          },
          {
            ask: "Require 12-character passwords.",
            reply:
              "The password policy asks for at least 12 characters. New passwords are checked once you deploy; passwords already set stay as they are.",
          },
        ],
        hood: HOODS["sign-in"],
        tryIt: {
          line: "Run them in your app's folder, once setup has run.",
          content: (
            <div className="max-w-3xl">
              <NumberedCommands
                title={appPath}
                steps={[
                  { label: "Turn on passkeys in your user schema", command: passkeyEnableCommand },
                  { label: "Add Google as a way to sign in", command: googleEnableCommand },
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
            question: "Which ways to sign in are there?",
            answer:
              "Passwords, passkeys, and single sign-on with Google or any OpenID Connect provider.",
          },
          {
            question: "Where do the sign-in screens live?",
            answer:
              "In your app, as components in your code. They take your brand, and your agent changes them like the rest of the app.",
          },
          {
            question: "Can I turn a way to sign in off?",
            answer:
              "Yes. Your agent switches it off in the user schema and the login flow, and deploy checks that no user is left without a way in.",
          },
        ],
      }}
    />
  );
}
