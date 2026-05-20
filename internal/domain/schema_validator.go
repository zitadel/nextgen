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
	ErrMissingSchemaKind           = errors.New("missing schema kind")
	ErrUnknownSchemaKind           = errors.New("unknown schema kind")
)

type KnownSchemaKind string

const (
	SchemaKindUser           KnownSchemaKind = "user-schema"
	SchemaKindFlowDefinition KnownSchemaKind = "flow-definition"
)

var schemaKindPathMap = map[KnownSchemaKind]string{
	SchemaKindUser:           "user-schema.json",
	SchemaKindFlowDefinition: "flow-definition.json",
}

// TenantSchemaValidator validates a tenant schema document against the
// server-owned meta-schema for its declared kind.
type TenantSchemaValidator struct {
	metaSchemas map[KnownSchemaKind]*jsonschema.Schema
}

// NewTenantSchemaValidator compiles the meta-schemas for the tenant schema kinds into memory and returns a TenantSchemaValidator instance.
// The builtinPublicBase is used to construct canonical URLs for the built-in meta-schemas.
// It must be an absolute URL with a host (e.g. "https://raw.githubusercontent.com/zitadel/nextgen/refs/tags/v1.2.3/api/openapi/endpoints/schemas").
func NewTenantSchemaValidator(builtinPublicBase string) (*TenantSchemaValidator, error) {
	if builtinPublicBase == "" {
		return nil, ErrMissingBuiltinPublicBase
	}
	u, err := url.Parse(builtinPublicBase)
	if err != nil || !u.IsAbs() || u.Host == "" {
		return nil, fmt.Errorf("%w: %q must be an absolute URL with a host", ErrInvalidBuiltinPublicBase, builtinPublicBase)
	}
	builtinPublicBase = strings.TrimSuffix(builtinPublicBase, "/")

	// Render meta-schema builtins into memory
	rendered := make(map[string][]byte)
	for name := range builtinSchemas {
		canonicalURL := builtinPublicBase + "/" + name
		var buf bytes.Buffer
		if err := WriteBuiltinJSONSchema(&buf, name, canonicalURL); err != nil {
			return nil, fmt.Errorf("%w for %q: %w", ErrBuiltinTemplateRenderFailed, name, err)
		}
		rendered[canonicalURL] = buf.Bytes()
	}

	// Compile and resolve the root meta-schemas
	metaSchemas := make(map[KnownSchemaKind]*jsonschema.Schema)
	for kind, path := range schemaKindPathMap {
		metaURL := builtinPublicBase + "/" + path
		metaSchema, err := compileMetaSchema(metaURL, rendered)
		if err != nil {
			return nil, fmt.Errorf("%w for kind %q (URL %q): %w", ErrMetaSchemaCompileFailed, kind, metaURL, err)
		}
		metaSchemas[kind] = metaSchema
	}

	return &TenantSchemaValidator{
		metaSchemas: metaSchemas,
	}, nil
}

// ValidateAgainstMetaSchema validates the given tenant schema document against the appropriate meta-schema based on its declared "kind" property.
// At the moment, only "user-schema" and "flow-definition" are supported.
func (v *TenantSchemaValidator) ValidateAgainstMetaSchema(tenantSchemaBytes []byte) error {
	var tenantSchema map[string]any
	if err := json.Unmarshal(tenantSchemaBytes, &tenantSchema); err != nil {
		return fmt.Errorf("%w: %w", ErrSchemaParseFailed, err)
	}

	kindVal, _ := tenantSchema["kind"].(string)
	if kindVal == "" {
		return ErrMissingSchemaKind
	}

	metaSchema, ok := v.metaSchemas[KnownSchemaKind(kindVal)]
	if !ok {
		return fmt.Errorf("%w: %q", ErrUnknownSchemaKind, kindVal)
	}

	if err := metaSchema.Validate(tenantSchema); err != nil {
		return fmt.Errorf("%w: %w", ErrSchemaValidationFailed, err)
	}
	return nil
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
