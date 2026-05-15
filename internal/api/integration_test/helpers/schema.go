//go:build integration

package helpers

import (
	"testing"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureSchemaService(t *testing.T) *service.SchemaService {
	t.Helper()
	if h.SchemaService == nil {
		h.SchemaService = service.NewSchemaService(
			h.EnsurePgDatabase(t),
			h.EnsureSchemaRepo(t),
			h.EnsureSchemaResolver(t),
		)
	}
	return h.SchemaService
}

func (h *Harness) EnsureSchemaRepo(t *testing.T) domain.JSONSchemaRepository {
	t.Helper()
	if h.SchemaRepo == nil {
		h.SchemaRepo = repository.NewJSONSchemaRepository(
			h.EnsurePgDatabase(t),
		)
	}
	return h.SchemaRepo
}

func (h *Harness) EnsureSchemaResolver(t *testing.T) *domain.JSONSchemaResolver {
	t.Helper()
	if h.SchemaResolver == nil {
		cache, err := lru.New2Q[string, *jsonschema.Schema](100)
		require.NoError(t, err)

		h.SchemaResolver = domain.NewJSONSchemaResolver(
			h.SchemaRepo,
			cache,
			0,
			0,
			h.EnsureHttpClient(t),
			nil,
		)
	}
	return h.SchemaResolver
}
