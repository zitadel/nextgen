package branding_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/branding"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestNewestFirst(t *testing.T) {
	t.Parallel()
	order := branding.NewestFirst()
	assert.Equal(t, database.OrderDesc, order.Direction)
	assert.Equal(t, []database.Column[domain.BrandingField]{
		database.Col(domain.BrandingFieldCreatedAt),
		database.Col(domain.BrandingFieldID),
	}, order.Columns)
}

func TestListOptions(t *testing.T) {
	t.Parallel()
	opts := branding.ListOptions("proj_1", 3)
	require.NotNil(t, opts)
	assert.Equal(t, uint32(3), opts.Pagination.Limit)
	assert.Equal(t, branding.NewestFirst(), opts.Pagination.OrderBy)

	eq, ok := opts.Filter.(*database.CompareFilter[domain.BrandingField])
	require.True(t, ok)
	require.Len(t, eq.Terms, 1)
	assert.Equal(t, domain.BrandingFieldProjectID, eq.Terms[0].Column.Field())
	assert.Equal(t, "proj_1", eq.Terms[0].Value)
}
