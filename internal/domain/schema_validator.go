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
	SchemaKindUser:           "meta/user-schema.json",
	SchemaKindAuthMethod:     "meta/auth-method.json",
	SchemaKindUserProperty:   "meta/user-property.json",
	SchemaKindNestedProperty: "meta/nested-user-property.json",
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

	// Render meta-schema builtin templates into memory
	rendered := make(map[string][]byte)
	for path := range builtinTemplates {
		canonicalURL := builtinPublicBase + "/" + path
		var buf bytes.Buffer
		if err := writeBuiltinJSONSchema(&buf, path, canonicalURL); err != nil {
			return nil, fmt.Errorf("%w for %q: %w", ErrBuiltinTemplateRenderFailed, path, err)
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
	kind, err := kindFromSchemaBytes(tenantSchemaBytes)
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

func kindFromSchemaBytes(b []byte) (string, error) {
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
	data, ok := rendered[metaURL]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrMissingBuiltinMetaSchema, metaURL)
	}
	loader := func(url string) ([]byte, error) {
		b, ok := rendered[url]
		if !ok {
			return nil, fmt.Errorf("%w: %q", ErrMetaSchemaRefNotFound, url)
		}
		return b, nil
	}
	return resolveSchema(metaURL, data, 0, maxDepth, loader)
}

// resolveSchema parses and recursively resolves $refs in a JSON schema,
// using loader to fetch bytes for each referenced URL.
func resolveSchema(schemaURL string, data []byte, depth, maxDepth int, loader func(url string) ([]byte, error)) (*jsonschema.Schema, error) {
	if depth > maxDepth {
		return nil, ErrMaxResolveDepthReached
	}
	schema, err := unmarshalJSONSchema(schemaURL, data)
	if err != nil {
		return nil, err
	}
	return schema, schema.Resolve(&jsonschema.ResolveOpts{
		Loader: func(schemaID string, uri *url.URL) (*jsonschema.Schema, error) {
			refData, err := loader(uri.String())
			if err != nil {
				return nil, err
			}
			return resolveSchema(uri.String(), refData, depth+1, maxDepth, loader)
		},
	})
}
