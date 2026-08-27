package domain

import (
	"context"
	"fmt"
	"slices"

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
//   - `required` membership at every level of the field's path →
//     [FlowField.Required]
//   - `minLength`, `maxLength`, `format` → [FlowFieldValidation]
//   - `x-unique` (non-empty) → [FlowField.Unique]
//   - the schema-root `x-identifier` designation → the designated field
//     carries [FlowFieldChallengeIdentifier] +
//     [FlowImplicitOutcomeUserNotFound]
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
	authMethods, err := root.AuthMethods()
	if err != nil {
		return FlowResolvedFields{}, fmt.Errorf("flow field resolver: read x-auth-methods: %w", err)
	}
	identifier := root.String(SchemaAnnotationIdentifier)

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
			ff, err = resolveUserPropertyField(root, field, stepName, identifier)
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

// resolveUserPropertyField builds a [FlowField] from a property of the
// user schema, addressed by its dotted path. Returns
// [ErrFlowFieldUnknown] when the path does not resolve,
// [ErrFlowFieldNotScalar] when it lands on an object or array, and
// [ErrFlowFieldUnsupportedType] when the JSON `type` keyword is an
// ambiguous union.
func resolveUserPropertyField(root schemaReader, field Field, stepName, identifier string) (FlowField, error) {
	prop, required, err := walkUserProperty(root, field)
	if err != nil {
		return FlowField{}, err
	}

	fieldType, err := deriveUserPropertyType(prop, field)
	if err != nil {
		return FlowField{}, err
	}

	unique := deriveUnique(prop)

	ff := FlowField{
		Name:      field.String(),
		TextKey:   stepName + ".field." + field.String(),
		Type:      fieldType,
		Challenge: deriveIdentifierChallenge(field, identifier),
		Unique:    unique,
		Required:  required,
	}
	if v := buildValidation(prop); v != nil {
		ff.Validation = v
	}
	return ff, nil
}

// walkUserProperty resolves a field's dotted path against the user
// schema, descending one `properties` level per segment, and reports
// whether every segment is listed in its own level's `required`. A
// missing segment — or an intermediate one that holds no `properties`,
// so the path cannot continue through it — yields
// [ErrFlowFieldUnknown] naming the whole path.
func walkUserProperty(root schemaReader, field Field) (schemaReader, bool, error) {
	parent, required := root, true
	for _, segment := range AttributeKey(field.String()).Nodes() {
		prop, ok := parent.Property(segment)
		if !ok {
			return schemaReader{}, false, fmt.Errorf("%w: %q", ErrFlowFieldUnknown, field.String())
		}
		if !parent.Requires(segment) {
			required = false
		}
		parent = prop
	}
	return parent, required, nil
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
// union the resolver cannot reduce to a single kind, and
// [ErrFlowFieldNotScalar] when the property has no field-shaped input.
func deriveUserPropertyType(prop schemaReader, field Field) (FlowFieldType, error) {
	jsonType, err := prop.JSONType()
	if err != nil {
		return "", err
	}
	// A property carrying `properties` is an object, and one carrying
	// `items` is an array, even when it omits the `type` keyword — which
	// would otherwise fall through to text and store a string where the
	// author declared a composite.
	if jsonType == "object" || jsonType == "array" || prop.HasProperties() || prop.HasItems() {
		return "", fmt.Errorf("%w: %q", ErrFlowFieldNotScalar, field.String())
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
// when the field names the schema's designated identifier (the
// schema-root `x-identifier` path). Any other property — unique or not —
// carries no identifier challenge: uniqueness is data integrity,
// identification is a designation (ADR 058 §5, retiring the "any
// `x-unique` property can identify" rule).
func deriveIdentifierChallenge(field Field, identifier string) FlowFieldChallenge {
	if identifier != "" && field.String() == identifier {
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

// Properties returns each property listed in this level's `properties`
// keyword as its own [schemaReader], or nil when the keyword is absent
// or malformed.
func (r schemaReader) Properties() map[string]schemaReader {
	m, ok := r.propertyMap()
	if !ok {
		return nil
	}
	out := make(map[string]schemaReader, len(m))
	for name, prop := range m {
		out[name] = newSchemaReader(prop)
	}
	return out
}

// Property answers for one name what [schemaReader.Properties] answers
// for every name, without materializing a reader per sibling. The walk
// down a field's path runs on every render, so it takes this route.
func (r schemaReader) Property(name string) (schemaReader, bool) {
	m, ok := r.propertyMap()
	if !ok {
		return schemaReader{}, false
	}
	prop, ok := m[name]
	if !ok {
		return schemaReader{}, false
	}
	return newSchemaReader(prop), true
}

// Requires reports whether name is listed in this level's `required`
// keyword — the single-name counterpart of [schemaReader.RequiredSet].
func (r schemaReader) Requires(name string) bool {
	v, ok := r.s.LookupKeyword("required")
	if !ok {
		return false
	}
	names, ok := v.(types.PartStrings)
	if !ok {
		return false
	}
	return slices.Contains(names, name)
}

// HasProperties reports whether this level carries a well-formed
// `properties` keyword, which marks it an object even when the `type`
// keyword is absent.
func (r schemaReader) HasProperties() bool {
	_, ok := r.propertyMap()
	return ok
}

// HasItems reports whether this level carries an `items` keyword, the
// array counterpart of [schemaReader.HasProperties].
func (r schemaReader) HasItems() bool {
	_, ok := r.s.LookupKeyword("items")
	return ok
}

func (r schemaReader) propertyMap() (types.PartMapSchema, bool) {
	v, ok := r.s.LookupKeyword("properties")
	if !ok {
		return nil, false
	}
	m, ok := v.(types.PartMapSchema)
	return m, ok
}

// RequiredSet returns the names listed in this level's `required`
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

// RequiredPaths returns the dotted paths a document must carry once the
// objects named in materialized exist: every name in `required`,
// recursed through the nested `required` of each required object. A
// required object that declares no `required` of its own ends the
// descent at the object itself — any leaf beneath it satisfies the
// coverage check.
//
// An optional object contributes its own `required` too once it appears
// in materialized. It only exists in the document because something
// beneath it was collected, and from that point document validation
// enforces the rest of its `required` list.
func (r schemaReader) RequiredPaths(materialized map[string]struct{}) map[string]struct{} {
	out := map[string]struct{}{}
	r.collectRequiredPaths("", materialized, out)
	return out
}

func (r schemaReader) collectRequiredPaths(prefix AttributeKey, materialized, out map[string]struct{}) {
	properties := r.Properties()
	required := r.RequiredSet()

	for name := range required {
		path := prefix.AppendNode(name)
		prop, ok := properties[name]
		if !ok || len(prop.RequiredSet()) == 0 {
			out[string(path)] = struct{}{}
			continue
		}
		prop.collectRequiredPaths(path, materialized, out)
	}

	// An optional object is invisible to the loop above, so descend into
	// the ones a collected field materializes.
	for name, prop := range properties {
		if _, isRequired := required[name]; isRequired {
			continue
		}
		path := prefix.AppendNode(name)
		if _, ok := materialized[string(path)]; !ok {
			continue
		}
		prop.collectRequiredPaths(path, materialized, out)
	}
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
