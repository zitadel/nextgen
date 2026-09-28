package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
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
)

// todo: handling multiple versions of the meta-schemas, e.g. "flow-definition-v1.2.3.json" or "flow-definition/1.2.3/schema.json"?
var schemaKindFilenames = map[KnownSchemaKind]string{
	SchemaKindUser:           "user-schema.json",
	SchemaKindFlowDefinition: "flow-definition.json",
}

// SchemaValidator validates a tenant schema document against the
// server-owned meta-schema for its declared kind.
type SchemaValidator struct {
	// compiledSchemas holds all compiled meta-schemas keyed by their canonical URI.
	compiledSchemas map[string]*jsonschema.Schema
	// latestURIByKind maps a schema kind stem (e.g. "flow-definition") to the
	// canonical URI of its latest known version.
	latestSchemaURIByKind map[KnownSchemaKind]string
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
	compiledSchema, ok := v.compiledSchemas[uri]
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
	var ves *types.ValidationErrors
	var ve *types.ValidationError
	switch {
	case errors.As(err, &ves):
		for _, e := range ves.Errs {
			out[validationLocString(e)] = e.Msg
		}
	case errors.As(err, &ve):
		out[validationLocString(ve)] = ve.Msg
	}
	return out
}

// validationLocString formats the error location as a string.
// If the location is empty, it returns "/". Otherwise, it joins the segments with "/" and prefixes with "/".
func validationLocString(ve *types.ValidationError) string {
	if ve.Loc == nil || len(*ve.Loc) == 0 {
		return "/"
	}
	return "/" + strings.Join(*ve.Loc, "/")
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
