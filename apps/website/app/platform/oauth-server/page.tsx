import { NumberedCommands } from "../../blocks";
import {
  apiListCommand,
  appPath,
  applicationGetCommand,
  applicationPublishCommand,
} from "../../commands";
import { FeaturePage, featureMetadata } from "../../feature-page";
import { HOODS } from "../../hoods";

export const metadata = featureMetadata("oauth-server");

export default function OAuthServerPage() {
  return (
    <FeaturePage
      slug="oauth-server"
      content={{
        points: [
          "An authorization server for each project, at your app's own origin.",
          "The authorization code grant with PKCE, the flow OAuth 2.1 asks for.",
          "Applications you register, each with its own client, for your APIs, your MCP servers and your partners' apps.",
        ],
        asks: [
          {
            ask: "Protect our MCP server with OAuth.",
            reply:
              "Your MCP server now accepts only tokens Zitadel issued for it. MCP clients find the sign-in through its metadata.",
          },
          {
            ask: "Let a partner's app call our API.",
            reply:
              "I registered their app with its own client. They sign their users in with the authorization code flow and call your API with the token.",
          },
          {
            ask: "Which apps can get tokens for our API?",
            reply:
              "These applications, each with its client and the redirect addresses it may use.",
          },
        ],
        hood: HOODS["oauth-server"],
        tryIt: {
          line: "Run them in your app's folder, once setup has run. The API's list shows the fields an application takes.",
          content: (
            <div className="max-w-3xl">
              <NumberedCommands
                title={appPath}
                steps={[
                  {
                    label: "See the API's operations, applications among them",
                    command: apiListCommand,
                  },
                  {
                    label: "Register an application from a JSON file",
                    command: applicationPublishCommand,
                  },
                  { label: "Read it back", command: applicationGetCommand },
                ]}
                placement="try_it"
              />
            </div>
          ),
        },
        questions: [
          {
            question: "Which flows does it support?",
            answer:
              "The authorization code grant with PKCE, for apps that keep a secret, as OAuth 2.1 asks.",
          },
          {
            question: "Where is the issuer?",
            answer:
              "At your app's own origin, under /oauth and the project's ID, so the tokens name your domain.",
          },
          {
            question: "Can it protect an MCP server?",
            answer:
              "Yes. An MCP client signs in as an app and gets a token, and your MCP server checks it.",
          },
        ],
      }}
    />
  );
}
