package domain

import (
	"context"
	"fmt"
	"strings"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/ianlancetaylor/jsonschema/types"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// SchemaResolver is the read interface [SchemaFieldResolver] depends on.
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
//   - `type` + `format` → [FlowFieldType];
//   - top-level `required` membership → [FlowField.Required]
//   - `minLength`, `maxLength`, `format` → [FlowFieldValidation]
//   - `x-unique` (non-empty) → [FlowFieldChallengeIdentifier] +
//     [FlowImplicitOutcomeUserNotFound] + [FlowField.Unique]
//   - `x-auth-methods#` prefixed fields XX
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
	projectID, userSchemaURL, stepName string,
	fieldNames []string,
) (FlowResolvedFields, error) {
	schema, err := r.schemas.Resolve(ctx, client, projectID, userSchemaURL, nil)
	if err != nil {
		return FlowResolvedFields{}, fmt.Errorf("flow field resolver: load user schema: %w", err)
	}

	passwordEnabled := passwordAuthEnabled(schema)
	required := readRequiredSet(schema)
	properties := lookupProperties(schema)

	fields := make([]FlowField, 0, len(fieldNames))
	implicit := make(map[string][]string)

	for _, fieldName := range fieldNames {
		if strings.HasPrefix(fieldName, "x-auth-methods#") {
			field, err := buildFlowFieldForAuthMethod(fieldName, stepName)
			if err != nil {
				return FlowResolvedFields{}, fmt.Errorf("flow field resolver: %w", err)
			}
			fields = append(fields, field)
			continue
		}

		field, outcomes, err := buildFlowFieldForUserProperty(properties, fieldName, stepName, required, passwordEnabled)
		if err != nil {
			return FlowResolvedFields{}, fmt.Errorf("flow field resolver: %w", err)
		}

		fields = append(fields, field)
		if len(outcomes) > 0 {
			implicit[fieldName] = append(implicit[fieldName], outcomes...)
		}
	}

	return FlowResolvedFields{
		Fields:           fields,
		ImplicitOutcomes: implicit,
	}, nil
}

func buildFlowFieldForAuthMethod(fieldName string, stepName string) (FlowField, error) {
	fieldType, err := deriveFieldTypeForAuthMethod(fieldName)
	if err != nil {
		return FlowField{}, err
	}

	field := FlowField{
		Name:      fieldName,
		TextKey:   stepName + ".field." + strings.TrimPrefix(fieldName, "x-auth-methods#"),
		Type:      fieldType,
		Challenge: deriveChallengeForAuthMethod(nil),
		Required:  true,
		Validation: &FlowFieldValidation{
			// TODO: retrieve from password policy OR user-schema x-auth-methods properties
			MinLength: 8,
		},
	}

	return field, nil
}

func deriveFieldTypeForAuthMethod(fieldName string) (FlowFieldType, error) {
	switch fieldName {
	case "x-auth-methods#password":
		return FlowFieldTypePassword, nil
	}

	// TODO: create unknown field type
	return FlowFieldTypeText, fmt.Errorf(`unknown field type for "%s"`, fieldName)
}

func buildFlowFieldForUserProperty(properties map[string]*jsonschema.Schema, fieldName string, stepName string, required map[string]struct{}, passwordEnabled bool) (FlowField, []string, error) {
	propSchema, ok := properties[fieldName]
	if !ok {
		return FlowField{}, nil, fmt.Errorf("%w: %q", ErrFlowFieldUnknown, fieldName)
	}

	fieldType, err := deriveFieldType(propSchema)
	if err != nil {
		return FlowField{}, nil, err
	}

	unique := deriveUnique(propSchema)

	field := FlowField{
		Name:      fieldName,
		TextKey:   stepName + ".field." + fieldName,
		Type:      fieldType,
		Challenge: deriveChallenge(propSchema, unique, false),
		Unique:    unique,
	}
	if _, ok := required[fieldName]; ok {
		field.Required = true
	}
	if v := buildValidation(propSchema); v != nil {
		field.Validation = v
	}

	return field, ImplicitOutcomesForChallenge(field.Challenge), nil
}

// deriveFieldType maps the property's `enum`, `format`, and JSON
// `type` keywords to a [FlowFieldType]. `x-password: true` forces a
// password input regardless of the other keywords. A closed `enum`
// surfaces as `select`; JSON `type: boolean` surfaces as `checkbox`.
// Returns [ErrFlowFieldUnsupportedType] when the JSON `type` is an
// ambiguous union the resolver cannot reduce to a single kind.
func deriveFieldType(propSchema *jsonschema.Schema) (FlowFieldType, error) {
	jsonType, err := lookupJSONType(propSchema)
	if err != nil {
		return "", err
	}
	if len(lookupStringEnum(propSchema)) > 0 {
		return FlowFieldTypeSelect, nil
	}
	switch lookupString(propSchema, "format") {
	case "email":
		return FlowFieldTypeEmail, nil
	case "uri":
		return FlowFieldTypeURL, nil
	case "date", "date-time":
		return FlowFieldTypeDate, nil
	}
	if jsonType == "boolean" {
		return FlowFieldTypeCheckbox, nil
	}
	return FlowFieldTypeText, nil
}

// temp fix
func isPassword(propSchema *jsonschema.Schema) bool {
	return false
}

// deriveChallenge resolves the unified [FlowFieldChallenge]. A
// non-empty `x-unique` scope marks the field as Identifier (any
// uniquely-keyed property can identify a user). `x-password: true`
// surfaces as Password when the schema-level `x-auth-methods.password`
// is enabled. Other credential kinds (passkey, magic_link, sso, otp)
// have no user-property-shaped proof and are never surfaced here.
func deriveChallenge(propSchema *jsonschema.Schema, unique AttributeUniqueness, passwordEnabled bool) FlowFieldChallenge {
	if unique != AttributeUniquenessUnspecified {
		return FlowFieldChallengeIdentifier
	}
	return FlowFieldChallengeNone
}

// TODO
func deriveChallengeForAuthMethod(propSchema *jsonschema.Schema) FlowFieldChallenge {
	return FlowFieldChallengePassword
}

func deriveUnique(propSchema *jsonschema.Schema) AttributeUniqueness {
	switch lookupString(propSchema, "x-unique") {
	case "project":
		return AttributeUniquenessProject
	case "team":
		return AttributeUniquenessTeam
	}
	return AttributeUniquenessUnspecified
}

func buildValidation(propSchema *jsonschema.Schema) *FlowFieldValidation {
	v := FlowFieldValidation{
		Format:    lookupString(propSchema, "format"),
		MinLength: lookupInt(propSchema, "minLength"),
		MaxLength: lookupInt(propSchema, "maxLength"),
		Enum:      lookupStringEnum(propSchema),
	}
	if v.Format == "" && v.MinLength == 0 && v.MaxLength == 0 && len(v.Enum) == 0 {
		return nil
	}
	return &v
}

// lookupJSONType returns the property's single JSON `type` keyword.
// JSON Schema allows `type` to be either a string or an array of
// strings; the nullable idiom `["null", X]` (in either order) is
// reduced to X. Any other multi-entry union yields
// [ErrFlowFieldUnsupportedType], since the resolver has no rule for
// picking one input kind over the other.
func lookupJSONType(schema *jsonschema.Schema) (string, error) {
	v, ok := schema.LookupKeyword("type")
	if !ok {
		return "", nil
	}
	s, ok := v.(types.PartStringOrStrings)
	if !ok {
		return "", nil
	}
	if s.String != "" {
		return s.String, nil
	}
	var nonNull []string
	for _, t := range s.Strings {
		if t != "null" {
			nonNull = append(nonNull, t)
		}
	}
	switch len(nonNull) {
	case 0:
		return "", nil
	case 1:
		return nonNull[0], nil
	default:
		return "", fmt.Errorf("%w: %v", ErrFlowFieldUnsupportedType, s.Strings)
	}
}

// lookupStringEnum returns the property's `enum` keyword, restricted to
// string entries. Non-string entries are skipped: the user meta-schema
// surfaces enums only for closed text choices today; numeric/boolean
// enums (if ever added) would need a richer wire type.
func lookupStringEnum(schema *jsonschema.Schema) []string {
	v, ok := schema.LookupKeyword("enum")
	if !ok {
		return nil
	}
	part, ok := v.(types.PartAny)
	if !ok {
		return nil
	}
	raw, ok := part.V.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
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
