// Package client points the generated API client at a deployment. The
// resource API lives under PathPrefix on the deployment's host (ADR 077),
// and callers know the host by its origin: ZITADEL_URL, the CLI's --server,
// the issuer a token is checked against.
package client

import (
	"strings"

	api "github.com/zitadel/nextgen/api/generated"
)

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

// New is the generated client for the API on origin.
func New(origin string, sec api.SecuritySource, opts ...api.ClientOption) (*api.Client, error) {
	return api.NewClient(BaseURL(origin), sec, opts...)
}
