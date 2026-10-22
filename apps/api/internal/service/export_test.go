package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// Test helpers for resolve/reuse paths that stay unexported in production.

func ResolveExistingIDP(
	s *idpConnectionService,
	ctx context.Context,
	stmts AllStatements,
	existing *domain.IDPConnection,
	document []byte,
) (*CreateIDPConnectionOutput, error) {
	return s.resolveExistingIDP(ctx, stmts, existing, document)
}

func ResolveOrCreateIDP(
	s *idpConnectionService,
	ctx context.Context,
	stmts AllStatements,
	projectID, slug string,
	document []byte,
) (*CreateIDPConnectionOutput, error) {
	return s.resolveOrCreate(ctx, stmts, projectID, slug, document)
}

func NewIDPConnectionServiceForTest(v2Pool *DB, schemas BuiltinSchemaProvider) *idpConnectionService {
	return NewIDPConnectionService(v2Pool, schemas)
}
