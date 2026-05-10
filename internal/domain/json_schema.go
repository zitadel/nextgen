package domain

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/internal/httputil"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// JSONSchema represent a JSON schema which can be used to validate JSON data.
type JSONSchema struct {
	InstanceID string
	URL        string
	CreatedAt  time.Time
	Schema     []byte
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
	InstanceID() database.Column
	URL() database.Column
	CreatedAt() database.Column
	Payload() database.Column
}

type jsonSchemaConditions interface {
	PrimaryKeyCondition(instanceID, url string) database.Condition
	InstanceIDCondition(instanceID string) database.Condition
	URLCondition(url string) database.Condition
}

const (
	DefaultMaxJSONSchemaResolveDepth = 10
	DefaultMaxJSONSchemaSize         = 1 << 20 // 1 MB

	// jsonSchemaResolverCacheKeySep separates instance ID and schema URL in [JSONSchemaResolverCacheKey].
	// Instance IDs must not contain this rune (true for typical IDs).
	jsonSchemaResolverCacheKeySep = "\x00"
)

// jsonSchemaResolverCacheKey is the string used as an LRU key for a resolved schema for this instance and URL.
func jsonSchemaResolverCacheKey(instanceID, schemaURL string) string {
	return instanceID + jsonSchemaResolverCacheKeySep + schemaURL
}

// JSONSchemaResolver retrieves JSON schemas by their URL recursively,
// starting from the given schema URL and following all references in the schema.
// It caches resolved schemas in memory and uses a repository to store them for future use.
type JSONSchemaResolver struct {
	repository JSONSchemaRepository
	// cache of fully resolved JSON schemas,
	// keyed by instanceID and schemaURL
	cache           *lru.TwoQueueCache[string, *jsonschema.Schema]
	maxResolveDepth int
	maxSize         int
	httpClient      *http.Client
}

// NewJSONSchemaResolver wires a resolver with shared repository, LRU cache, resolve limits, and an optional HTTP client for ingestion.
func NewJSONSchemaResolver(
	repository JSONSchemaRepository,
	cache *lru.TwoQueueCache[string, *jsonschema.Schema],
	maxResolveDepth int,
	maxSize int,
	httpClient *http.Client,
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
	return &JSONSchemaResolver{
		repository:      repository,
		cache:           cache,
		maxResolveDepth: maxResolveDepth,
		maxSize:         maxSize,
		httpClient:      httpClient,
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
	instanceID string,
	schemaURL string,
	rootSchema []byte,
) (*jsonschema.Schema, error) {
	cacheKey := jsonSchemaResolverCacheKey(instanceID, schemaURL)
	if schema, ok := r.cache.Get(cacheKey); ok {
		return schema, nil
	}
	schema, err := r.resolveRecursively(ctx, client, instanceID, schemaURL, 0, rootSchema)
	if err != nil {
		return nil, err
	}
	r.cache.Add(cacheKey, schema)
	return schema, nil
}

func (r *JSONSchemaResolver) resolveRecursively(
	ctx context.Context,
	client database.QueryExecutor,
	instanceID string,
	schemaURL string,
	depth int,
	schemaData []byte,
) (_ *jsonschema.Schema, err error) {
	if depth > r.maxResolveDepth {
		return nil, fmt.Errorf("max resolve depth reached")
	}
	if len(schemaData) == 0 {
		schemaData, err = r.getFromDatabase(ctx, client, instanceID, schemaURL)
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
			next, err := r.resolveRecursively(ctx, client, instanceID, uri.String(), depth+1, nil)
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

func (r *JSONSchemaResolver) getFromDatabase(ctx context.Context, client database.QueryExecutor, instanceID, schemaURL string) ([]byte, error) {
	dbSchema, err := r.repository.Get(ctx, client, database.WithCondition(
		r.repository.PrimaryKeyCondition(instanceID, schemaURL),
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
		InstanceID: instanceID,
		URL:        schemaURL,
		Schema:     data,
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
