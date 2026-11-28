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

export const metadata = featureMetadata("passkeys-and-passwords");

export default function SignInPage() {
  return (
    <FeaturePage
      slug="passkeys-and-passwords"
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
              "Passkeys are on, and sign-in and sign-up offer them now. Want to review it before I deploy?",
          },
          {
            ask: "Let people sign in with Google.",
            reply:
              "Connected, with the Google client you made. Once you deploy, sign-in, sign-up and the password step show Continue with Google. Should I deploy?",
          },
          {
            ask: "Require 12-character passwords.",
            reply:
              "Done. New passwords need at least 12 characters once you deploy. Passwords people already have keep working.",
          },
        ],
        hood: HOODS["passkeys-and-passwords"],
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
