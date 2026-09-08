package api_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	gen "github.com/zitadel/nextgen/api/generated"
)

// CreateSchema re-marshals the decoded body before validating it, so the
// generated codec must reproduce the wire document. The sso slot is the
// one auth-methods entry with a conditional schema; ogen falls back to an
// untyped field for shapes it cannot model and always emits those, which
// turned a body without sso into invalid JSON.
func TestUserSchemaRoundTrip(t *testing.T) {
	bodies := map[string]string{
		"no sso":             `{"kind":"user-schema","metaSchema":"https://x/user-schema.json","x-auth-methods":{"password":{"enabled":true}}}`,
		"sso disabled":       `{"kind":"user-schema","metaSchema":"https://x/user-schema.json","x-auth-methods":{"sso":{"enabled":false}}}`,
		"sso with providers": `{"kind":"user-schema","metaSchema":"https://x/user-schema.json","x-auth-methods":{"sso":{"enabled":true,"providers":["google","github"]}}}`,
	}
	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			var schema gen.UserSchema
			require.NoError(t, schema.UnmarshalJSON([]byte(body)))
			out, err := schema.MarshalJSON()
			require.NoError(t, err)
			require.True(t, json.Valid(out), "re-encoded body: %s", out)

			var want, got map[string]any
			require.NoError(t, json.Unmarshal([]byte(body), &want))
			require.NoError(t, json.Unmarshal(out, &got))
			require.Equal(t, want["x-auth-methods"], got["x-auth-methods"])
		})
	}
}
