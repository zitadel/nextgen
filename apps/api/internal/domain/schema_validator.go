package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/ianlancetaylor/jsonschema/types"
)

// Errors
var (
	ErrMissingBuiltinPublicBase    = errors.New("missing builtinPublicBase")
	ErrInvalidBuiltinPublicBase    = errors.New("invalid builtinPublicBase")
	ErrBuiltinTemplateRenderFailed = errors.New("failed to render builtin template")
	ErrMetaSchemaCompileFailed     = errors.New("failed to compile meta-schema")
	ErrMissingBuiltinMetaSchema    = errors.New("missing built-in meta-schema")
	ErrMetaSchemaRefNotFound       = errors.New("meta-schema $ref not found in builtins")
	ErrMaxResolveDepthReached      = errors.New("max resolve depth reached")
	ErrSchemaValidationFailed      = errors.New("schema validation failed")
	ErrSchemaParseFailed           = errors.New("schema parse failed")
	ErrMissingSchemaID             = errors.New("missing schema ID")
	ErrUnknownSchemaURI            = errors.New("unknown built-in schema URI")
	ErrUnknownSchemaKind           = errors.New("unknown schema kind")
)

type KnownSchemaKind string

const (
	SchemaKindUser           KnownSchemaKind = "user"
	SchemaKindFlowDefinition KnownSchemaKind = "flow-definition"
	SchemaKindIDPConnection  KnownSchemaKind = "idp-connection"
	SchemaKindApplication    KnownSchemaKind = "application"
)

// todo: handling multiple versions of the meta-schemas, e.g. "flow-definition-v1.2.3.json" or "flow-definition/1.2.3/schema.json"?
var schemaKindFilenames = map[KnownSchemaKind]string{
	SchemaKindUser:           "user-schema.json",
	SchemaKindFlowDefinition: "flow-definition.json",
	SchemaKindIDPConnection:  "idp-connection.json",
	SchemaKindApplication:    "application.json",
}

// SchemaValidator validates a tenant schema document against the
// server-owned meta-schema for its declared kind.
type SchemaValidator struct {
	// compiledSchemas holds all compiled meta-schemas keyed by their canonical URI.
	compiledSchemas map[string]*jsonschema.Schema
	// latestURIByKind maps a schema kind stem (e.g. "flow-definition") to the
	// canonical URI of its latest known version.
	latestSchemaURIByKind map[KnownSchemaKind]string
	// builtinBases names the meta-schemas under the canonical base and under
	// every other known base, so a document declaring its metaSchema under
	// another one still validates.
	builtinBases BuiltinSchemaBases
}

// NewSchemaValidator compiles the meta-schemas for the tenant schema kinds into memory and returns a SchemaValidator instance.
// The builtinPublicBase is used to construct canonical URLs for the built-in meta-schemas.
// It must be an absolute URL with a host (e.g. "https://raw.githubusercontent.com/zitadel/nextgen/refs/tags/v1.2.3/api/openapi/endpoints/schemas").
func NewSchemaValidator(builtinPublicBase string) (*SchemaValidator, error) {
	if builtinPublicBase == "" {
		return nil, ErrMissingBuiltinPublicBase
	}
	u, err := url.Parse(builtinPublicBase)
	if err != nil || !u.IsAbs() || u.Host == "" {
		return nil, fmt.Errorf("%w: %q must be an absolute URL with a host", ErrInvalidBuiltinPublicBase, builtinPublicBase)
	}
	builtinPublicBase = strings.TrimSuffix(builtinPublicBase, "/")

	// Render all embedded builtins into memory
	rendered := make(map[string][]byte)
	for name := range builtinSchemas {
		canonicalURL := builtinPublicBase + "/" + name
		var buf bytes.Buffer
		if err := WriteBuiltinJSONSchema(&buf, name, canonicalURL); err != nil {
			return nil, fmt.Errorf("%w for %q: %w", ErrBuiltinTemplateRenderFailed, name, err)
		}
		rendered[canonicalURL] = buf.Bytes()
	}

	// Compile and resolve the rendered schemas under its canonical URL
	compiledSchemas := make(map[string]*jsonschema.Schema)
	for uri := range rendered {
		schema, err := compileMetaSchema(uri, rendered)
		if err != nil {
			return nil, fmt.Errorf("%w for URI %q: %w", ErrMetaSchemaCompileFailed, uri, err)
		}
		compiledSchemas[uri] = schema
	}

	// Record the latest URI for each known kind stem.
	latestURIByKind := make(map[KnownSchemaKind]string, len(schemaKindFilenames))
	for kind, filename := range schemaKindFilenames {
		uri := builtinPublicBase + "/" + filename
		if _, ok := compiledSchemas[uri]; !ok {
			return nil, fmt.Errorf("%w: no compiled schema for kind %q at URI %q", ErrMissingBuiltinMetaSchema, kind, uri)
		}
		latestURIByKind[kind] = uri
	}

	return &SchemaValidator{
		compiledSchemas:       compiledSchemas,
		latestSchemaURIByKind: latestURIByKind,
		builtinBases:          BuiltinSchemaBasesFor(builtinPublicBase),
	}, nil
}

// ValidateAgainstMetaSchema validates the given tenant schema document against the appropriate meta-schema based on its declared "kind" property.
// At the moment, only "user-schema" and "flow-definition" are supported.
func (v *SchemaValidator) ValidateAgainstMetaSchema(schemaBs []byte) error {
	var schema map[string]any
	if err := json.Unmarshal(schemaBs, &schema); err != nil {
		return fmt.Errorf("%w: %w", ErrSchemaParseFailed, err)
	}

	schemaID, _ := schema["metaSchema"].(string)
	if schemaID == "" {
		return ErrMissingSchemaID
	}

	metaSchema, err := v.GetBuiltinSchema(schemaID)
	if err != nil {
		return err
	}

	if err := metaSchema.Validate(schema); err != nil {
		return fmt.Errorf("%w: %w", ErrSchemaValidationFailed, err)
	}

	// Designation rules cross-reference other parts of the document (property
	// existence, uniqueness scope, enabled auth methods), which the meta
	// JSON Schema cannot express — same pattern as flow-definition validation.
	if kind, _ := schema["kind"].(string); kind == SchemaDocumentKindUser {
		if err := validateUserSchemaDesignations(schema); err != nil {
			return err
		}
	}
	return nil
}

// GetBuiltinSchema returns a clone of the compiled meta-schema for the given kind.
// The returned schema has all $refs resolved.
//
// Example usage:
//
//	flowDefSchema, err := validator.GetBuiltinSchema(SchemaKindFlowDefinition)
//	if err != nil {
//		return err
//	}
//	if err := flowDefSchema.Validate(flowDefinition); err != nil {
//		return fmt.Errorf("flow definition invalid: %w", err)
//	}
//
// todo: support fetching compiled schema by version as well when multiple versions of the meta-schemas are available.
func (v *SchemaValidator) GetBuiltinSchema(uri string) (*jsonschema.Schema, error) {
	// The map is keyed by the canonical base, and Canonicalize maps every
	// spelling the resolver treats as a built-in (another base, another host
	// spelling) onto it, so the validator accepts the same URIs.
	compiledSchema, ok := v.compiledSchemas[v.builtinBases.Canonicalize(uri)]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownSchemaURI, uri)
	}
	return compiledSchema.Clone(), nil
}

// LatestSchemaURI returns the canonical URI of the latest registered version
// for the given kind stem (e.g. "flow-definition", "user-schema").
// This is useful for fetching the latest version of a schema when it's optional to provide a version.
func (v *SchemaValidator) LatestSchemaURI(kind KnownSchemaKind) (string, error) {
	uri, ok := v.latestSchemaURIByKind[kind]
	if !ok {
		return "", fmt.Errorf("%w: no latest URI for kind %q", ErrUnknownSchemaKind, kind)
	}
	return uri, nil
}

// FlattenValidationErrors collects meta-schema validation errors into
// a loc → msg map. loc segments are joined with "/" (e.g. "/required/x-auth-methods").
func FlattenValidationErrors(err error) map[string]string {
	out := make(map[string]string)
	for _, e := range ValidationFailures(err) {
		out[ValidationLocation(e)] = e.Msg
	}
	return out
}

// ValidationFailures returns the schema validation errors err wraps, through
// a [SchemaValidationCause] too.
func ValidationFailures(err error) []*types.ValidationError {
	if cause, ok := errors.AsType[*schemaValidationCause](err); ok {
		return cause.failures
	}
	if ves, ok := errors.AsType[*types.ValidationErrors](err); ok {
		return ves.Errs
	}
	if ve, ok := errors.AsType[*types.ValidationError](err); ok {
		return []*types.ValidationError{ve}
	}
	return nil
}

// SchemaValidationCause returns err as a cause safe to log: the validator's
// messages quote the rejected values, so its text names only where the
// failures are, by location and keyword, and [ValidationFailures] still finds
// them. An error that is not a validation error is returned as it is.
func SchemaValidationCause(err error) error {
	failures := ValidationFailures(err)
	if failures == nil {
		return err
	}
	return &schemaValidationCause{failures: failures}
}

type schemaValidationCause struct {
	failures []*types.ValidationError
}

func (c *schemaValidationCause) Error() string {
	locations := make([]string, len(c.failures))
	for i, ve := range c.failures {
		locations[i] = ValidationLocation(ve)
	}
	return "schema validation failed at " + strings.Join(locations, ", ")
}

// ValidationLocation formats the error location as a string.
// If the location is empty, it returns "/". Otherwise, it joins the segments with "/" and prefixes with "/".
func ValidationLocation(ve *types.ValidationError) string {
	if ve.Loc == nil || len(*ve.Loc) == 0 {
		return "/"
	}
	return "/" + strings.Join(*ve.Loc, "/")
}

// ValidationErrAttributeKey names the attribute a validation failure of doc is
// on, an array item by its index (phones.0.fax), which only a failure from
// [locateItemFailures] carries. complete reports that the location was walked
// to its end through objects alone: a failure inside an array item is named but
// not complete, as no flow field addresses an item.
func ValidationErrAttributeKey(ve *types.ValidationError, doc map[string]any) (key AttributeKey, complete bool) {
	if ve.Loc == nil {
		return "", true
	}
	var instance any = doc
	inItem := false
	for _, segment := range *ve.Loc {
		keyword, name, _ := strings.Cut(segment, "/")
		switch keyword {
		case "properties", "patternProperties", "additionalProperties", "unevaluatedProperties", "required":
			object, ok := instance.(map[string]any)
			if !ok {
				return key, false
			}
			key = key.AppendNode(name)
			instance = object[name]
		case "items", "prefixItems":
			array, ok := instance.([]any)
			index, err := strconv.Atoi(name)
			if !ok || err != nil || index < 0 || index >= len(array) {
				return key, false
			}
			key = key.AppendNode(name)
			instance = array[index]
			inItem = true
		case "allOf", "dependentSchemas", "dependencies":
			// Applied to the same instance.
		default:
			return key, false
		}
	}
	return key, !inItem
}

// locateItemFailures returns the failures of doc against schema with every
// failing array item named by its index, or failure itself if they cannot be
// told. The library stops at an array's first failing item and leaves the index
// out of the location, so this validates doc again with the array keywords
// checking every item. It changes schema, and only what its failures report:
// the wrapped keywords accept and refuse what the library's do.
func locateItemFailures(schema *jsonschema.Schema, doc map[string]any, failure error) error {
	reportEveryItem(schema, make(map[*jsonschema.Schema]bool))
	located := schema.Validate(doc)
	if !jsonschema.IsValidationError(located) {
		return failure
	}
	return located
}

// reportEveryItem wraps the array keywords of schema and of every schema it
// holds. It follows only the keywords the document spells: a resolved
// reference is a part the library adds, and its target may be a schema the
// library shares between requests, such as a json-schema.org metaschema, which
// is not this request's to change. A reference into the document's own $defs
// is still reached through $defs.
func reportEveryItem(schema *types.Schema, seen map[*types.Schema]bool) {
	if seen[schema] {
		return
	}
	seen[schema] = true
	for i := range schema.Parts {
		part := &schema.Parts[i]
		if part.Keyword.Generated {
			continue
		}
		switch value := part.Value.(type) {
		case types.PartSchema:
			if part.Keyword.Name == "items" {
				part.Keyword = keywordReportingEveryItem(part.Keyword)
			}
			reportEveryItem(value.S, seen)
		case types.PartSchemas:
			if part.Keyword.Name == "prefixItems" {
				part.Keyword = keywordReportingEveryItem(part.Keyword)
			}
			for _, sub := range value {
				reportEveryItem(sub, seen)
			}
		case types.PartMapSchema:
			for _, sub := range value {
				reportEveryItem(sub, seen)
			}
		case types.PartSchemaOrSchemas:
			if value.Schema != nil {
				reportEveryItem(value.Schema, seen)
			}
			for _, sub := range value.Schemas {
				reportEveryItem(sub, seen)
			}
		case types.PartMapArrayOrSchema:
			for _, sub := range value {
				if sub.Schema != nil {
					reportEveryItem(sub.Schema, seen)
				}
			}
		}
	}
}

// keywordReportingEveryItem returns keyword checking each item once, a failure
// located as keyword/index, and recording what the keyword leaves for
// unevaluatedItems. It replaces the library's check rather than following it:
// that one would walk the same wrapped items, doubling the work at each level
// of nesting.
func keywordReportingEveryItem(keyword *types.Keyword) *types.Keyword {
	wrapped := *keyword
	wrapped.Validate = func(arg types.PartValue, instance any, state *types.ValidationState) error {
		items, isArray := instance.([]any)
		if !isArray {
			return keyword.Validate(arg, instance, state)
		}
		// With no items to check, the library only records prefixItems' note.
		if err := keyword.Validate(arg, []any{}, state); err != nil {
			return err
		}
		var failures []*types.ValidationError
		for i, item := range items {
			schema := schemaOfItem(arg, state, i)
			if schema == nil {
				continue
			}
			if keyword.Name == "items" {
				state.Notes.Set("items", true)
			}
			err := schema.ValidateSubSchema(item, state)
			if err != nil && !types.IsValidationError(err) {
				return err
			}
			for _, failure := range ValidationFailures(err) {
				// ValidateSubSchema leaves no failure without a location.
				*failure.Loc = append([]string{keyword.Name + "/" + strconv.Itoa(i)}, *failure.Loc...)
				failures = append(failures, failure)
			}
		}
		if len(failures) == 0 {
			return nil
		}
		return &types.ValidationErrors{Errs: failures}
	}
	return &wrapped
}

// schemaOfItem returns the schema an array keyword's argument applies to item
// i, or nil for an item it leaves to another keyword: items starts where
// prefixItems ends.
func schemaOfItem(arg types.PartValue, state *types.ValidationState, i int) *types.Schema {
	switch value := arg.(type) {
	case types.PartSchema:
		if prefix, ok := state.Schema.LookupKeyword("prefixItems"); ok && i < len(prefix.(types.PartSchemas)) {
			return nil
		}
		return value.S
	case types.PartSchemas:
		if i < len(value) {
			return value[i]
		}
	}
	return nil
}

// compileMetaSchema compiles a meta-schema from a rendered JSON document.
func compileMetaSchema(metaURL string, rendered map[string][]byte) (*jsonschema.Schema, error) {
	cache := make(map[string]*jsonschema.Schema)
	loader := func(url string) ([]byte, error) {
		data, ok := rendered[url]
		if !ok {
			return nil, fmt.Errorf("%w: %q", ErrMetaSchemaRefNotFound, url)
		}
		return data, nil
	}
	data, ok := rendered[metaURL]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrMissingBuiltinMetaSchema, metaURL)
	}
	return compileSchema(metaURL, data, 0, DefaultMaxJSONSchemaResolveDepth, cache, loader)
}
