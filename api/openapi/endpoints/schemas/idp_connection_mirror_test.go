package schemas

import (
	"encoding/json"
	"maps"
	"os"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// idp-connection.json is the schema the server validates a connection document
// against, and endpoints/idps/idp-connection.yaml is the mirror the OpenAPI
// spec exposes, so generated clients get a typed body. Two files, one contract:
// this pins every way they are allowed to differ, so a field added to one and
// not the other fails here rather than reaching a client.
//
// Each deviation below exists because ogen cannot express the keyword, and each
// one asserts the key is there before dropping it: a deviation that stopped
// existing has to leave this test rather than sit here forever. They are
// written out one by one rather than stripped by class on purpose, so an allOf
// that appears somewhere new is a real divergence and fails.
func TestIdPConnectionMirrorMatchesSchema(t *testing.T) {
	schema := readJSON(t, "idp-connection.json")
	mirror := readYAML(t, "../idps/idp-connection.yaml")

	schemaProperties := schema["properties"].(map[string]any)
	mirrorProperties := mirror["properties"].(map[string]any)

	// The mirror refs the protocol enum so the spec can reuse it; the schema
	// states it inline.
	mirrorProperties["protocol"] = readYAML(t, "../idps/idp-protocol.yaml")

	// A root allOf and an oauth2 allOf each turn their whole object into an
	// untyped field, so the mirror states neither. Which protocol block is
	// required, and the scope a supplementary fetch needs, are enforced by the
	// server against the schema.
	_, ok := schema["allOf"]
	require.True(t, ok, "the root allOf is gone, drop it from this test")
	delete(schema, "allOf")

	oauth2 := schemaProperties["oauth2"].(map[string]any)
	_, ok = oauth2["allOf"]
	require.True(t, ok, "the oauth2 allOf is gone, drop it from this test")
	delete(oauth2, "allOf")

	// An anyOf of consts aborts ogen with "sum types with same names not
	// implemented" and the operation is dropped from the client altogether.
	// The mirror widens it to the two value classes ogen can carry; the schema
	// keeps the exact set.
	verifiedClaims := schemaProperties["verified_claims"].(map[string]any)
	_, ok = verifiedClaims["additionalProperties"]
	require.True(t, ok, "verified_claims no longer constrains its values, drop this from the test")
	verifiedClaims["additionalProperties"] = map[string]any{"oneOf": []any{
		map[string]any{"type": "boolean"},
		map[string]any{"type": "string"},
	}}

	// format: uri makes ogen decode into url.URL and drop every pattern on the
	// field, which would take the https-only rule and the fragment ban with
	// it. The mirror keeps the patterns and omits the format.
	oidcFields := schemaProperties["oidc"].(map[string]any)["properties"].(map[string]any)
	for _, name := range []string{"issuer", "jwks_uri", "authorization_endpoint", "token_endpoint", "userinfo_endpoint"} {
		field := oidcFields[name].(map[string]any)
		_, ok = field["format"]
		require.True(t, ok, "oidc.%s no longer carries format, drop it from this list", name)
		delete(field, "format")
	}
	oauth2Fields := oauth2["properties"].(map[string]any)
	for _, name := range []string{"authorization_endpoint", "token_endpoint", "userinfo_endpoint"} {
		field := oauth2Fields[name].(map[string]any)
		_, ok = field["format"]
		require.True(t, ok, "oauth2.%s no longer carries format, drop it from this list", name)
		delete(field, "format")
	}

	// Compared per property so a failure names the field and prints that
	// subtree alone. Whole-document equality buries one changed line in the
	// entire schema.
	names := slices.Sorted(maps.Keys(schemaProperties))
	require.Equal(t, names, slices.Sorted(maps.Keys(mirrorProperties)))
	for _, name := range names {
		require.Equal(t, indent(t, schemaProperties[name]), indent(t, mirrorProperties[name]), "property %s", name)
	}

	// Everything outside properties: $schema, type, required, additionalProperties.
	delete(schema, "properties")
	delete(mirror, "properties")
	require.Equal(t, indent(t, schema), indent(t, mirror))
}

func readJSON(t *testing.T, name string) map[string]any {
	t.Helper()
	raw, err := FS.ReadFile(name)
	require.NoError(t, err)
	var doc map[string]any
	require.NoError(t, json.Unmarshal(raw, &doc))
	return doc
}

// readYAML round-trips through JSON so both sides carry the same Go types for
// numbers and nested maps, and compare as the documents they describe.
func readYAML(t *testing.T, path string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	var doc map[string]any
	require.NoError(t, yaml.Unmarshal(raw, &doc))
	normalized, err := json.Marshal(doc)
	require.NoError(t, err)
	var out map[string]any
	require.NoError(t, json.Unmarshal(normalized, &out))
	return out
}

func indent(t *testing.T, doc any) string {
	t.Helper()
	out, err := json.MarshalIndent(doc, "", "  ")
	require.NoError(t, err)
	return string(out)
}
