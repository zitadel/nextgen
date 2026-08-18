package domain_test

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

const testProjectID = "proj-1"

func mustUnmarshal[T any](t *testing.T, content string) *T {
	value := new(T)
	err := json.Unmarshal([]byte(content), value)
	require.NoError(t, err)
	return value
}

// fakeSchemaResolver feeds inline JSON bytes through a real
// [jsonschema.SchemaFromJSON] parser so tests exercise the same
// keyword extraction the production path uses, without needing a
// database or HTTP client.
type fakeSchemaResolver struct {
	bytesByURL map[string][]byte
}

func (f *fakeSchemaResolver) Resolve(_ context.Context, _ domain.JSONSchemaStore, _, schemaURL string, _ []byte) (*jsonschema.Schema, error) {
	raw, ok := f.bytesByURL[schemaURL]
	if !ok {
		return nil, errors.New("fakeSchemaResolver: schema not found: " + schemaURL)
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return jsonschema.SchemaFromJSON("https://json-schema.org/draft/2020-12/schema", nil, v)
}

func newFakeResolver(t *testing.T, schemas map[string][]byte) domain.SchemaResolver {
	t.Helper()
	return &fakeSchemaResolver{bytesByURL: schemas}
}

// defaultSchema covers email/username/given_name/family_name with the
// same shape as the embedded built-in. Inlining it keeps test setup
// self-contained.
const defaultSchemaURL = "https://example.test/user/v1/default.user.schema.json"

const defaultSchemaContent string = `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true }, "passkey": { "enabled": true } },
		"required": ["email", "username", "given_name", "family_name"],
		"properties": {
			"email":       { "type": "string", "format": "email", "maxLength": 320, "x-unique": "team" },
			"username":    { "type": "string", "minLength": 3, "maxLength": 64, "x-unique": "team" },
			"given_name":  { "type": "string", "minLength": 1, "maxLength": 200 },
			"family_name": { "type": "string", "minLength": 1, "maxLength": 200 }
		}
	}`

// nestedSchemaContent carries an object property whose leaves cover the
// nested cases: a required leaf, an optional leaf, and one keyed with
// x-unique.
const nestedSchemaContent string = `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"required": ["email", "address"],
		"properties": {
			"email": { "type": "string", "format": "email", "x-unique": "team" },
			"address": {
				"type": "object",
				"required": ["street"],
				"properties": {
					"street": { "type": "string", "minLength": 1 },
					"city":   { "type": "string" },
					"zip":    { "type": "string", "x-unique": "project" }
				}
			}
		}
	}`

// identifierOutcomes is what an x-unique field contributes to
// ImplicitOutcomes — pinned here so cases stay readable.
var identifierOutcomes = []string{
	domain.FlowImplicitOutcomeUserNotFound,
	domain.FlowImplicitOutcomeUserAlreadyExists,
}

func TestSchemaFieldResolver_Resolve(t *testing.T) {
	const schemaURL = "https://example.test/case.json"

	tests := []struct {
		name    string
		schema  string
		step    string
		fields  []domain.Field
		want    domain.FlowResolvedFields
		wantErr error
	}{
		{
			name: "user-property text field with required and validation rules",
			schema: `{
				"type": "object",
				"required": ["given_name"],
				"properties": {
					"given_name": { "type": "string", "minLength": 1, "maxLength": 200 }
				}
			}`,
			step:   "register",
			fields: []domain.Field{"given_name"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{
						Name:       "given_name",
						TextKey:    "register.field.given_name",
						Type:       domain.FlowFieldTypeText,
						Required:   true,
						Validation: &domain.FlowFieldValidation{MinLength: 1, MaxLength: 200},
					},
				},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		{
			name: "user-property without any rules has nil Validation and Required=false",
			schema: `{
				"type": "object",
				"properties": {
					"nickname": { "type": "string" }
				}
			}`,
			step:   "step",
			fields: []domain.Field{"nickname"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{Name: "nickname", TextKey: "step.field.nickname", Type: domain.FlowFieldTypeText},
				},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		{
			name: "x-unique=team surfaces identifier challenge plus implicit outcomes",
			schema: `{
				"type": "object",
				"properties": {
					"email": { "type": "string", "format": "email", "x-unique": "team" }
				}
			}`,
			step:   "identifier",
			fields: []domain.Field{"email"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{
						Name:       "email",
						TextKey:    "identifier.field.email",
						Type:       domain.FlowFieldTypeEmail,
						Challenge:  domain.FlowFieldChallengeIdentifier,
						Unique:     domain.AttributeUniquenessTeam,
						Validation: &domain.FlowFieldValidation{Format: "email"},
					},
				},
				ImplicitOutcomes: map[string][]string{"email": identifierOutcomes},
			},
		},
		{
			name: "x-unique=project surfaces project-scoped uniqueness",
			schema: `{
				"type": "object",
				"properties": {
					"handle": { "type": "string", "x-unique": "project" }
				}
			}`,
			step:   "step",
			fields: []domain.Field{"handle"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{
						Name:      "handle",
						TextKey:   "step.field.handle",
						Type:      domain.FlowFieldTypeText,
						Challenge: domain.FlowFieldChallengeIdentifier,
						Unique:    domain.AttributeUniquenessProject,
					},
				},
				ImplicitOutcomes: map[string][]string{"handle": identifierOutcomes},
			},
		},
		{
			name: "x-auth-methods#password with password.enabled=true surfaces password challenge",
			schema: `{
				"type": "object",
				"x-auth-methods": { "password": { "enabled": true } }
			}`,
			step:   "password",
			fields: []domain.Field{"x-auth-methods#password"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{
						Name:       "x-auth-methods#password",
						TextKey:    "password.field.password",
						Type:       domain.FlowFieldTypePassword,
						Challenge:  domain.FlowFieldChallengePassword,
						Required:   true,
						Validation: &domain.FlowFieldValidation{MinLength: 8},
					},
				},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		// The next two cases describe runtime behavior on flow definitions
		// the validator would have rejected at save time ("X is not an
		// enabled authentication method"). The resolver stays permissive
		// — Challenge=None instead of an error — so it won't crash at
		// runtime if such a definition ever reaches it.
		{
			name: "x-auth-methods#password without x-auth-methods declaration → Challenge=None",
			schema: `{
				"type": "object"
			}`,
			step:   "step",
			fields: []domain.Field{"x-auth-methods#password"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{
						Name:       "x-auth-methods#password",
						TextKey:    "step.field.password",
						Type:       domain.FlowFieldTypePassword,
						Challenge:  domain.FlowFieldChallengeNone,
						Required:   true,
						Validation: &domain.FlowFieldValidation{MinLength: 8},
					},
				},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		{
			name: "x-auth-methods#password with password.enabled=false → Challenge=None",
			schema: `{
				"type": "object",
				"x-auth-methods": { "password": { "enabled": false } }
			}`,
			step:   "step",
			fields: []domain.Field{"x-auth-methods#password"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{
						Name:       "x-auth-methods#password",
						TextKey:    "step.field.password",
						Type:       domain.FlowFieldTypePassword,
						Challenge:  domain.FlowFieldChallengeNone,
						Required:   true,
						Validation: &domain.FlowFieldValidation{MinLength: 8},
					},
				},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		{
			name: "mixed user-property and auth-method fields preserve input order",
			schema: `{
				"type": "object",
				"x-auth-methods": { "password": { "enabled": true } },
				"properties": {
					"email": { "type": "string", "format": "email", "x-unique": "team" }
				}
			}`,
			step:   "login",
			fields: []domain.Field{"email", "x-auth-methods#password"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{
						Name:       "email",
						TextKey:    "login.field.email",
						Type:       domain.FlowFieldTypeEmail,
						Challenge:  domain.FlowFieldChallengeIdentifier,
						Unique:     domain.AttributeUniquenessTeam,
						Validation: &domain.FlowFieldValidation{Format: "email"},
					},
					{
						Name:       "x-auth-methods#password",
						TextKey:    "login.field.password",
						Type:       domain.FlowFieldTypePassword,
						Challenge:  domain.FlowFieldChallengePassword,
						Required:   true,
						Validation: &domain.FlowFieldValidation{MinLength: 8},
					},
				},
				ImplicitOutcomes: map[string][]string{"email": identifierOutcomes},
			},
		},
		{
			name: "format/type variants resolve to matching FlowFieldType",
			schema: `{
				"type": "object",
				"properties": {
					"website":    { "type": "string", "format": "uri" },
					"birthday":   { "type": "string", "format": "date" },
					"created":    { "type": "string", "format": "date-time" },
					"gender":     { "type": "string", "enum": ["female", "male", "non_binary"] },
					"newsletter": { "type": "boolean" }
				}
			}`,
			step:   "step",
			fields: []domain.Field{"website", "birthday", "created", "gender", "newsletter"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{Name: "website", TextKey: "step.field.website", Type: domain.FlowFieldTypeURL, Validation: &domain.FlowFieldValidation{Format: "uri"}},
					{Name: "birthday", TextKey: "step.field.birthday", Type: domain.FlowFieldTypeDate, Validation: &domain.FlowFieldValidation{Format: "date"}},
					{Name: "created", TextKey: "step.field.created", Type: domain.FlowFieldTypeDate, Validation: &domain.FlowFieldValidation{Format: "date-time"}},
					{Name: "gender", TextKey: "step.field.gender", Type: domain.FlowFieldTypeSelect, Validation: &domain.FlowFieldValidation{Enum: []string{"female", "male", "non_binary"}}},
					{Name: "newsletter", TextKey: "step.field.newsletter", Type: domain.FlowFieldTypeCheckbox},
				},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		{
			name: "boolean const: true surfaces Const on the checkbox",
			schema: `{
				"type": "object",
				"properties": {
					"acceptedTermsAndConditions": { "type": "boolean", "const": true }
				}
			}`,
			step:   "step",
			fields: []domain.Field{"acceptedTermsAndConditions"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{
						Name:       "acceptedTermsAndConditions",
						TextKey:    "step.field.acceptedTermsAndConditions",
						Type:       domain.FlowFieldTypeCheckbox,
						Validation: &domain.FlowFieldValidation{Const: true},
					},
				},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		{
			name: "string const surfaces Const on a text field",
			schema: `{
				"type": "object",
				"properties": {
					"tier": { "type": "string", "const": "free" }
				}
			}`,
			step:   "step",
			fields: []domain.Field{"tier"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{
						Name:       "tier",
						TextKey:    "step.field.tier",
						Type:       domain.FlowFieldTypeText,
						Validation: &domain.FlowFieldValidation{Const: "free"},
					},
				},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		{
			name: "nullable boolean union [null, boolean] reduces to checkbox",
			schema: `{
				"type": "object",
				"properties": {
					"opt_in": { "type": ["null", "boolean"] }
				}
			}`,
			step:   "step",
			fields: []domain.Field{"opt_in"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{Name: "opt_in", TextKey: "step.field.opt_in", Type: domain.FlowFieldTypeCheckbox},
				},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		{
			name: "nullable boolean union [boolean, null] reduces to checkbox",
			schema: `{
				"type": "object",
				"properties": {
					"opt_in": { "type": ["boolean", "null"] }
				}
			}`,
			step:   "step",
			fields: []domain.Field{"opt_in"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{Name: "opt_in", TextKey: "step.field.opt_in", Type: domain.FlowFieldTypeCheckbox},
				},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		{
			name: "empty fields list returns empty resolved set",
			schema: `{
				"type": "object",
				"properties": { "email": { "type": "string", "format": "email" } }
			}`,
			step:   "step",
			fields: []domain.Field{},
			want: domain.FlowResolvedFields{
				Fields:           []domain.FlowField{},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		{
			name: "unknown user-property field returns ErrFlowFieldUnknown",
			schema: `{
				"type": "object",
				"properties": { "email": { "type": "string", "format": "email" } }
			}`,
			step:    "step",
			fields:  []domain.Field{"not_in_schema"},
			wantErr: domain.ErrFlowFieldUnknown,
		},
		{
			name: "ambiguous JSON type union returns ErrFlowFieldUnsupportedType",
			schema: `{
				"type": "object",
				"properties": { "either": { "type": ["string", "boolean"] } }
			}`,
			step:    "step",
			fields:  []domain.Field{"either"},
			wantErr: domain.ErrFlowFieldUnsupportedType,
		},
		{
			name:   "nested leaf resolves through its dotted path",
			schema: nestedSchemaContent,
			step:   "profile",
			fields: []domain.Field{"address.street"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{
						Name:       "address.street",
						TextKey:    "profile.field.address.street",
						Type:       domain.FlowFieldTypeText,
						Required:   true,
						Validation: &domain.FlowFieldValidation{MinLength: 1},
					},
				},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		{
			name:   "x-unique on a nested leaf makes it an identifier",
			schema: nestedSchemaContent,
			step:   "profile",
			fields: []domain.Field{"address.zip"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{
						Name:      "address.zip",
						TextKey:   "profile.field.address.zip",
						Type:      domain.FlowFieldTypeText,
						Challenge: domain.FlowFieldChallengeIdentifier,
						Unique:    domain.AttributeUniquenessProject,
					},
				},
				ImplicitOutcomes: map[string][]string{"address.zip": identifierOutcomes},
			},
		},
		{
			name: "nested leaf under an optional parent is not required",
			schema: `{
				"type": "object",
				"properties": {
					"address": {
						"type": "object",
						"required": ["street"],
						"properties": { "street": { "type": "string" } }
					}
				}
			}`,
			step:   "profile",
			fields: []domain.Field{"address.street"},
			want: domain.FlowResolvedFields{
				Fields: []domain.FlowField{
					{
						Name:    "address.street",
						TextKey: "profile.field.address.street",
						Type:    domain.FlowFieldTypeText,
					},
				},
				ImplicitOutcomes: map[string][]string{},
			},
		},
		{
			name:    "object-typed property is not collectable",
			schema:  nestedSchemaContent,
			step:    "profile",
			fields:  []domain.Field{"address"},
			wantErr: domain.ErrFlowFieldNotScalar,
		},
		{
			name: "property carrying properties but no type is not collectable",
			schema: `{
				"type": "object",
				"properties": {
					"address": { "properties": { "street": { "type": "string" } } }
				}
			}`,
			step:    "profile",
			fields:  []domain.Field{"address"},
			wantErr: domain.ErrFlowFieldNotScalar,
		},
		{
			name: "array-typed property is not collectable",
			schema: `{
				"type": "object",
				"properties": { "tags": { "type": "array" } }
			}`,
			step:    "profile",
			fields:  []domain.Field{"tags"},
			wantErr: domain.ErrFlowFieldNotScalar,
		},
		{
			name: "property carrying items but no type is not collectable",
			schema: `{
				"type": "object",
				"properties": { "tags": { "items": { "type": "string" } } }
			}`,
			step:    "profile",
			fields:  []domain.Field{"tags"},
			wantErr: domain.ErrFlowFieldNotScalar,
		},
		{
			name:    "unknown nested leaf returns ErrFlowFieldUnknown",
			schema:  nestedSchemaContent,
			step:    "profile",
			fields:  []domain.Field{"address.country"},
			wantErr: domain.ErrFlowFieldUnknown,
		},
		{
			name:    "path through a scalar intermediate returns ErrFlowFieldUnknown",
			schema:  nestedSchemaContent,
			step:    "profile",
			fields:  []domain.Field{"email.domain"},
			wantErr: domain.ErrFlowFieldUnknown,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			schema := mustUnmarshal[jsonschema.Schema](t, tc.schema)
			resolver := domain.NewSchemaFieldResolver()

			got, err := resolver.Resolve(schema, tc.step, tc.fields)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err = %v, want errors.Is(%v)", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("err = %v, want nil", err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("Resolve mismatch:\n got: %+v\nwant: %+v", got, tc.want)
			}
		})
	}
}
