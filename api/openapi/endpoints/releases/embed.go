// Package releases embeds the shipped request and response examples for the
// releases endpoints so they can be asserted against the generated types.
package releases

import "embed"

// Examples holds the embedded example payloads from this directory.
//
//go:embed examples/*.json
var Examples embed.FS
