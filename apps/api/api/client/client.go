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
