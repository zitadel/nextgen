package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

// todo (grvijayan): set to be the same as const defined for metaSchema in user-schema.json, will be updated once we have a decision on setting const
const testBuiltinBase = "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas"

func newTestValidator(t *testing.T) *domain.SchemaValidator {
	t.Helper()
	v, err := domain.NewSchemaValidator(testBuiltinBase)
	require.NoError(t, err)
	return v
}

func TestNewTenantSchemaValidator(t *testing.T) {
	t.Run("succeeds with valid base", func(t *testing.T) {
		v, err := domain.NewSchemaValidator(testBuiltinBase)
		require.NoError(t, err)
		require.NotNil(t, v)
	})

	t.Run("fails with empty base", func(t *testing.T) {
		_, err := domain.NewSchemaValidator("")
		require.Error(t, err)
	})
	t.Run("fails with relative base", func(t *testing.T) {
		_, err := domain.NewSchemaValidator("schemas/meta")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInvalidBuiltinPublicBase)
	})
	t.Run("fails with no-host URL", func(t *testing.T) {
		_, err := domain.NewSchemaValidator("file:///local/path")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInvalidBuiltinPublicBase)
	})
	t.Run("trailing slash is normalized", func(t *testing.T) {
		v, err := domain.NewSchemaValidator("https://example.test/schemas/")
		require.NoError(t, err)
		require.NotNil(t, v)
	})
}

func TestTenantSchemaValidator_ValidateAgainstMetaSchema(t *testing.T) {
	v := newTestValidator(t)

	tests := []struct {
		name                 string
		input                []byte
		wantErr              error
		wantValidationErrors map[string]string
	}{
		{
			name: "valid user schema",
			input: []byte(`{
				"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.json",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"passkey": { "enabled": true }
				}
			}`),
		},
		{
			name: "valid user schema with optional properties",
			input: []byte(`{
				"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.json",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"description": "A user schema",
				"x-auth-methods": {
					"passkey": { "enabled": true }
				},
				"required": ["email"],
				"properties": {
					"email": { "kind": "user-property", "type": "string", "title": "Email" }
				}
			}`),
		},
		{
			name: "valid with nested property",
			input: []byte(`{
				"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.json",
				"$id": "https://example.test/schemas/my-user.json",
				"kind":    "user-schema",
				"title":   "My User",
				"x-auth-methods": {
					"passkey": { "enabled": true }
				},
				"properties": {
					"address": {
						"type": "object",
						"title": "Address",
						"properties": {
							"street": { "title": "Street", "type": "string" }
						}
					}
				}
			}`),
		},
		{
			name: "dotted property name at the top level",
			input: []byte(`{
				"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.json",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "enabled": true }
				},
				"properties": {
					"address.street": { "type": "string" }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			// Two levels down, so it only fails if user-property.json
			// recurses into its own `properties` map.
			name: "dotted property name inside a nested object",
			input: []byte(`{
				"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.json",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "enabled": true }
				},
				"properties": {
					"address": {
						"type": "object",
						"properties": {
							"geo": {
								"type": "object",
								"properties": {
									"zip.code": { "type": "string" }
								}
							}
						}
					}
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			// A nested leaf carries x-unique the same way a top-level one
			// does, so a typo there has to fail rather than silently leave
			// the value non-unique.
			name: "invalid x-unique on a nested property",
			input: []byte(`{
				"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.json",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "enabled": true }
				},
				"properties": {
					"address": {
						"type": "object",
						"properties": {
							"zipCode": { "type": "string", "x-unique": "bogus" }
						}
					}
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			// The audit emitter enables the value for any non-empty string
			// other than "false", so `x-audit: "no"` would allowlist a field
			// while reading as a refusal. The dialect is boolean-only, which
			// turns that into a push-time failure.
			name: "invalid x-audit string",
			input: []byte(`{
				"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.json",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "enabled": true }
				},
				"properties": {
					"email": { "type": "string", "x-audit": "no" }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
		},
		{
			// A property is an open bag: the dialect names the annotations it
			// consumes, and carries anything else through untouched. Dropping
			// an annotation from the vocabulary therefore stops documenting
			// it, it does not start rejecting documents that still carry it.
			name: "undeclared annotation on a property is accepted",
			input: []byte(`{
				"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.json",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"passkey": { "enabled": true }
				},
				"properties": {
					"email": {
						"type": "string",
						"writeOnly": true,
						"x-audit": true,
						"x-not-a-real-annotation": true
					}
				}
			}`),
		},
		{
			name: "missing metaSchema",
			input: []byte(`{
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "enabled": true }
				}
			}`),
			wantErr: domain.ErrMissingSchemaID,
		},
		{
			name:    "missing metaSchema field",
			input:   []byte(`{"kind": "user-schema", "title": "No Schema ID"}`),
			wantErr: domain.ErrMissingSchemaID,
		},
		{
			name:    "unknown metaSchema URI",
			input:   []byte(`{"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/unknown.json", "title": "Unknown"}`),
			wantErr: domain.ErrUnknownSchemaURI,
		},
		{
			name: "missing required x-auth-methods",
			input: []byte(`{
				"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.json",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User"
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
			wantValidationErrors: map[string]string{
				"/required/x-auth-methods": `missing required field "x-auth-methods"`,
			},
		},
		{
			name: "invalid auth method — missing enabled",
			input: []byte(`{
				"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.json",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": {}
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
			wantValidationErrors: map[string]string{
				"/properties/x-auth-methods/properties/password/required/enabled": `missing required field "enabled"`,
			},
		},
		{
			name: "unknown auth method key rejected",
			input: []byte(`{
				"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.json",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"totp": { "enabled": true }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
			wantValidationErrors: map[string]string{
				"/properties/x-auth-methods/additionalProperties/totp": `false schema never matches`,
			},
		},
		{
			name: "unknown auth method field rejected",
			input: []byte(`{
				"metaSchema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/user-schema.json",
				"$id": "https://example.test/schemas/my-user.json",
				"kind": "user-schema",
				"title": "My User",
				"x-auth-methods": {
					"password": { "enabled": true, "position": 0 }
				}
			}`),
			wantErr: domain.ErrSchemaValidationFailed,
			wantValidationErrors: map[string]string{
				"/properties/x-auth-methods/properties/password/additionalProperties/position": `false schema never matches`,
			},
		},
		{
			name:                 "invalid JSON",
			input:                []byte(`{invalid`),
			wantErr:              domain.ErrSchemaParseFailed,
			wantValidationErrors: map[string]string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := v.ValidateAgainstMetaSchema(tt.input)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				if tt.wantValidationErrors != nil {
					assert.Equal(t, tt.wantValidationErrors, domain.FlattenValidationErrors(err))
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestSchemaValidator_GetBuiltinSchema(t *testing.T) {
	v := newTestValidator(t)

	t.Run("returns schema for user-schema kind", func(t *testing.T) {
		uri := testBuiltinBase + "/user-schema.json"
		schema, err := v.GetBuiltinSchema(uri)
		require.NoError(t, err)
		require.NotNil(t, schema)
	})

	t.Run("returns schema for flow-definition kind", func(t *testing.T) {
		uri := testBuiltinBase + "/flow-definition.json"
		schema, err := v.GetBuiltinSchema(uri)
		require.NoError(t, err)
		require.NotNil(t, schema)
	})

	t.Run("returns independent clone — mutations do not affect validator", func(t *testing.T) {
		uri := testBuiltinBase + "/user-schema.json"
		s1, err := v.GetBuiltinSchema(uri)
		require.NoError(t, err)
		// Truncate s1's parts; s2 must remain intact
		s1.Parts = s1.Parts[:0]
		s2, err := v.GetBuiltinSchema(uri)
		require.NoError(t, err)
		assert.NotEmpty(t, s2.Parts, "second clone should be unaffected by mutation of first")
	})

	t.Run("returns error for unknown kind", func(t *testing.T) {
		schema, err := v.GetBuiltinSchema("https://example.test/schemas/unknown.json")
		require.ErrorIs(t, err, domain.ErrUnknownSchemaURI)
		assert.Nil(t, schema)
	})

	t.Run("returns error for empty kind", func(t *testing.T) {
		schema, err := v.GetBuiltinSchema("")
		require.ErrorIs(t, err, domain.ErrUnknownSchemaURI)
		assert.Nil(t, schema)
	})
}

func TestSchemaValidator_LatestSchemaURI(t *testing.T) {
	v := newTestValidator(t)

	t.Run("returns URI for user-schema kind", func(t *testing.T) {
		uri, err := v.LatestSchemaURI(domain.SchemaKindUser)
		require.NoError(t, err)
		assert.Equal(t, testBuiltinBase+"/user-schema.json", uri)
	})

	t.Run("returns URI for flow-definition kind", func(t *testing.T) {
		uri, err := v.LatestSchemaURI(domain.SchemaKindFlowDefinition)
		require.NoError(t, err)
		assert.Equal(t, testBuiltinBase+"/flow-definition.json", uri)
	})

	t.Run("returned URI resolves to a valid schema", func(t *testing.T) {
		uri, err := v.LatestSchemaURI(domain.SchemaKindFlowDefinition)
		require.NoError(t, err)
		schema, err := v.GetBuiltinSchema(uri)
		require.NoError(t, err)
		assert.NotNil(t, schema)
	})

	t.Run("returns error for unknown kind", func(t *testing.T) {
		_, err := v.LatestSchemaURI("unknown-kind")
		require.ErrorIs(t, err, domain.ErrUnknownSchemaKind)
	})
}

func TestTenantSchemaValidator_UserSchemaDesignations(t *testing.T) {
	v := newTestValidator(t)

	doc := func(body string) []byte {
		return []byte(`{
			"metaSchema": "` + testBuiltinBase + `/user-schema.json",
			"$id": "https://example.test/schemas/my-user.json",
			"kind": "user-schema",
			"title": "My User",
			` + body + `}`)
	}

	tests := []struct {
		name    string
		input   []byte
		wantErr error
	}{
		{
			name: "identifier on a project-unique leaf",
			input: doc(`"x-auth-methods": {"password": {"enabled": true}},
				"x-identifier": "email",
				"properties": {"email": {"type": "string", "x-unique": "project"}}`),
		},
		{
			name: "identifier on a nested leaf path",
			input: doc(`"x-auth-methods": {"passkey": {"enabled": true}},
				"x-identifier": "account.handle",
				"properties": {"account": {"type": "object", "properties": {
					"handle": {"type": "string", "x-unique": "project"}}}}`),
		},
		{
			name: "password enabled without a designation",
			input: doc(`"x-auth-methods": {"password": {"enabled": true}},
				"properties": {"email": {"type": "string", "x-unique": "project"}}`),
			wantErr: domain.ErrSchemaDesignationInvalid,
		},
		{
			name:  "passkey-only schema needs no designation",
			input: doc(`"x-auth-methods": {"passkey": {"enabled": true}}`),
		},
		{
			name: "identifier naming an unknown property",
			input: doc(`"x-auth-methods": {"passkey": {"enabled": true}},
				"x-identifier": "username",
				"properties": {"email": {"type": "string", "x-unique": "project"}}`),
			wantErr: domain.ErrSchemaDesignationInvalid,
		},
		{
			name: "identifier on a non-unique property",
			input: doc(`"x-auth-methods": {"passkey": {"enabled": true}},
				"x-identifier": "email",
				"properties": {"email": {"type": "string"}}`),
			wantErr: domain.ErrSchemaDesignationInvalid,
		},
		{
			name: "identifier on a team-unique property",
			input: doc(`"x-auth-methods": {"passkey": {"enabled": true}},
				"x-identifier": "username",
				"properties": {"username": {"type": "string", "x-unique": "team"}}`),
			wantErr: domain.ErrSchemaDesignationInvalid,
		},
		{
			name: "identifier on an object is not a leaf",
			input: doc(`"x-auth-methods": {"passkey": {"enabled": true}},
				"x-identifier": "account",
				"properties": {"account": {"type": "object", "properties": {
					"handle": {"type": "string", "x-unique": "project"}}}}`),
			wantErr: domain.ErrSchemaDesignationInvalid,
		},
		{
			name: "display on leaves without uniqueness",
			input: doc(`"x-auth-methods": {"passkey": {"enabled": true}},
				"x-display": ["givenName", "name.family"],
				"properties": {
					"givenName": {"type": "string"},
					"name": {"type": "object", "properties": {"family": {"type": "string"}}}}`),
		},
		{
			name: "display naming an unknown property",
			input: doc(`"x-auth-methods": {"passkey": {"enabled": true}},
				"x-display": ["nickname"],
				"properties": {"email": {"type": "string"}}`),
			wantErr: domain.ErrSchemaDesignationInvalid,
		},
		{
			name: "display entry must be a leaf",
			input: doc(`"x-auth-methods": {"passkey": {"enabled": true}},
				"x-display": ["name"],
				"properties": {"name": {"type": "object", "properties": {"family": {"type": "string"}}}}`),
			wantErr: domain.ErrSchemaDesignationInvalid,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := v.ValidateAgainstMetaSchema(tt.input)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			assert.NoError(t, err)
		})
	}
}
