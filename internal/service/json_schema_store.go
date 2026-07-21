package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// JSONSchemaStatementStore adapts [JSONSchemaStatements] to [domain.JSONSchemaStore].
type JSONSchemaStatementStore struct {
	Statements JSONSchemaStatements
}

// NewJSONSchemaStatementStore returns a store bound to the given statements.
func NewJSONSchemaStatementStore(statements JSONSchemaStatements) JSONSchemaStatementStore {
	return JSONSchemaStatementStore{Statements: statements}
}

// GetByID implements [domain.JSONSchemaStore].
func (s JSONSchemaStatementStore) GetByID(ctx context.Context, projectID, schemaID string) (*domain.JSONSchema, error) {
	return s.Statements.GetJSONSchemaByID(ctx, projectID, schemaID)
}

// Create implements [domain.JSONSchemaStore].
func (s JSONSchemaStatementStore) Create(ctx context.Context, schema *domain.JSONSchema) error {
	return s.Statements.CreateJSONSchema(ctx, schema)
}

var _ domain.JSONSchemaStore = JSONSchemaStatementStore{}
