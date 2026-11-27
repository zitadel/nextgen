package domain

import (
	"context"
	"errors"
	"net"
	"net/url"
	"strings"

	"github.com/zitadel/nextgen/internal/storage/database"
	configdefaults "github.com/zitadel/nextgen/packages/config/defaults"
)

// KnownBuiltinSchemaBases are the bases the built-in schemas have been
// published under, newest first. Documents name whichever base was current
// when they were written: stored schema rows and the users that reference
// them, committed `.zitadel/schemas` files, bootstrap user documents. A path
// under any of them names the same built-in, so a server configured with one
// base aliases the others, in both directions.
//
// They are identifiers, never addresses: nothing under them is fetched, and
// https://nextgen.com is not a Zitadel domain.
var KnownBuiltinSchemaBases = []string{
	configdefaults.DefaultBuiltinSchemaBase,
	"https://nextgen.com/api/schemas",
}

// BuiltinSchemaBases is the URL namespace of the product's built-in schemas:
// the canonical base new documents are minted under, and the other bases
// documents may still name.
type BuiltinSchemaBases struct {
	canonical string
	legacy    []string
}

// BuiltinSchemaBasesFor returns the namespace a server configured with
// publicBase serves: that base, aliased by every other
// [KnownBuiltinSchemaBases] entry. Every component that reads schemas by URL
// builds its namespace through this function, so they agree on which URLs
// are equivalent.
func BuiltinSchemaBasesFor(publicBase string) BuiltinSchemaBases {
	return NewBuiltinSchemaBases(publicBase, KnownBuiltinSchemaBases...)
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
// the path after it, without a leading slash. The origin is compared as a
// browser would (host case, a default port and a trailing dot do not
// matter); the path is compared byte for byte.
func (b BuiltinSchemaBases) RelPath(schemaURL string) (string, bool) {
	for _, base := range b.bases() {
		if rel, ok := builtinSchemaURLPathAfterBase(base, schemaURL); ok {
			return rel, true
		}
	}
	return "", false
}

// Canonicalize returns schemaURL spelled under the canonical base: a URL that
// [BuiltinSchemaBases.RelPath] places under any of the bases, in any spelling
// of its origin, maps to the same path under the canonical one. Any other URL
// is returned unchanged.
func (b BuiltinSchemaBases) Canonicalize(schemaURL string) string {
	if rel, ok := b.RelPath(schemaURL); ok && rel != "" {
		return b.canonical + "/" + rel
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
// the same path beneath another base. A project seeded under one base keeps
// its rows there, while a document naming another base can meet it.
//
// A caller that stores a reference to the schema must store the returned
// row's URL, not schemaURL: that is the row a foreign key can point at.
func (b BuiltinSchemaBases) GetJSONSchema(ctx context.Context, store JSONSchemaGetter, projectID, schemaURL string) (*JSONSchema, error) {
	var err error
	for _, candidate := range b.Equivalents(schemaURL) {
		var schema *JSONSchema
		schema, err = store.GetJSONSchemaByID(ctx, projectID, candidate)
		if err == nil {
			return schema, nil
		}
		if _, missing := errors.AsType[*database.NoRowFoundError](err); !missing {
			return nil, err
		}
	}
	return nil, err
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

// builtinSchemaURLPathAfterBase reports whether schemaURL is under base and
// returns the path after base (no leading slash), which matches the embed
// path under schema/ (for example base https://iam.example.com/schema and
// schemaURL …/schema/user/v1/user.schema.json -> user/v1/user.schema.json).
//
// The two origins are compared the way a browser reads them: the scheme and
// host case-insensitively, without a default port or a trailing dot on the
// host. The rest of the URL is compared byte for byte, so a query, a fragment
// or an odd percent-encoding keeps a URL from naming an embedded document.
func builtinSchemaURLPathAfterBase(base, schemaURL string) (relPath string, underBase bool) {
	baseOrigin, basePath, ok := splitSchemaURLOrigin(base)
	if !ok {
		return pathAfterPrefix(base, schemaURL)
	}
	urlOrigin, urlPath, ok := splitSchemaURLOrigin(schemaURL)
	if !ok || urlOrigin != baseOrigin {
		return "", false
	}
	return pathAfterPrefix(basePath, urlPath)
}

func pathAfterPrefix(prefix, s string) (string, bool) {
	if s == prefix {
		return "", true
	}
	if !strings.HasPrefix(s, prefix+"/") {
		return "", false
	}
	return strings.TrimPrefix(s, prefix+"/"), true
}

// splitSchemaURLOrigin splits raw into its normalized origin (lower-case
// scheme and host, no default port, no trailing dot) and the rest of the
// string as written. It reports false for anything that is not an absolute
// http(s) URL with a host and no userinfo, such as a minted sch_ id.
func splitSchemaURLOrigin(raw string) (origin, rest string, ok bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil {
		return "", "", false
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "https" && scheme != "http" {
		return "", "", false
	}
	// url.Parse keeps the host as written, so the raw string starts with the
	// scheme (in any case), "://" and that host.
	head := len(u.Scheme) + len("://")
	if len(raw) < head+len(u.Host) || !strings.EqualFold(raw[:head], u.Scheme+"://") || raw[head:head+len(u.Host)] != u.Host {
		return "", "", false
	}
	return scheme + "://" + normalizeSchemaURLHost(u.Host, scheme), raw[head+len(u.Host):], true
}

func normalizeSchemaURLHost(host, scheme string) string {
	hostname, port, err := net.SplitHostPort(host)
	if err != nil {
		// No port: an IPv6 literal still carries its brackets here.
		hostname, port = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]"), ""
	}
	hostname = strings.ToLower(strings.TrimSuffix(hostname, "."))
	if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
		port = ""
	}
	if strings.Contains(hostname, ":") {
		hostname = "[" + hostname + "]"
	}
	if port == "" {
		return hostname
	}
	return hostname + ":" + port
}
