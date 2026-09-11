package schemas

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// idp-connection.json is the meta-schema the server validates a connection
// document against, and endpoints/idps/idp-connection.yaml is the copy the
// OpenAPI spec exposes so generated clients get a typed body. Two files, one
// contract: this pins every way they are allowed to differ, so a field added
// to one and not the other fails here rather than reaching a client.
//
// Each deviation below exists because ogen cannot express the keyword. They
// are listed one by one rather than skipped by class on purpose — an allOf
// that appears somewhere new is a real divergence and must fail.
func TestIdPConnectionMirrorMatchesMetaSchema(t *testing.T) {
	source := readJSON(t, "idp-connection.json")
	mirror := readYAML(t, "../idps/idp-connection.yaml")

	// The mirror refs the protocol enum so the spec can reuse it; the
	// meta-schema states it inline.
	mirror["properties"].(map[string]any)["protocol"] = readYAML(t, "../idps/idp-protocol.yaml")

	// A root allOf and an oauth2 allOf each turn their whole object into an
	// untyped field, so the mirror states neither. Which protocol block is
	// required, and the scope a supplementary fetch needs, are enforced by the
	// server against the meta-schema.
	deleteAt(t, source, "allOf")
	deleteAt(t, source, "properties", "oauth2", "allOf")

	// An anyOf of consts aborts ogen with "sum types with same names not
	// implemented" and the operation is dropped from the client altogether.
	// The mirror widens it to the two value classes ogen can carry; the
	// meta-schema keeps the exact set.
	replaceAt(t, source, map[string]any{"oneOf": []any{
		map[string]any{"type": "boolean"},
		map[string]any{"type": "string"},
	}}, "properties", "verified_claims", "additionalProperties")

	// format: uri makes ogen decode into url.URL and drop every pattern on the
	// field, which would take the https-only rule and the fragment ban with
	// it. The mirror keeps the patterns and omits the format.
	for _, field := range []string{"issuer", "jwks_uri", "authorization_endpoint", "token_endpoint", "userinfo_endpoint"} {
		deleteAt(t, source, "properties", "oidc", "properties", field, "format")
	}
	for _, field := range []string{"authorization_endpoint", "token_endpoint", "userinfo_endpoint"} {
		deleteAt(t, source, "properties", "oauth2", "properties", field, "format")
	}

	require.Equal(t, indent(t, source), indent(t, mirror))
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

// deleteAt removes doc[path...]. It fails when the key is already absent: a
// deviation that stopped existing is one the mirror no longer has to make.
func deleteAt(t *testing.T, doc map[string]any, path ...string) {
	t.Helper()
	parent := descend(t, doc, path[:len(path)-1])
	require.Contains(t, parent, path[len(path)-1], "no longer present, drop it from the deviation list: %v", path)
	delete(parent, path[len(path)-1])
}

func replaceAt(t *testing.T, doc map[string]any, value any, path ...string) {
	t.Helper()
	parent := descend(t, doc, path[:len(path)-1])
	require.Contains(t, parent, path[len(path)-1], "no longer present, drop it from the deviation list: %v", path)
	parent[path[len(path)-1]] = value
}

func descend(t *testing.T, doc map[string]any, path []string) map[string]any {
	t.Helper()
	for _, key := range path {
		next, ok := doc[key].(map[string]any)
		require.True(t, ok, "%s is not an object", key)
		doc = next
	}
	return doc
}

func indent(t *testing.T, doc map[string]any) string {
	t.Helper()
	out, err := json.MarshalIndent(doc, "", "  ")
	require.NoError(t, err)
	return string(out)
}
