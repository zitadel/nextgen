"use client";
import { createCodeUsageGeneratorRegistry } from "fumadocs-openapi/requests/generators";
import { curl } from "fumadocs-openapi/requests/generators/curl";
import { createOpenAPIPage, type OpenAPIPageProps_Spec } from "fumadocs-openapi/ui";
import PlaygroundClient from "fumadocs-openapi/ui/playground/client";
import { useMemo } from "react";

import { cliCommand, cliSample } from "@/lib/cli-sample";
import { codeOptions } from "@/lib/code-theme";
import { authentication, sdkSample } from "@/lib/sdk-sample";

import {
  type PlaygroundOperation,
  SessionUserContext,
  sessionAuthProvider,
  sessionFirst,
  useSessionUser,
  withReaderSession,
} from "./session-auth";

// The playground sends reads with the reader's session, and opens on it once
// the page knows the reader is signed in (components/session-auth.tsx). The
// order follows whether, not who: a switch to another account keeps the
// document, so the playground keeps what the reader typed.
export function OpenAPIPage(props: OpenAPIPageProps_Spec) {
  const user = useSessionUser();
  const signedIn = Boolean(user);
  const { payload } = props;
  const readerPayload = useMemo(
    () => (signedIn ? { ...payload, bundled: sessionFirst(payload.bundled) } : payload),
    [payload, signedIn],
  );
  return (
    <SessionUserContext value={user}>
      <OperationPage {...props} payload={readerPayload} />
    </SessionUserContext>
  );
}

// The request and response samples in the console's colours, like the pages'
// code blocks. An operation's samples are its call through @zitadel/api, the
// client the SDK pages document (lib/sdk-sample.ts), its `zitadel` command
// where the CLI can run it (lib/cli-sample.ts), then cURL: an empty registry
// leaves out Fumadocs' plain HTTP in the languages Zitadel ships no SDK for.
const OperationPage = createOpenAPIPage({
  shikiOptions: codeOptions,
  playground: {
    render: ({ method, path, operation }) => (
      <Playground method={method} path={path} operation={operation} />
    ),
  },
  codeUsages: createCodeUsageGeneratorRegistry(),
  generateCodeSamples: ({ operation, path, pathItem }) => [
    {
      id: "typescript",
      lang: "ts",
      label: "TypeScript",
      source: (request) =>
        sdkSample(operation, path, pathItem, request, authentication(operation, request)),
    },
    ...(cliCommand(operation, pathItem)
      ? [
          {
            id: "cli",
            lang: "bash",
            label: "CLI",
            source: (request: Parameters<typeof cliSample>[3]) =>
              cliSample(operation, path, pathItem, request) ?? "",
          },
        ]
      : []),
    { id: "curl", lang: curl.lang, label: curl.label, source: curl.generate },
  ],
});

const authProviders = [sessionAuthProvider];

// Fumadocs' own playground, sending through its operation: whether the session
// may send a request depends on the operation (components/session-auth.tsx),
// and `onRequestInit` is not told which.
function Playground({ method, path, operation }: PlaygroundOperation) {
  const fetchOptions = useMemo(
    () => ({
      onRequestInit: (init: RequestInit) => withReaderSession(init, { method, path, operation }),
    }),
    [method, path, operation],
  );
  return <PlaygroundClient authProviders={authProviders} fetchOptions={fetchOptions} />;
}
