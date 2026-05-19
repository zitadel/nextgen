package domain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/httputil"
	"github.com/zitadel/nextgen/internal/storage/database"
)

var absoluteScheme = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+\-.]*:`)

// JSONSchema represent a JSON schema which can be used to validate JSON data.
type JSONSchema struct {
	ProjectID string
	URL       string
	CreatedAt time.Time
	Schema    []byte
}

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/json_schema.mock.go . JSONSchemaRepository

// JSONSchemaRepository is the repository for JSON schemas.
// Because schema validation happens on data writes in domain logic,
// schemas are immutable. They can only be created and deleted (if no data references them).
// Schemas can use versioned URLs to support multiple versions of the same schema.
type JSONSchemaRepository interface {
	Repository

	jsonSchemaColumns
	jsonSchemaConditions

	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*JSONSchema, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*JSONSchema, error)
	Create(ctx context.Context, client database.QueryExecutor, schema *JSONSchema) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type jsonSchemaColumns interface {
	ProjectID() database.Column
	URL() database.Column
	CreatedAt() database.Column
	Payload() database.Column
}

type jsonSchemaConditions interface {
	PrimaryKeyCondition(projectID, url string) database.Condition
	ProjectIDCondition(projectID string) database.Condition
	URLCondition(url string) database.Condition
}

const (
	DefaultMaxJSONSchemaResolveDepth = 10
	DefaultMaxJSONSchemaSize         = 1 << 20 // 1 MB

	// jsonSchemaResolverCacheKeySep separates project ID and schema URL in [JSONSchemaResolverCacheKey].
	// Project IDs must not contain this rune (true for typical IDs).
	jsonSchemaResolverCacheKeySep = "\x00"
)

// builtinSchemas maps relative schema filename (e.g. "user-schema.json") to raw JSON bytes.
var builtinSchemas map[string][]byte

func init() {
	m := make(map[string][]byte)
	entries, err := fs.ReadDir(apischemas.FS, ".")
	if err != nil {
		panic(fmt.Sprintf("domain: read builtin schemas: %v", err))
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := apischemas.FS.ReadFile(e.Name())
		if err != nil {
			panic(fmt.Sprintf("domain: read builtin schema %q: %v", e.Name(), err))
		}
		m[e.Name()] = raw
	}
	if len(m) == 0 {
		panic("domain: no builtin JSON schemas found")
	}
	builtinSchemas = m
}

// jsonSchemaResolverCacheKey is the string used as an LRU key for a resolved schema for this project and URL.
func jsonSchemaResolverCacheKey(projectID, schemaURL string) string {
	return projectID + jsonSchemaResolverCacheKeySep + schemaURL
}

// JSONSchemaResolver retrieves JSON schemas by their URL recursively,
// starting from the given schema URL and following all references in the schema.
// It caches resolved schemas in memory and uses a repository to store them for future use.
type JSONSchemaResolver struct {
	repository JSONSchemaRepository
	// cache of fully resolved JSON schemas,
	// keyed by projectID and schemaURL
	cache           *lru.TwoQueueCache[string, *jsonschema.Schema]
	maxResolveDepth int
	maxSize         int
	httpClient      *http.Client
	// builtinPublicBase is the absolute URL prefix for product-built-in schemas (no trailing slash).
	// When empty, builtin embedded schemas are disabled and resolution uses only the repository / HTTP ingest.
	builtinPublicBase string
}

// NewJSONSchemaResolver wires a resolver with shared repository, LRU cache, resolve limits,
// an optional HTTP client for ingestion, and an optional builtinPublicBase URL.
// When builtinPublicBase is non-nil, schema URLs under that prefix are loaded from embedded templates
// instead of the database; they are not persisted via [JSONSchemaRepository.Create].
func NewJSONSchemaResolver(
	repository JSONSchemaRepository,
	cache *lru.TwoQueueCache[string, *jsonschema.Schema],
	maxResolveDepth int,
	maxSize int,
	httpClient *http.Client,
	builtinPublicBase *url.URL,
) *JSONSchemaResolver {
	if cache == nil {
		panic("cache is required")
	}
	if maxResolveDepth == 0 {
		maxResolveDepth = DefaultMaxJSONSchemaResolveDepth
	}
	if maxSize == 0 {
		maxSize = DefaultMaxJSONSchemaSize
	}
	var base string
	if builtinPublicBase != nil {
		base = strings.TrimSuffix(builtinPublicBase.String(), "/")
	}
	return &JSONSchemaResolver{
		repository:        repository,
		cache:             cache,
		maxResolveDepth:   maxResolveDepth,
		maxSize:           maxSize,
		httpClient:        httpClient,
		builtinPublicBase: base,
	}
}

// Resolve retrieves a JSON schema by its URL recursively,
// starting from the given schema URL and following all references in the schema.
// It first tries to find the fully resolved schema in the cache.
// If not found in the cache, it looks for the schema and all its references by URL from the database.
// When the resolver has an HTTP client, it can fetch a missing schema from its URL and persist it.
func (r *JSONSchemaResolver) Resolve(
	ctx context.Context,
	client database.QueryExecutor,
	projectID string,
	schemaURL string,
	rootSchema []byte,
) (*jsonschema.Schema, error) {
	cacheKey := jsonSchemaResolverCacheKey(projectID, schemaURL)
	if schema, ok := r.cache.Get(cacheKey); ok {
		return schema, nil
	}
	schema, err := r.resolveRecursively(ctx, client, projectID, schemaURL, 0, rootSchema, nil)
	if err != nil {
		return nil, err
	}
	r.cache.Add(cacheKey, schema)
	return schema, nil
}

func (r *JSONSchemaResolver) resolveRecursively(
	ctx context.Context,
	client database.QueryExecutor,
	projectID string,
	schemaURL string,
	depth int,
	schemaData []byte,
	cache map[string]*jsonschema.Schema,
) (*jsonschema.Schema, error) {
	// this cache is used for resolved schemas during recursive resolution;
	// if a schema is referenced again or self-referenced,
	// the already-resolved schema is returned, preventing infinite recursion.
	if cache == nil {
		cache = make(map[string]*jsonschema.Schema)
	}
	loader := func(url string) ([]byte, error) {
		return r.loadSchemaPayload(ctx, client, projectID, url)
	}
	return compileSchema(schemaURL, schemaData, depth, r.maxResolveDepth, cache, loader)
}

func (r *JSONSchemaResolver) loadSchemaPayload(ctx context.Context, client database.QueryExecutor, projectID, schemaURL string) ([]byte, error) {
	if r.builtinPublicBase != "" {
		relPath, ok := builtinSchemaURLPathAfterBase(r.builtinPublicBase, schemaURL)
		if ok {
			return loadBuiltinSchemaBytes(relPath, schemaURL)
		}
	}
	return r.getFromDatabase(ctx, client, projectID, schemaURL)
}

// builtinSchemaURLPathAfterBase reports whether schemaURL is under base and returns the path
// after base (no leading slash), which matches the embed path under schema/ (for example
// base https://iam.example.com/schema and schemaURL …/schema/user/v1/user.schema.json -> user/v1/user.schema.json).
func builtinSchemaURLPathAfterBase(base, schemaURL string) (relPath string, underBase bool) {
	if schemaURL == base {
		return "", true
	}
	prefix := base + "/"
	if !strings.HasPrefix(schemaURL, prefix) {
		return "", false
	}
	return strings.TrimPrefix(schemaURL, prefix), true
}

func loadBuiltinSchemaBytes(relPath, canonicalSchemaURL string) ([]byte, error) {
	var buf bytes.Buffer
	if err := WriteBuiltinJSONSchema(&buf, relPath, canonicalSchemaURL); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// WriteBuiltinJSONSchema renders a built-in JSON schema to w.
// schemaPath is the URL path after the configured public base, including the .json filename
// (for example user/v1/user.schema.json for URL https://iam.example.com/schema/user/v1/user.schema.json
// when the public base is https://iam.example.com/schema).
// canonicalDocumentURL must be the absolute schema URL used as JSON Schema $id and for resolution
// (typically the request URL used to serve this document).
func WriteBuiltinJSONSchema(w io.Writer, schemaPath string, canonicalDocumentURL string) error {
	raw, ok := builtinSchemas[schemaPath]
	if !ok {
		return fmt.Errorf("unknown builtin JSON schema path %q", schemaPath)
	}

	base, err := url.Parse(canonicalDocumentURL)
	if err != nil {
		return fmt.Errorf("invalid canonicalDocumentURL %q: %w", canonicalDocumentURL, err)
	}
	if !base.IsAbs() {
		return fmt.Errorf("canonicalDocumentURL %q must be absolute", canonicalDocumentURL)
	}

	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("parse builtin schema %q: %w", schemaPath, err)
	}
	doc["$id"] = canonicalDocumentURL

	resolved, err := resolveRefs(doc, base)
	if err != nil {
		return err
	}
	return json.NewEncoder(w).Encode(resolved)
}

func isRelativeRef(ref string) bool {
	// Leave JSON Pointer anchors (#/...) and absolute URIs alone
	if len(ref) == 0 || ref[0] == '#' {
		return false
	}
	return !absoluteScheme.MatchString(ref)
}

// resolveRefs walks a parsed JSON document and rewrites relative $ref values
// (e.g. "auth-method.json") to absolute URLs using baseURL as the prefix.
func resolveRefs(node any, base *url.URL) (any, error) {
	var walk func(any) (any, error)
	walk = func(node any) (any, error) {
		switch v := node.(type) {
		case map[string]any:
			out := make(map[string]any, len(v))
			for key, val := range v {
				if key == "$ref" {
					if ref, ok := val.(string); ok && isRelativeRef(ref) {
						resolved, err := base.Parse(ref)
						if err != nil {
							return nil, fmt.Errorf("resolve $ref %q: %w", ref, err)
						}
						out[key] = resolved.String()
						continue
					}
				}
				walked, err := walk(val)
				if err != nil {
					return nil, err
				}
				out[key] = walked
			}
			return out, nil
		case []any:
			out := make([]any, len(v))
			for i, item := range v {
				walked, err := walk(item)
				if err != nil {
					return nil, err
				}
				out[i] = walked
			}
			return out, nil
		default:
			return v, nil
		}
	}
	return walk(node)
}

func (r *JSONSchemaResolver) getFromDatabase(ctx context.Context, client database.QueryExecutor, projectID, schemaURL string) ([]byte, error) {
	dbSchema, err := r.repository.Get(ctx, client, database.WithCondition(
		r.repository.PrimaryKeyCondition(projectID, schemaURL),
	))
	if err == nil {
		return dbSchema.Schema, nil
	}
	var noRowFoundError *database.NoRowFoundError
	if !errors.As(err, &noRowFoundError) {
		return nil, err
	}
	if r.httpClient == nil {
		return nil, fmt.Errorf("schema not found in database: %w", err)
	}

	data, err := r.resolveFromURL(ctx, schemaURL)
	if err != nil {
		return nil, err
	}
	dbSchema = &JSONSchema{
		ProjectID: projectID,
		URL:       schemaURL,
		Schema:    data,
	}
	if err := r.repository.Create(ctx, client, dbSchema); err != nil {
		return nil, err
	}
	return data, nil
}

func (r *JSONSchemaResolver) resolveFromURL(ctx context.Context, url string) ([]byte, error) {
	data, err := httputil.Get(ctx, url, r.httpClient, "application/json")
	if err != nil {
		return nil, err
	}
	return data, nil
}

func unmarshalJSONSchema(schemaURL string, data []byte) (*jsonschema.Schema, error) {
	var dst any
	if err := json.Unmarshal(data, &dst); err != nil {
		return nil, err
	}
	return jsonschema.SchemaFromJSON(schemaURL, nil, dst)
}

// compileSchema recursively compiles a JSON schema from schemaURL using loader to fetch bytes
// for any $ref targets. cache prevents infinite recursion and duplicate compilation.
func compileSchema(
	schemaURL string,
	schemaData []byte,
	depth, maxDepth int,
	cache map[string]*jsonschema.Schema,
	loader func(url string) ([]byte, error),
) (*jsonschema.Schema, error) {
	if depth > maxDepth {
		return nil, ErrMaxResolveDepthReached
	}
	if s, ok := cache[schemaURL]; ok {
		return s, nil
	}
	if len(schemaData) == 0 {
		var err error
		schemaData, err = loader(schemaURL)
		if err != nil {
			return nil, err
		}
	}
	schema, err := unmarshalJSONSchema(schemaURL, schemaData)
	if err != nil {
		return nil, err
	}
	cache[schemaURL] = schema
	err = schema.Resolve(&jsonschema.ResolveOpts{
		Loader: func(_ string, uri *url.URL) (*jsonschema.Schema, error) {
			return compileSchema(uri.String(), nil, depth+1, maxDepth, cache, loader)
		},
	})
	if err != nil {
		return nil, err
	}
	return schema, nil
}
