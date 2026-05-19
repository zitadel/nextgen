package domain

import (
	"context"
	"fmt"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/ianlancetaylor/jsonschema/types"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// SchemaResolver is the read seam [SchemaFieldResolver] depends on.
// Narrowed to a single method so tests can swap in a fake without
// constructing a real LRU cache + repository + HTTP client.
// [JSONSchemaResolver] satisfies it in production.
type SchemaResolver interface {
	Resolve(ctx context.Context, client database.QueryExecutor, projectID, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error)
}

// SchemaFieldResolver is the production [FlowFieldResolver]. It reads a
// customer's user schema through [SchemaResolver] and translates its
// keywords into [FlowField] payloads.
//
// Translation map (user meta-schema → [FlowField]):
//
//   - `type` + `format` → [FlowFieldType]; `x-password: true` forces
//     [FlowFieldTypePassword].
//   - top-level `required` membership → [FlowField.Required]
//   - `minLength`, `maxLength`, `format` → [FlowFieldValidation]
//   - `x-identifier` → [FlowFieldChallengeIdentifier] +
//     [FlowImplicitOutcomeUserNotFound]
//   - `x-unique` → [FlowField.Unique]
//   - `x-password: true` combined with schema-level
//     `x-auth-methods.password.enabled = true` →
//     [FlowFieldChallengePassword]. Other auth methods do not have
//     user-property-shaped credentials and are not surfaced here.
type SchemaFieldResolver struct {
	schemas SchemaResolver
}

// NewSchemaFieldResolver returns a [FlowFieldResolver] backed by the
// given [SchemaResolver].
func NewSchemaFieldResolver(schemas SchemaResolver) *SchemaFieldResolver {
	return &SchemaFieldResolver{schemas: schemas}
}

var _ FlowFieldResolver = (*SchemaFieldResolver)(nil)

func (r *SchemaFieldResolver) Resolve(
	ctx context.Context,
	client database.QueryExecutor,
	projectID, userSchemaURL string,
	fieldNames []string,
) (FlowResolvedFields, error) {
	schema, err := r.schemas.Resolve(ctx, client, projectID, userSchemaURL, nil)
	if err != nil {
		return FlowResolvedFields{}, fmt.Errorf("flow field resolver: load user schema: %w", err)
	}

	passwordEnabled := passwordAuthEnabled(schema)
	required := readRequiredSet(schema)
	properties := lookupProperties(schema)

	fields := make(map[string]FlowField, len(fieldNames))
	implicit := make(map[string][]string)

	for _, name := range fieldNames {
		propSchema, ok := properties[name]
		if !ok {
			return FlowResolvedFields{}, fmt.Errorf("%w: %q", ErrFlowFieldUnknown, name)
		}
		field := buildFlowField(name, propSchema, required, passwordEnabled)
		fields[name] = field
		if outcomes := ImplicitOutcomesForChallenge(field.Challenge); len(outcomes) > 0 {
			implicit[name] = append(implicit[name], outcomes...)
		}
	}

	return FlowResolvedFields{
		Fields:           fields,
		ImplicitOutcomes: implicit,
	}, nil
}

// buildFlowField translates a user-schema property into a [FlowField].
func buildFlowField(name string, propSchema *jsonschema.Schema, required map[string]struct{}, passwordEnabled bool) FlowField {
	field := FlowField{
		TextKey:   "field." + name,
		Type:      deriveFieldType(propSchema),
		Challenge: deriveChallenge(propSchema, passwordEnabled),
		Unique:    deriveUnique(propSchema),
	}
	if _, ok := required[name]; ok {
		field.Required = true
	}
	if v := buildValidation(propSchema); v != nil {
		field.Validation = v
	}
	return field
}

// deriveFieldType maps the property's `format` to a [FlowFieldType].
// `x-password: true` forces a password input regardless of `format`.
func deriveFieldType(propSchema *jsonschema.Schema) FlowFieldType {
	if isPassword(propSchema) {
		return FlowFieldTypePassword
	}
	switch lookupString(propSchema, "format") {
	case "email":
		return FlowFieldTypeEmail
	case "uri":
		return FlowFieldTypeURL
	case "date", "date-time":
		return FlowFieldTypeDate
	}
	return FlowFieldTypeText
}

// deriveChallenge resolves the unified [FlowFieldChallenge].
// `x-identifier: true` surfaces as Identifier; `x-password: true`
// surfaces as Password when the schema-level `x-auth-methods.password`
// is enabled. Other credential kinds (passkey, magic_link, sso, otp)
// have no user-property-shaped proof and are never surfaced here.
func deriveChallenge(propSchema *jsonschema.Schema, passwordEnabled bool) FlowFieldChallenge {
	if isIdentifier(propSchema) {
		return FlowFieldChallengeIdentifier
	}
	if isPassword(propSchema) && passwordEnabled {
		return FlowFieldChallengePassword
	}
	return FlowFieldChallengeNone
}

func deriveUnique(propSchema *jsonschema.Schema) FlowFieldUniqueScope {
	switch lookupString(propSchema, "x-unique") {
	case "organization":
		return FlowFieldUniqueScopeOrganization
	case "instance":
		return FlowFieldUniqueScopeInstance
	}
	return FlowFieldUniqueScopeNone
}

func buildValidation(propSchema *jsonschema.Schema) *FlowFieldValidation {
	v := FlowFieldValidation{
		Format:    lookupString(propSchema, "format"),
		MinLength: lookupInt(propSchema, "minLength"),
		MaxLength: lookupInt(propSchema, "maxLength"),
	}
	if v.Format == "" && v.MinLength == 0 && v.MaxLength == 0 {
		return nil
	}
	return &v
}

// passwordAuthEnabled reports whether the root schema declares
// `x-auth-methods.password.enabled = true`. Password is the only
// credential the resolver surfaces, so the broader set isn't needed.
func passwordAuthEnabled(schema *jsonschema.Schema) bool {
	v, ok := schema.LookupKeyword("x-auth-methods")
	if !ok {
		return false
	}
	raw, ok := v.(types.PartAny)
	if !ok {
		return false
	}
	methods, ok := raw.V.(map[string]any)
	if !ok {
		return false
	}
	entry, ok := methods["password"].(map[string]any)
	if !ok {
		return false
	}
	enabled, _ := entry["enabled"].(bool)
	return enabled
}

// readRequiredSet returns the names listed in the root schema's
// top-level `required` keyword.
func readRequiredSet(schema *jsonschema.Schema) map[string]struct{} {
	out := map[string]struct{}{}
	v, ok := schema.LookupKeyword("required")
	if !ok {
		return out
	}
	names, ok := v.(types.PartStrings)
	if !ok {
		return out
	}
	for _, n := range names {
		out[n] = struct{}{}
	}
	return out
}

// lookupProperties returns the root schema's `properties` map, or nil
// when the keyword is absent or malformed. A nil map yields the
// "every field is unknown" behavior at lookup sites.
func lookupProperties(schema *jsonschema.Schema) map[string]*jsonschema.Schema {
	v, ok := schema.LookupKeyword("properties")
	if !ok {
		return nil
	}
	m, ok := v.(types.PartMapSchema)
	if !ok {
		return nil
	}
	return map[string]*jsonschema.Schema(m)
}

func lookupString(schema *jsonschema.Schema, keyword string) string {
	v, ok := schema.LookupKeyword(keyword)
	if !ok {
		return ""
	}
	if s, ok := v.(types.PartString); ok {
		return string(s)
	}
	if any, ok := v.(types.PartAny); ok {
		if s, ok := any.V.(string); ok {
			return s
		}
	}
	return ""
}

func lookupInt(schema *jsonschema.Schema, keyword string) int {
	v, ok := schema.LookupKeyword(keyword)
	if !ok {
		return 0
	}
	if n, ok := v.(types.PartInt); ok {
		return int(n)
	}
	return 0
}

func isIdentifier(schema *jsonschema.Schema) bool {
	return lookupBool(schema, "x-identifier")
}

func isPassword(schema *jsonschema.Schema) bool {
	return lookupBool(schema, "x-password")
}

func lookupBool(schema *jsonschema.Schema, keyword string) bool {
	v, ok := schema.LookupKeyword(keyword)
	if !ok {
		return false
	}
	if b, ok := v.(types.PartBool); ok {
		return bool(b)
	}
	if any, ok := v.(types.PartAny); ok {
		if b, ok := any.V.(bool); ok {
			return b
		}
	}
	return false
}
