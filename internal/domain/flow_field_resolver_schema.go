package domain

import (
	"context"
	"fmt"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/ianlancetaylor/jsonschema/types"
)

// SchemaResolver loads a compiled JSON schema by URL. It is the
// loader [FlowStateMachineRuntime] depends on for runtime schema
// access; [SchemaFieldResolver] is the translator that runs on top of
// the loaded schema.
type SchemaResolver interface {
	Resolve(ctx context.Context, store JSONSchemaStore, projectID, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error)
}

// SchemaFieldResolver is the production [FlowFieldResolver]. It is a
// stateless translator from a loaded user schema to [FlowField]
// payloads — schema loading is the caller's responsibility (see
// [SchemaResolver]).
//
// Translation map (user meta-schema → [FlowField]):
//
//   - `type` + `format` → [FlowFieldType]
//   - top-level `required` membership → [FlowField.Required]
//   - `minLength`, `maxLength`, `format` → [FlowFieldValidation]
//   - `x-unique` (non-empty) → [FlowFieldChallengeIdentifier] +
//     [FlowImplicitOutcomeUserNotFound] + [FlowField.Unique]
//   - `x-auth-methods#<method>` field name → credential challenge for
//     that method (e.g. `x-auth-methods#password` → password)
type SchemaFieldResolver struct{}

// NewSchemaFieldResolver returns a stateless [FlowFieldResolver].
func NewSchemaFieldResolver() *SchemaFieldResolver {
	return &SchemaFieldResolver{}
}

var _ FlowFieldResolver = (*SchemaFieldResolver)(nil)

func (r *SchemaFieldResolver) Resolve(schema *jsonschema.Schema, stepName string, fieldNames []Field) (FlowResolvedFields, error) {
	root := newSchemaReader(schema)
	properties := root.Properties()
	required := root.RequiredSet()
	authMethods, err := root.AuthMethods()
	if err != nil {
		return FlowResolvedFields{}, fmt.Errorf("flow field resolver: read x-auth-methods: %w", err)
	}

	fields := make([]FlowField, 0, len(fieldNames))
	implicit := make(map[string][]string)

	for _, field := range fieldNames {
		var (
			ff  FlowField
			err error
		)
		switch {
		case field.IsAuthMethod():
			ff, err = resolveAuthMethodField(authMethods, field, stepName)
		default:
			ff, err = resolveUserPropertyField(properties, required, field, stepName)
		}
		if err != nil {
			return FlowResolvedFields{}, err
		}
		fields = append(fields, ff)
		if outcomes := ImplicitOutcomesForChallenge(ff.Challenge); len(outcomes) > 0 {
			implicit[field.String()] = outcomes
		}
	}

	return FlowResolvedFields{
		Fields:           fields,
		ImplicitOutcomes: implicit,
	}, nil
}

// resolveUserPropertyField builds a [FlowField] from a top-level
// property of the user schema. Returns [ErrFlowFieldUnknown] when the
// property is absent, [ErrFlowFieldUnsupportedType] when the JSON
// `type` keyword is an ambiguous union.
func resolveUserPropertyField(properties map[string]schemaReader, required map[string]struct{}, field Field, stepName string) (FlowField, error) {
	prop, ok := properties[field.String()]
	if !ok {
		return FlowField{}, fmt.Errorf("%w: %q", ErrFlowFieldUnknown, field.String())
	}

	fieldType, err := deriveUserPropertyType(prop)
	if err != nil {
		return FlowField{}, err
	}

	unique := deriveUnique(prop)

	ff := FlowField{
		Name:      field.String(),
		TextKey:   stepName + ".field." + field.String(),
		Type:      fieldType,
		Challenge: deriveIdentifierChallenge(unique),
		Unique:    unique,
	}
	if _, ok := required[field.String()]; ok {
		ff.Required = true
	}
	if v := buildValidation(prop); v != nil {
		ff.Validation = v
	}
	return ff, nil
}

// resolveAuthMethodField builds a [FlowField] from an
// `x-auth-methods#<method>` field name. The field carries the
// credential challenge only when the method is enabled on the schema;
// otherwise [FlowFieldChallengeNone] is returned (the validator
// rejects this at definition time).
func resolveAuthMethodField(authMethods xAuthMethodsReader, field Field, stepName string) (FlowField, error) {
	fieldType, err := deriveAuthMethodType(field)
	if err != nil {
		return FlowField{}, err
	}

	var challenge FlowFieldChallenge
	if field.AuthMethod() == "password" && authMethods.IsEnabled(field.AuthMethod()) {
		challenge = FlowFieldChallengePassword
	}

	return FlowField{
		Name:      field.String(),
		TextKey:   stepName + ".field." + field.AuthMethod(),
		Type:      fieldType,
		Challenge: challenge,
		Required:  true,
		Validation: &FlowFieldValidation{
			MinLength: 8, // TODO: should come from policy or user-schema
		},
	}, nil
}

// deriveUserPropertyType maps a user-property's `enum`, `format`, and
// JSON `type` keywords to a [FlowFieldType]. A closed `enum` surfaces
// as `select`; JSON `type: boolean` surfaces as `checkbox`. Returns
// [ErrFlowFieldUnsupportedType] when the JSON `type` is an ambiguous
// union the resolver cannot reduce to a single kind.
func deriveUserPropertyType(prop schemaReader) (FlowFieldType, error) {
	jsonType, err := prop.JSONType()
	if err != nil {
		return "", err
	}
	if len(prop.StringEnum()) > 0 {
		return FlowFieldTypeSelect, nil
	}
	switch prop.String("format") {
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

// deriveAuthMethodType returns the input kind for an
// `x-auth-methods#<method>` field. Today only `password` is
// recognized; other methods return [FlowFieldTypeUnknown] with an
// error.
func deriveAuthMethodType(field Field) (FlowFieldType, error) {
	switch field.AuthMethod() {
	case "password":
		return FlowFieldTypePassword, nil
	}
	return FlowFieldTypeUnknown, fmt.Errorf(`unknown field type for "%s"`, field.String())
}

// deriveIdentifierChallenge surfaces [FlowFieldChallengeIdentifier]
// when the property has any non-empty `x-unique` scope. Any uniquely-
// keyed property can identify a user.
func deriveIdentifierChallenge(unique AttributeUniqueness) FlowFieldChallenge {
	if unique != AttributeUniquenessUnspecified {
		return FlowFieldChallengeIdentifier
	}
	return FlowFieldChallengeNone
}

func deriveUnique(prop schemaReader) AttributeUniqueness {
	switch prop.String("x-unique") {
	case "project":
		return AttributeUniquenessProject
	case "team":
		return AttributeUniquenessTeam
	}
	return AttributeUniquenessUnspecified
}

func buildValidation(prop schemaReader) *FlowFieldValidation {
	v := FlowFieldValidation{
		Format:    prop.String("format"),
		MinLength: prop.Int("minLength"),
		MaxLength: prop.Int("maxLength"),
		Enum:      prop.StringEnum(),
	}
	if c, ok := prop.Const(); ok {
		v.Const = c
	}
	if v.Format == "" && v.MinLength == 0 && v.MaxLength == 0 && len(v.Enum) == 0 && v.Const == nil {
		return nil
	}
	return &v
}

// schemaReader is a thin reader over a [*jsonschema.Schema] that
// centralizes the keyword-shape quirks (PartString vs PartAny,
// nullable type unions, x-* extensions) so callers stay focused on
// translation. Used both at root level (Properties, RequiredSet,
// AuthMethods) and at property level (JSONType, String, Int,
// StringEnum).
type schemaReader struct {
	s *jsonschema.Schema
}

func newSchemaReader(s *jsonschema.Schema) schemaReader {
	return schemaReader{s: s}
}

// JSONType returns the property's single JSON `type` keyword. JSON
// Schema allows `type` to be either a string or an array of strings;
// the nullable idiom `["null", X]` (in either order) is reduced to X.
// Any other multi-entry union yields [ErrFlowFieldUnsupportedType],
// since the resolver has no rule for picking one input kind over the
// other.
func (r schemaReader) JSONType() (string, error) {
	v, ok := r.s.LookupKeyword("type")
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

// StringEnum returns the property's `enum` keyword, restricted to
// string entries. Non-string entries are skipped: the user meta-schema
// surfaces enums only for closed text choices today; numeric/boolean
// enums (if ever added) would need a richer wire type.
func (r schemaReader) StringEnum() []string {
	v, ok := r.s.LookupKeyword("enum")
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

// String returns the string value of the given keyword, or "" when
// absent or shaped differently.
func (r schemaReader) String(keyword string) string {
	v, ok := r.s.LookupKeyword(keyword)
	if !ok {
		return ""
	}
	if s, ok := v.(types.PartString); ok {
		return string(s)
	}
	if part, ok := v.(types.PartAny); ok {
		if s, ok := part.V.(string); ok {
			return s
		}
	}
	return ""
}

// Const returns the property's `const` value and true when present. The
// value keeps its JSON-decoded type (bool, string, float64, ...).
func (r schemaReader) Const() (any, bool) {
	v, ok := r.s.LookupKeyword("const")
	if !ok {
		return nil, false
	}
	part, ok := v.(types.PartAny)
	if !ok {
		return nil, false
	}
	return part.V, true
}

// Int returns the int value of the given keyword, or 0 when absent.
func (r schemaReader) Int(keyword string) int {
	v, ok := r.s.LookupKeyword(keyword)
	if !ok {
		return 0
	}
	if n, ok := v.(types.PartInt); ok {
		return int(n)
	}
	return 0
}

// Properties returns each top-level property of an object schema as
// its own [schemaReader], or nil when `properties` is absent or
// malformed.
func (r schemaReader) Properties() map[string]schemaReader {
	v, ok := r.s.LookupKeyword("properties")
	if !ok {
		return nil
	}
	m, ok := v.(types.PartMapSchema)
	if !ok {
		return nil
	}
	out := make(map[string]schemaReader, len(m))
	for name, prop := range m {
		out[name] = newSchemaReader(prop)
	}
	return out
}

// RequiredSet returns the names listed in the top-level `required`
// keyword as a set.
func (r schemaReader) RequiredSet() map[string]struct{} {
	out := map[string]struct{}{}
	v, ok := r.s.LookupKeyword("required")
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

// AuthMethods returns a reader over the root schema's `x-auth-methods`
// keyword. An empty (no-op) reader is returned when the keyword is
// absent. An error is returned only when the keyword is present but
// shaped differently than expected.
func (r schemaReader) AuthMethods() (xAuthMethodsReader, error) {
	v, ok := r.s.LookupKeyword("x-auth-methods")
	if !ok {
		return xAuthMethodsReader{}, nil
	}
	raw, ok := v.(types.PartAny)
	if !ok {
		return xAuthMethodsReader{}, fmt.Errorf("%w: %v", ErrFlowFieldUnsupportedType, v)
	}
	return xAuthMethodsReader{raw: raw}, nil
}

type xAuthMethodsReader struct {
	raw types.PartAny
}

func (x xAuthMethodsReader) IsEnabled(method string) bool {
	methods, ok := x.raw.V.(map[string]any)
	if !ok {
		return false
	}
	entry, ok := methods[method].(map[string]any)
	if !ok {
		return false
	}
	enabled, _ := entry["enabled"].(bool)
	return enabled
}
