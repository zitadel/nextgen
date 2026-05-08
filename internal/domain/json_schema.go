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
)

// JSONSchemaResolver retrieves JSON schemas by their URL recursively,
// starting from the given schema URL and following all references in the schema.
// It caches resolved schemas in memory and uses a repository to store them for future use.
type JSONSchemaResolver struct {
	repository JSONSchemaRepository
	// cache of fully resolved JSON schemas,
	// keyed by instanceID and schemaURL
	cache *lru.TwoQueueCache[jsonSchemaCacheKey, *jsonschema.Schema]
}

type jsonSchemaCacheKey struct {
	instanceID string
	schemaURL  string
}

// NewJSONSchemaResolver creates a new JSONSchemaResolver with the given repository and cache size.
// The cache size is the maximum number of fully resolved schemas that will be cached in application memory.
func NewJSONSchemaResolver(repository JSONSchemaRepository, cacheSize int) (*JSONSchemaResolver, error) {
	cache, err := lru.New2Q[jsonSchemaCacheKey, *jsonschema.Schema](cacheSize)
	if err != nil {
		return nil, err
	}
	return &JSONSchemaResolver{
		repository: repository,
		cache:      cache,
	}, nil
}

// JSONSchemaResolverOptions are the options for [JSONSchemaResolver.Resolve]
type JSONSchemaResolverOptions struct {
	// Maximum depth of schema resolution, defaults to [DefaultMaxJSONSchemaResolveDepth] if unset.
	MaxResolveDepth int
	// Maximum payload size of a retrieved schema in bytes, defaults to [DefaultMaxJSONSchemaSize] if unset.
	MaxSize int
	// HTTP client to use for resolving schemas.
	// If unset, schemas will not be resolved from remote URLs (just the database will be used).
	// Set it when importing schemas, so the database can be populated when the schema is first referenced.
	// DO NOT set it when validating data, only schemas defined in the database are trusted.
	HTTPClient *http.Client
}

func (o *JSONSchemaResolverOptions) defaults() {
	if o.MaxResolveDepth == 0 {
		o.MaxResolveDepth = DefaultMaxJSONSchemaResolveDepth
	}
	if o.MaxSize == 0 {
		o.MaxSize = DefaultMaxJSONSchemaSize
	}
}

// Resolve retrieves a JSON schema by its URL recursively,
// starting from the given schema URL and following all references in the schema.
// It first tried to find the fully resolved schema in the cache.
// If not found in the cache, it looks for the schema and all its references by URL from the database.
// If opts contains an HTTP client, it will also try to resolve the schema from the URL and store it in the database.
func (r *JSONSchemaResolver) Resolve(
	ctx context.Context,
	client database.QueryExecutor,
	instanceID string,
	schemaURL string,
	rootSchema []byte,
	opts JSONSchemaResolverOptions,
) (*jsonschema.Schema, error) {
	cacheKey := jsonSchemaCacheKey{instanceID, schemaURL}
	if schema, ok := r.cache.Get(cacheKey); ok {
		return schema, nil
	}
	opts.defaults()
	schema, err := r.resolveRecursively(ctx, client, instanceID, schemaURL, 0, rootSchema, &opts)
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
	opts *JSONSchemaResolverOptions,
) (_ *jsonschema.Schema, err error) {
	if depth > opts.MaxResolveDepth {
		return nil, fmt.Errorf("max resolve depth reached")
	}
	if len(schemaData) == 0 {
		schemaData, err = r.getFromDatabase(ctx, client, instanceID, schemaURL, opts)
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
			next, err := r.resolveRecursively(ctx, client, instanceID, uri.String(), depth+1, nil, opts)
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

func (r *JSONSchemaResolver) getFromDatabase(ctx context.Context, client database.QueryExecutor, instanceID, schemaURL string, opts *JSONSchemaResolverOptions) ([]byte, error) {
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
	if opts.HTTPClient == nil {
		return nil, fmt.Errorf("schema not found in database: %w", err)
	}

	data, err := r.resolveFromURL(ctx, schemaURL, opts)
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

func (r *JSONSchemaResolver) resolveFromURL(ctx context.Context, url string, opts *JSONSchemaResolverOptions) ([]byte, error) {
	data, err := httputil.Get(ctx, url, opts.HTTPClient, "application/json")
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
