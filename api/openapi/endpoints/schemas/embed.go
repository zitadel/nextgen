// Package schemas embeds the OpenAPI JSON meta-schema files for use by internal packages during schema validation.
package schemas

import "embed"

// FS holds the embedded JSON schema files from this directory.
//
//go:embed *.json
var FS embed.FS
