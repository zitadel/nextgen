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
//   - `type` + `format` + property name → [domain.FlowFieldType]
//   - top-level `required` membership → [domain.FlowField.Required]
//   - `minLength`, `maxLength`, `format` → [domain.FlowFieldValidation]
//   - `x-identifier` → [domain.FlowFieldChallengeIdentifier] +
//     [domain.FlowImplicitOutcomeUserNotFound]
//   - `x-unique` → [domain.FlowField.Unique]
//   - schema-level `x-auth-methods` ∩ property name → credential
//     [domain.FlowFieldChallenge]
type SchemaFieldResolver struct {
	schemas SchemaResolver
}

// NewSchemaFieldResolver returns a [domain.FlowFieldResolver] backed by
// the given [SchemaResolver].
func NewSchemaFieldResolver(schemas SchemaResolver) *SchemaFieldResolver {
	return &SchemaFieldResolver{schemas: schemas}
}

var _ domain.FlowFieldResolver = (*SchemaFieldResolver)(nil)

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

	authMethods := readAuthMethods(schema)
	required := readRequiredSet(schema)
	properties, _ := lookupProperties(schema)

	fields := make(map[string]domain.FlowField, len(fieldNames))
	implicit := make(map[string][]string)

	for _, name := range fieldNames {
		propSchema, ok := properties[name]
		if !ok {
			return domain.FlowResolvedFields{}, fmt.Errorf("%w: %q", domain.ErrFlowFieldUnknown, name)
		}
		field := buildFlowField(name, propSchema, required, authMethods)
		fields[name] = field
		if field.Challenge == domain.FlowFieldChallengeIdentifier {
			implicit[name] = append(implicit[name], domain.FlowImplicitOutcomeUserNotFound)
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
	properties, _ := lookupProperties(schema)

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
func buildFlowField(name string, propSchema *jsonschema.Schema, required, authMethods map[string]struct{}) domain.FlowField {
	field := domain.FlowField{
		TextKey:   "field." + name,
		Type:      deriveFieldType(name, propSchema),
		Challenge: deriveChallenge(name, propSchema, authMethods),
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

// deriveFieldType maps the property's JSON `type`/`format` plus its
// name to a [domain.FlowFieldType]. The property name acts as a
// tiebreaker (a string property named `password` is rendered as a
// password input).
func deriveFieldType(name string, propSchema *jsonschema.Schema) domain.FlowFieldType {
	if name == "password" {
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
	switch lookupString(propSchema, "type") {
	case "number", "integer":
		return domain.FlowFieldTypeNumber
	}
	return domain.FlowFieldTypeText
}

// deriveChallenge resolves the unified [domain.FlowFieldChallenge]: an
// `x-identifier` property surfaces as Identifier; otherwise the
// property's name is matched against the schema-level enabled
// `x-auth-methods`.
func deriveChallenge(name string, propSchema *jsonschema.Schema, authMethods map[string]struct{}) domain.FlowFieldChallenge {
	if isIdentifier(propSchema) {
		return domain.FlowFieldChallengeIdentifier
	}
	if _, ok := authMethods[name]; !ok {
		return domain.FlowFieldChallengeNone
	}
	switch name {
	case "password":
		return domain.FlowFieldChallengePassword
	case "passkey":
		return domain.FlowFieldChallengePasskey
	case "magic_link":
		return domain.FlowFieldChallengeMagicLink
	case "sso":
		return domain.FlowFieldChallengeSSO
	case "otp":
		return domain.FlowFieldChallengeOTP
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

// readAuthMethods returns the set of auth-method names whose
// `x-auth-methods.<name>.enabled` is true on the root schema.
func readAuthMethods(schema *jsonschema.Schema) map[string]struct{} {
	out := map[string]struct{}{}
	v, ok := schema.LookupKeyword("x-auth-methods")
	if !ok {
		return out
	}
	raw, ok := v.(types.PartAny)
	if !ok {
		return out
	}
	methods, ok := raw.V.(map[string]any)
	if !ok {
		return out
	}
	for name, raw := range methods {
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if enabled, _ := entry["enabled"].(bool); enabled {
			out[name] = struct{}{}
		}
	}
	return out
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

// lookupProperties returns the root schema's `properties` map. The
// second return is false when the schema has no `properties` keyword
// (callers treat that as "every field is unknown").
func lookupProperties(schema *jsonschema.Schema) (map[string]*jsonschema.Schema, bool) {
	v, ok := schema.LookupKeyword("properties")
	if !ok {
		return nil, false
	}
	m, ok := v.(types.PartMapSchema)
	if !ok {
		return nil, false
	}
	return map[string]*jsonschema.Schema(m), true
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
	v, ok := schema.LookupKeyword("x-identifier")
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
