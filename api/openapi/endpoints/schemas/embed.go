// Package schemas embeds the OpenAPI JSON meta-schema files for use by internal packages during schema validation.
package schemas

import (
	"embed"
	"strings"

	configdefaults "github.com/zitadel/nextgen/packages/config/defaults"
)

// FS holds the embedded JSON schema files from this directory.
//
//go:embed *.json
var FS embed.FS

func DefaultHumanUserSchema(serverURL string) []byte {
	json := string(configdefaults.DefaultHumanUserSchema())
	json = strings.ReplaceAll(json, "${SERVER_URL}", serverURL)
	json = strings.ReplaceAll(json, "${USER_SCHEMA_URL}", DefaultHumanUserSchemaURL(serverURL))

	return []byte(json)
}

func DefaultHumanUserSchemaURL(serverURL string) string {
	return strings.TrimSuffix(serverURL, "/") + "/default-human-user.json"
}
