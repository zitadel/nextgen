// Package client is where the resource API lives on a deployment's host
// (ADR 077): the prefix the server mounts the API under, and the base URL a
// caller builds on an origin. The Go client of the API is the public module
// go.zitadel.com/zitadel/v5 (packages/go), whose api package has the same
// constant and New for a generated client on an origin.
package client

import "strings"

// PathPrefix is where the resource API lives on a deployment's host, the
// spec's servers URL. The health probes, the console and the IdP callbacks
// stay at the root.
const PathPrefix = "/api/v1"

// BaseURL is the API's base URL on origin: origin without a trailing slash,
// then PathPrefix. An origin that already ends in PathPrefix is taken as the
// base URL, so the prefix is never doubled.
func BaseURL(origin string) string {
	return strings.TrimSuffix(strings.TrimRight(origin, "/"), PathPrefix) + PathPrefix
}

// DocsOrigin is the docs site a link names when it cannot be relative: the
// spec links docs pages root-relative (`/docs/concepts/...`), which only the
// docs' own pages resolve. The public Go client's godoc
// (api/cmd/gen_docs_links) and the deprecation Link the server sends
// (internal/api/mount.go) name it here. The TypeScript copies cannot import
// it, and TestDocsOriginCopies fails when one drifts: `@zitadel/api`'s
// DOCS_ORIGIN (packages/api/scripts/docs-links.ts), the console's DOCS_URL
// (apps/console/src/lib/docs.ts) and the CLI's design guidance
// (apps/cli/src/lib/orca/patchers/rule/guidance.ts).
const DocsOrigin = "https://preview.zitadel.com"
