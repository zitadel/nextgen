// Package schemas embeds the OpenAPI JSON meta-schema files for use by internal packages during schema validation.
package schemas

import (
	"embed"
	"strings"
)

// FS holds the embedded JSON schema files from this directory.
//
//go:embed *.json
var FS embed.FS

//go:embed examples/default-human-user-schema.json
var defaultHumanUserSchema []byte

func DefaultHumanUserSchema(serverURL string) []byte {
	json := string(defaultHumanUserSchema)
	json = strings.ReplaceAll(json, "${SERVER_URL}", serverURL)
	json = strings.ReplaceAll(json, "${USER_SCHEMA_URL}", DefaultHumanUserSchemaURL(serverURL))

	return []byte(json)
}

func DefaultHumanUserSchemaURL(serverURL string) string {
	return strings.TrimSuffix(serverURL, "/") + "-default-human-user.json"
}
