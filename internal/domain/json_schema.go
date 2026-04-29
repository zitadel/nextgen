package domain

import (
	"context"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// JSONSchema represent a JSON schema which can be used to validate JSON data.
type JSONSchema struct {
	InstanceID string
	URL       string
	CreatedAt time.Time
	Schema    *jsonschema.Schema
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
