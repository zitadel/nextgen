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

// PlatformDisplayNameProperty is the optional attribute the platform project's
// user schema adds for a person's name, and the one it designates as `x-display`
// (ADR 058 §2), so `display` on a user-ref — the console's sidebar and account
// menu — shows it once set.
const PlatformDisplayNameProperty = "name"

// platformDisplayNameMaxLength bounds the name: generous for any real name, and
// short enough that a pasted blob cannot become what every user-ref renders.
const platformDisplayNameMaxLength = 200

// PlatformHumanUserSchema is the user schema seeded into the platform project:
// the default human user schema plus an optional display name.
//
// The platform project's users are the people operating Zitadel itself — the
// cloud's root admin, the local `zitadel start` admin, console operators — and
// they should be able to name themselves. Customer projects keep the default
// untouched: what their users carry is theirs to decide.
//
// It is derived from the default rather than kept as a second file, so the two
// cannot drift apart: it keeps the same `$id`, which is what the admin seed
// documents (`zitadel start`, the cloud's `admin-document.mjs`) point at, and
// `name` stays optional, so registration still asks for an email only.
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
		"description": "The user's name, shown in place of their email where the user is named. Optional.",
	}
	doc["x-display"] = []any{PlatformDisplayNameProperty}
	return json.MarshalIndent(doc, "", "  ")
}

func DefaultHumanUserSchemaURL(serverURL string) string {
	return strings.TrimSuffix(serverURL, "/") + "/default-human-user.json"
}
