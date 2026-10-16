// Package schemas embeds the OpenAPI JSON meta-schema files for use by internal packages during schema validation.
package schemas

import (
	"embed"
	"encoding/json"
	"fmt"
	"strings"

	configdefaults "github.com/zitadel/nextgen/packages/config/defaults"
)

// FS holds the embedded JSON schema files from this directory.
//
//go:embed *.json
var FS embed.FS

func DefaultHumanUserSchema(serverURL string) []byte {
	doc := string(configdefaults.DefaultHumanUserSchema())
	doc = strings.ReplaceAll(doc, "${SERVER_URL}", serverURL)
	doc = strings.ReplaceAll(doc, "${USER_SCHEMA_URL}", DefaultHumanUserSchemaURL(serverURL))

	return []byte(doc)
}

// PlatformDisplayNameProperty is the optional attribute the platform schema
// adds and designates as `x-display` (ADR 058 §2).
const PlatformDisplayNameProperty = "name"

const platformDisplayNameMaxLength = 200

// PlatformHumanUserSchema is the platform project's user schema: the default
// plus an optional display name, so the people operating Zitadel can name
// themselves. Derived from the default so the two cannot drift; it keeps the
// default's `$id`, which the admin seed documents point at.
func PlatformHumanUserSchema(serverURL string) ([]byte, error) {
	var doc map[string]any
	if err := json.Unmarshal(DefaultHumanUserSchema(serverURL), &doc); err != nil {
		return nil, fmt.Errorf("parse default human user schema: %w", err)
	}
	properties, ok := doc["properties"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("default human user schema has no properties object")
	}
	properties[PlatformDisplayNameProperty] = map[string]any{
		"type":        "string",
		"maxLength":   platformDisplayNameMaxLength,
		"description": "The user's name, shown in place of their email.",
	}
	doc["x-display"] = []any{PlatformDisplayNameProperty}
	return json.MarshalIndent(doc, "", "  ")
}

func DefaultHumanUserSchemaURL(serverURL string) string {
	return strings.TrimSuffix(serverURL, "/") + "/default-human-user.json"
}
