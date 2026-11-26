import { CodeFile, NumberedCommands } from "../../blocks";
import {
  appPath,
  deployCommand,
  googleDisableCommand,
  googleEnableCommand,
  idpListCommand,
} from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";

export const metadata = featureMetadata("identity-providers");

// The JSON result of `auth-method sso enable --provider google`, as the docs
// give it (apps/docs/content/docs/guides/social-sign-in.mdx, Enable Google).
const RESULT = `{
  "provider": "google",
  "schema": "default-human-user",
  "connection": {
    "action": "create",
    "slug": "google",
    "file": ".zitadel/idps/google.json",
    "claim_mapping": { "email": "email" },
    "verified_claims": { "email": "email_verified" },
    "scopes": ["openid", "profile", "email"],
    "unmapped": [],
    "used_by": ["default-human-user"]
  },
  "callback_uri": "http://localhost:3000/__nextgen/idp/google/callback",
  "changed": [".zitadel/schemas/default-human-user.json", ".zitadel/flows/default-login.json"],
  "client_id": { "variable": "GOOGLE_CLIENT_ID", "published": "stored" },
  "secret": { "variable": "GOOGLE_CLIENT_SECRET", "published": "stored" },
  "next_commands": ["npx @zitadel/cli@latest deploy --dry-run", "npx @zitadel/cli@latest deploy"]
}`;

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
              "GitHub signs people in with plain OAuth, not OpenID Connect, so I can't connect it. Google or any OpenID Connect provider works the same way.",
          },
          {
            ask: "Show which providers we offer.",
            reply:
              "Google, on the sign-in, sign-up and password steps. Its connection is .zitadel/idps/google.json.",
          },
          {
            ask: "Remove the Google button.",
            reply:
              "I took Google off the sign-in steps and the user schema. Deploy warns first if that leaves anyone without a way in.",
          },
        ],
        hood: {
          line: "One command connects Google, and its JSON result names what it did: the connection's file, the files it changed, and where the credentials went. This is the result the docs give.",
          artifact: <CodeFile title="auth-method sso enable --provider google" code={RESULT} />,
        },
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
