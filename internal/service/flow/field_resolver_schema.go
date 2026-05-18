package flow

import (
	"context"
	"fmt"
	"strings"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/ianlancetaylor/jsonschema/types"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// SchemaResolver is the subset of [domain.JSONSchemaResolver] the
// flow-field resolver needs. Defined here so tests can swap in a fake
// without constructing a real LRU cache + repository.
type SchemaResolver interface {
	Resolve(ctx context.Context, client database.QueryExecutor, projectID, schemaURL string, rootSchema []byte) (*jsonschema.Schema, error)
}

// SchemaFieldResolver is the production [domain.FlowFieldResolver]. It
// reads a customer's user schema through [SchemaResolver] and translates
// its keywords into [domain.FlowField] payloads.
//
// Translation map (user meta-schema → [domain.FlowField]):
//
//   - `type` + `format` → [domain.FlowFieldType]; `x-password: true`
//     forces [domain.FlowFieldTypePassword].
//   - top-level `required` membership → [domain.FlowField.Required]
//   - `minLength`, `maxLength`, `format` → [domain.FlowFieldValidation]
//   - `x-identifier` → [domain.FlowFieldChallengeIdentifier] +
//     [domain.FlowImplicitOutcomeUserNotFound]
//   - `x-unique` → [domain.FlowField.Unique]
//   - `x-password: true` combined with schema-level
//     `x-auth-methods.password.enabled = true` →
//     [domain.FlowFieldChallengePassword]. Other auth methods do not
//     have user-property-shaped credentials and are not surfaced here.
type SchemaFieldResolver struct {
	schemas SchemaResolver
}

// NewSchemaFieldResolver returns a [domain.FlowFieldResolver] backed by
// the given [SchemaResolver].
func NewSchemaFieldResolver(schemas SchemaResolver) *SchemaFieldResolver {
	return &SchemaFieldResolver{schemas: schemas}
}

var _ domain.FlowFieldResolver = (*SchemaFieldResolver)(nil)

// implicitOutcomesByChallenge lists the transition outcomes a field
// contributes by virtue of its [domain.FlowFieldChallenge]. New
// mappings (e.g. a future challenge that also implies an outcome)
// land here as additional entries — no branching in [Resolve].
var implicitOutcomesByChallenge = map[domain.FlowFieldChallenge][]string{
	domain.FlowFieldChallengeIdentifier: {domain.FlowImplicitOutcomeUserNotFound},
}

func (r *SchemaFieldResolver) Resolve(
	ctx context.Context,
	client database.QueryExecutor,
	projectID, userSchemaURL string,
	fieldNames []string,
) (domain.FlowResolvedFields, error) {
	schema, err := r.schemas.Resolve(ctx, client, projectID, userSchemaURL, nil)
	if err != nil {
		return domain.FlowResolvedFields{}, fmt.Errorf("flow field resolver: load user schema: %w", err)
	}

	passwordEnabled := passwordAuthEnabled(schema)
	required := readRequiredSet(schema)
	properties := lookupProperties(schema)

	fields := make(map[string]domain.FlowField, len(fieldNames))
	implicit := make(map[string][]string)

	for _, name := range fieldNames {
		propSchema, ok := properties[name]
		if !ok {
			return domain.FlowResolvedFields{}, fmt.Errorf("%w: %q", domain.ErrFlowFieldUnknown, name)
		}
		field := buildFlowField(name, propSchema, required, passwordEnabled)
		fields[name] = field
		if outcomes := implicitOutcomesByChallenge[field.Challenge]; len(outcomes) > 0 {
			implicit[name] = append(implicit[name], outcomes...)
		}
	}

	return domain.FlowResolvedFields{
		Fields:           fields,
		ImplicitOutcomes: implicit,
	}, nil
}

// Validate runs the schema-derived rules over the submitted values.
// Required-on-empty-string and unknown-property checks are layered on
// top of the library's per-keyword validators (the library treats
// `required` as a presence check, not an emptiness check, and treats
// `format` as an annotation unless an external validator is registered).
func (r *SchemaFieldResolver) Validate(
	ctx context.Context,
	client database.QueryExecutor,
	projectID, userSchemaURL string,
	values map[string]any,
) error {
	schema, err := r.schemas.Resolve(ctx, client, projectID, userSchemaURL, nil)
	if err != nil {
		return fmt.Errorf("flow field resolver: load user schema: %w", err)
	}

	required := readRequiredSet(schema)
	properties := lookupProperties(schema)

	var errs domain.FlowFieldValidationErrors
	for name, value := range values {
		propSchema, ok := properties[name]
		if !ok {
			errs = append(errs, domain.FlowFieldValidationError{Field: name, Rule: domain.FlowFieldValidationRuleUnknown})
			continue
		}
		str, isString := value.(string)
		if !isString {
			errs = append(errs, domain.FlowFieldValidationError{Field: name, Rule: domain.FlowFieldValidationRuleFormat})
			continue
		}
		if str == "" {
			if _, isRequired := required[name]; isRequired {
				errs = append(errs, domain.FlowFieldValidationError{Field: name, Rule: domain.FlowFieldValidationRuleRequired})
			}
			continue
		}
		errs = append(errs, validateString(name, str, propSchema)...)
	}

	if len(errs) > 0 {
		return errs
	}
	return nil
}

// buildFlowField translates a user-schema property into a [domain.FlowField].
func buildFlowField(name string, propSchema *jsonschema.Schema, required map[string]struct{}, passwordEnabled bool) domain.FlowField {
	field := domain.FlowField{
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

// deriveFieldType maps the property's `format` to a [domain.FlowFieldType].
// `x-password: true` forces a password input regardless of `format`.
func deriveFieldType(propSchema *jsonschema.Schema) domain.FlowFieldType {
	if isPassword(propSchema) {
		return domain.FlowFieldTypePassword
	}
	switch lookupString(propSchema, "format") {
	case "email":
		return domain.FlowFieldTypeEmail
	case "uri":
		return domain.FlowFieldTypeURL
	case "date", "date-time":
		return domain.FlowFieldTypeDate
	}
	return domain.FlowFieldTypeText
}

// deriveChallenge resolves the unified [domain.FlowFieldChallenge].
// `x-identifier: true` surfaces as Identifier; `x-password: true`
// surfaces as Password when the schema-level `x-auth-methods.password`
// is enabled. Other credential kinds (passkey, magic_link, sso, otp)
// have no user-property-shaped proof and are never surfaced here.
func deriveChallenge(propSchema *jsonschema.Schema, passwordEnabled bool) domain.FlowFieldChallenge {
	if isIdentifier(propSchema) {
		return domain.FlowFieldChallengeIdentifier
	}
	if isPassword(propSchema) && passwordEnabled {
		return domain.FlowFieldChallengePassword
	}
	return domain.FlowFieldChallengeNone
}

func deriveUnique(propSchema *jsonschema.Schema) domain.FlowFieldUniqueScope {
	switch lookupString(propSchema, "x-unique") {
	case "organization":
		return domain.FlowFieldUniqueScopeOrganization
	case "instance":
		return domain.FlowFieldUniqueScopeInstance
	}
	return domain.FlowFieldUniqueScopeNone
}

func buildValidation(propSchema *jsonschema.Schema) *domain.FlowFieldValidation {
	v := domain.FlowFieldValidation{
		Format:    lookupString(propSchema, "format"),
		MinLength: lookupInt(propSchema, "minLength"),
		MaxLength: lookupInt(propSchema, "maxLength"),
	}
	if v.Format == "" && v.MinLength == 0 && v.MaxLength == 0 {
		return nil
	}
	return &v
}

// validateString runs the per-keyword checks for a single property.
// Each known keyword maps 1:1 to a [domain.FlowFieldValidationRule]; an
// unknown keyword on the property is silently skipped, mirroring how
// the library treats it.
func validateString(name, value string, propSchema *jsonschema.Schema) []domain.FlowFieldValidationError {
	var out []domain.FlowFieldValidationError
	if min := lookupInt(propSchema, "minLength"); min > 0 && len(value) < min {
		out = append(out, domain.FlowFieldValidationError{Field: name, Rule: domain.FlowFieldValidationRuleMinLength})
	}
	if max := lookupInt(propSchema, "maxLength"); max > 0 && len(value) > max {
		out = append(out, domain.FlowFieldValidationError{Field: name, Rule: domain.FlowFieldValidationRuleMaxLength})
	}
	if lookupString(propSchema, "format") == "email" && !looksLikeEmail(value) {
		out = append(out, domain.FlowFieldValidationError{Field: name, Rule: domain.FlowFieldValidationRuleFormat})
	}
	return out
}

// looksLikeEmail is a deliberately minimal MVP check: one '@' with
// non-empty local and domain parts.
func looksLikeEmail(s string) bool {
	at := strings.IndexByte(s, '@')
	if at <= 0 || at == len(s)-1 {
		return false
	}
	return strings.IndexByte(s[at+1:], '@') < 0
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
