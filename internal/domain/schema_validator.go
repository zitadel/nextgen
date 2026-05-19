package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/ianlancetaylor/jsonschema"
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
	SchemaKindAuthMethod     KnownSchemaKind = "auth-method"
	SchemaKindUserProperty   KnownSchemaKind = "user-property"
	SchemaKindNestedProperty KnownSchemaKind = "nested-user-property"
)

var schemaKindPathMap = map[KnownSchemaKind]string{
	SchemaKindUser:           "user-schema.json",
	SchemaKindAuthMethod:     "auth-method.json",
	SchemaKindUserProperty:   "user-property.json",
	SchemaKindNestedProperty: "nested-user-property.json",
}

// TenantSchemaValidator validates a tenant schema document against the
// server-owned meta-schema for its declared kind.
type TenantSchemaValidator struct {
	metaSchemas map[KnownSchemaKind]*jsonschema.Schema
}

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
		if err := writeBuiltinJSONSchema(&buf, name, canonicalURL); err != nil {
			return nil, fmt.Errorf("%w for %q: %w", ErrBuiltinTemplateRenderFailed, name, err)
		}
		rendered[canonicalURL] = buf.Bytes()
	}

	// Compile and resolve the root meta-schemas
	metaSchemas := make(map[KnownSchemaKind]*jsonschema.Schema)
	for kind, path := range schemaKindPathMap {
		metaURL := builtinPublicBase + "/" + path
		metaSchema, err := compileMetaSchema(metaURL, rendered, DefaultMaxJSONSchemaResolveDepth)
		if err != nil {
			return nil, fmt.Errorf("%w for kind %q (URL %q): %w", ErrMetaSchemaCompileFailed, kind, metaURL, err)
		}
		metaSchemas[kind] = metaSchema
	}

	return &TenantSchemaValidator{
		metaSchemas: metaSchemas,
	}, nil
}

// ValidateAgainstMetaSchema safely checks byte payloads entirely in memory.
func (v *TenantSchemaValidator) ValidateAgainstMetaSchema(tenantSchemaBytes []byte) error {
	kind, err := kindFromSchema(tenantSchemaBytes)
	if err != nil {
		return err
	}

	metaSchema, ok := v.metaSchemas[KnownSchemaKind(kind)]
	if !ok {
		return fmt.Errorf("%w: %q", ErrUnknownSchemaKind, kind)
	}

	var tenantSchema any
	if err := json.Unmarshal(tenantSchemaBytes, &tenantSchema); err != nil {
		return fmt.Errorf("%w: %w", ErrSchemaParseFailed, err)
	}

	if err := metaSchema.Validate(tenantSchema); err != nil {
		return fmt.Errorf("%w: %w", ErrSchemaValidationFailed, err)
	}
	return nil
}

func kindFromSchema(b []byte) (string, error) {
	var top struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(b, &top); err != nil {
		return "", fmt.Errorf("%w: %w", ErrSchemaParseFailed, err)
	}
	if top.Kind == "" {
		return "", ErrMissingSchemaKind
	}
	return top.Kind, nil
}

// todo (grvijayan): Refactor; the recursive resolution is kinda duplicated from JSONSchemaResolver.Resolve to avoid circular dependency between resolver and validator.
func compileMetaSchema(metaURL string, rendered map[string][]byte, maxDepth int) (*jsonschema.Schema, error) {
	cache := make(map[string]*jsonschema.Schema)
	var resolve func(schemaURL string, data []byte, depth int) (*jsonschema.Schema, error)
	resolve = func(schemaURL string, data []byte, depth int) (*jsonschema.Schema, error) {
		if depth > maxDepth {
			return nil, ErrMaxResolveDepthReached
		}
		if s, ok := cache[schemaURL]; ok {
			return s, nil
		}
		schema, err := unmarshalJSONSchema(schemaURL, data)
		if err != nil {
			return nil, err
		}
		cache[schemaURL] = schema
		err = schema.Resolve(&jsonschema.ResolveOpts{
			Loader: func(schemaID string, uri *url.URL) (*jsonschema.Schema, error) {
				refURL := uri.String()
				if s, ok := cache[refURL]; ok {
					return s, nil
				}
				refData, ok := rendered[refURL]
				if !ok {
					return nil, fmt.Errorf("%w: %q", ErrMetaSchemaRefNotFound, refURL)
				}
				return resolve(refURL, refData, depth+1)
			},
		})
		if err != nil {
			return nil, err
		}
		return schema, nil
	}

	data, ok := rendered[metaURL]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrMissingBuiltinMetaSchema, metaURL)
	}
	return resolve(metaURL, data, 0)
}
