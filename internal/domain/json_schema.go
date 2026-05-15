package domain

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"strings"
	"text/template"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/internal/httputil"
	"github.com/zitadel/nextgen/internal/storage/database"
)

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

type SchemaValidator interface {
	ValidateAgainstMetaSchema(tenantSchemaBytes []byte) error
}

const (
	DefaultMaxJSONSchemaResolveDepth = 10
	DefaultMaxJSONSchemaSize         = 1 << 20 // 1 MB

	// jsonSchemaResolverCacheKeySep separates project ID and schema URL in [JSONSchemaResolverCacheKey].
	// Project IDs must not contain this rune (true for typical IDs).
	jsonSchemaResolverCacheKeySep = "\x00"
)

const schemaEmbedRoot = "schema"

//go:embed schema
var schemaFS embed.FS

// builtinTemplates maps URL path after the configured public base to parsed text/template
// sources (see [JSONSchemaResolver.builtinPublicBase]). Populated in [init]; panics on embed
// or template errors so broken builtins fail at process start.
var builtinTemplates map[string]*template.Template

func init() {
	m := make(map[string]*template.Template)
	err := fs.WalkDir(schemaFS, schemaEmbedRoot, func(fsPath string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(fsPath, ".json") {
			return nil
		}
		raw, err := schemaFS.ReadFile(fsPath)
		if err != nil {
			return fmt.Errorf("domain: read builtin schema %q: %w", fsPath, err)
		}
		tmpl, err := template.New(fsPath).Parse(string(raw))
		if err != nil {
			return fmt.Errorf("domain: parse builtin schema %q: %w", fsPath, err)
		}
		rel, ok := strings.CutPrefix(fsPath, schemaEmbedRoot+"/")
		if !ok {
			return fmt.Errorf("domain: builtin schema %q not under %s/", fsPath, schemaEmbedRoot)
		}
		if _, exists := m[rel]; exists {
			return fmt.Errorf("domain: duplicate builtin JSON schema path %q", rel)
		}
		m[rel] = tmpl
		return nil
	})
	if err != nil {
		panic(err)
	}
	if len(m) == 0 {
		panic("domain: no builtin JSON schemas (*.json) under embed path " + schemaEmbedRoot)
	}
	builtinTemplates = m
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
	validator  SchemaValidator
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
	validator SchemaValidator,
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
		validator:         validator,
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
	schema, err := r.resolveRecursively(ctx, client, projectID, schemaURL, 0, rootSchema)
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
) (_ *jsonschema.Schema, err error) {
	if depth > r.maxResolveDepth {
		return nil, fmt.Errorf("max resolve depth reached")
	}
	if len(schemaData) == 0 {
		schemaData, err = r.loadSchemaPayload(ctx, client, projectID, schemaURL)
		if err != nil {
			return nil, err
		}
	}
	schema, err := unmarshalJSONSchema(schemaURL, schemaData)
	if err != nil {
		return nil, err
	}
	err = schema.Resolve(&jsonschema.ResolveOpts{
		Loader: func(schemaID string, uri *url.URL) (*jsonschema.Schema, error) {
			next, err := r.resolveRecursively(ctx, client, projectID, uri.String(), depth+1, nil)
			if err != nil {
				return nil, err
			}
			return next, nil
		},
	})
	if err != nil {
		return nil, err
	}
	return schema, nil
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
	if err := writeBuiltinJSONSchema(&buf, relPath, canonicalSchemaURL); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// WriteBuiltinJSONSchema renders a built-in JSON schema template to w.
// schemaPath is the URL path after the configured public base, including the .json filename
// (for example user/v1/user.schema.json for URL https://iam.example.com/schema/user/v1/user.schema.json
// when the public base is https://iam.example.com/schema).
// canonicalDocumentURL must be the absolute schema URL used as JSON Schema $id and for resolution
// (typically the request URL used to serve this document).
func WriteBuiltinJSONSchema(w io.Writer, schemaPath string, canonicalDocumentURL string) error {
	return writeBuiltinJSONSchema(w, schemaPath, canonicalDocumentURL)
}

func writeBuiltinJSONSchema(w io.Writer, schemaPath string, canonicalDocumentURL string) error {
	tmpl, ok := builtinTemplates[schemaPath]
	if !ok {
		return fmt.Errorf("unknown builtin JSON schema path %q", schemaPath)
	}
	idx := strings.LastIndex(canonicalDocumentURL, "/")
	if idx < 0 {
		return fmt.Errorf("canonicalDocumentURL %q contains no '/' separator", canonicalDocumentURL)
	}
	data := struct {
		SchemaURL string
		BaseURL   string
	}{
		SchemaURL: canonicalDocumentURL,
		BaseURL:   canonicalDocumentURL[:idx],
	}
	return tmpl.Execute(w, data)
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
	if r.validator != nil {
		err = r.validator.ValidateAgainstMetaSchema(data)
		if err != nil {
			return nil, err
		}
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
	return data, err
}

func unmarshalJSONSchema(schemaURL string, data []byte) (*jsonschema.Schema, error) {
	var dst any
	if err := json.Unmarshal(data, &dst); err != nil {
		return nil, err
	}
	return jsonschema.SchemaFromJSON(schemaURL, nil, dst)
}
