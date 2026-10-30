"use client";
import { createCodeUsageGeneratorRegistry } from "fumadocs-openapi/requests/generators";
import { curl } from "fumadocs-openapi/requests/generators/curl";
import { createOpenAPIPage, type OpenAPIPageProps_Spec } from "fumadocs-openapi/ui";
import { useMemo } from "react";

import { cliCommand, cliSample } from "@/lib/cli-sample";
import { codeOptions } from "@/lib/code-theme";
import { sdkSample } from "@/lib/sdk-sample";

import { ProjectPickerProvider } from "./project-picker";
import {
  SessionUserContext,
  sessionAuthProvider,
  sessionFirst,
  useSessionUser,
  withReaderSession,
} from "./session-auth";

// The playground sends with the reader's session, and opens on it once the
// page knows the reader is signed in (components/session-auth.tsx). The order
// follows whether, not who: a switch to another account keeps the document, so
// the playground keeps what the reader typed.
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
      <ProjectPickerProvider>
        <OperationPage {...props} payload={readerPayload} />
      </ProjectPickerProvider>
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
    authProviders: [sessionAuthProvider],
    fetchOptions: { onRequestInit: withReaderSession },
  },
  codeUsages: createCodeUsageGeneratorRegistry(),
  generateCodeSamples: ({ operation, path, pathItem }) => [
    {
      id: "typescript",
      lang: "ts",
      label: "TypeScript",
      source: (request) => sdkSample(operation, path, pathItem, request),
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
