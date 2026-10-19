package domain

import (
	"context"
	"errors"
	"strings"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// LegacyBuiltinSchemaBases are the bases the built-in schemas were published
// under before the current default. Documents written back then still name
// them: stored schema rows and the users that reference them, committed
// `.zitadel/schemas` files, bootstrap user documents. A path under one of
// them therefore names the same built-in as under the configured base.
//
// They are identifiers, never addresses: nothing under them is fetched, and
// https://nextgen.com is not a Zitadel domain.
var LegacyBuiltinSchemaBases = []string{"https://nextgen.com/api/schemas"}

// BuiltinSchemaBases is the URL namespace of the product's built-in schemas:
// the canonical base new documents are minted under, and the legacy bases
// that older documents still name.
type BuiltinSchemaBases struct {
	canonical string
	legacy    []string
}

// NewBuiltinSchemaBases returns the namespace rooted at canonical, aliased by
// legacy. Trailing slashes are trimmed, and a legacy base equal to the
// canonical one is dropped. An empty canonical base disables the namespace:
// no URL is under it, the legacy bases included.
func NewBuiltinSchemaBases(canonical string, legacy ...string) BuiltinSchemaBases {
	canonical = strings.TrimSuffix(canonical, "/")
	if canonical == "" {
		return BuiltinSchemaBases{}
	}
	seen := map[string]bool{canonical: true}
	var aliases []string
	for _, base := range legacy {
		base = strings.TrimSuffix(base, "/")
		if base == "" || seen[base] {
			continue
		}
		seen[base] = true
		aliases = append(aliases, base)
	}
	return BuiltinSchemaBases{canonical: canonical, legacy: aliases}
}

// Canonical returns the base new documents are minted under, or "" when the
// namespace is disabled.
func (b BuiltinSchemaBases) Canonical() string {
	return b.canonical
}

// RelPath reports whether schemaURL lies under one of the bases and returns
// the path after it, without a leading slash.
func (b BuiltinSchemaBases) RelPath(schemaURL string) (string, bool) {
	for _, base := range b.bases() {
		if rel, ok := builtinSchemaURLPathAfterBase(base, schemaURL); ok {
			return rel, true
		}
	}
	return "", false
}

// Canonicalize returns schemaURL with a legacy base replaced by the canonical
// one. Any other URL is returned unchanged.
func (b BuiltinSchemaBases) Canonicalize(schemaURL string) string {
	for _, base := range b.legacy {
		if rel, ok := builtinSchemaURLPathAfterBase(base, schemaURL); ok && rel != "" {
			return b.canonical + "/" + rel
		}
	}
	return schemaURL
}

// Equivalents returns schemaURL followed by the same path under every other
// base, canonical first. A URL under none of them has no equivalents.
func (b BuiltinSchemaBases) Equivalents(schemaURL string) []string {
	rel, ok := b.RelPath(schemaURL)
	if !ok || rel == "" {
		return []string{schemaURL}
	}
	out := []string{schemaURL}
	for _, base := range b.bases() {
		if candidate := base + "/" + rel; candidate != schemaURL {
			out = append(out, candidate)
		}
	}
	return out
}

// JSONSchemaGetter reads one of a project's schemas by URL or minted id.
type JSONSchemaGetter interface {
	GetJSONSchemaByID(ctx context.Context, projectID, schemaID string) (*JSONSchema, error)
}

// GetJSONSchema reads a project's schema by URL: the row stored under
// schemaURL, else, for a URL in the built-in namespace, the row stored under
// the same path beneath another base. A project seeded under a legacy base
// keeps its rows there, while a document naming a legacy base can meet a
// project seeded under the canonical one.
//
// A caller that stores a reference to the schema must store the returned
// row's URL, not schemaURL: that is the row a foreign key can point at.
func (b BuiltinSchemaBases) GetJSONSchema(ctx context.Context, store JSONSchemaGetter, projectID, schemaURL string) (*JSONSchema, error) {
	var firstErr error
	for i, candidate := range b.Equivalents(schemaURL) {
		schema, err := store.GetJSONSchemaByID(ctx, projectID, candidate)
		if err == nil {
			return schema, nil
		}
		var noRowFoundError *database.NoRowFoundError
		if !errors.As(err, &noRowFoundError) {
			return nil, err
		}
		if i == 0 {
			firstErr = err
		}
	}
	return nil, firstErr
}

// WithBuiltinSchemaAliases wraps store so that GetJSONSchemaByID follows
// [BuiltinSchemaBases.GetJSONSchema].
func WithBuiltinSchemaAliases(store JSONSchemaStore, bases BuiltinSchemaBases) JSONSchemaStore {
	return builtinAliasingStore{JSONSchemaStore: store, bases: bases}
}

type builtinAliasingStore struct {
	JSONSchemaStore
	bases BuiltinSchemaBases
}

func (s builtinAliasingStore) GetJSONSchemaByID(ctx context.Context, projectID, schemaID string) (*JSONSchema, error) {
	return s.bases.GetJSONSchema(ctx, s.JSONSchemaStore, projectID, schemaID)
}

func (b BuiltinSchemaBases) bases() []string {
	if b.canonical == "" {
		return nil
	}
	return append([]string{b.canonical}, b.legacy...)
}
