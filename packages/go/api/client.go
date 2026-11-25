package api

import "strings"

// PathPrefix is where the resource API lives on a deployment's host, the
// spec's servers URL. The health probes, the console and the IdP callbacks
// stay at the root. The server mounts the API under the same constant
// (apps/api/api/client in the zitadel/nextgen repository).
const PathPrefix = "/api/v1"

// BaseURL is the API's base URL on origin: origin without a trailing slash,
// then PathPrefix. An origin that already ends in PathPrefix is taken as the
// base URL, so the prefix is never doubled.
func BaseURL(origin string) string {
	return strings.TrimSuffix(strings.TrimRight(origin, "/"), PathPrefix) + PathPrefix
}

// New is the generated client for the API on origin, the deployment's host as
// callers know it: ZITADEL_URL, the CLI's --server, the issuer a token is
// checked against. sec supplies the credential of every request.
func New(origin string, sec SecuritySource, opts ...ClientOption) (*Client, error) {
	return NewClient(BaseURL(origin), sec, opts...)
}
