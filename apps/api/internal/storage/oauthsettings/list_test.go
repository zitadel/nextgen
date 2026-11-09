package oauthsettings_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/oauthsettings"
)

func TestNewestFirst(t *testing.T) {
	t.Parallel()
	order := oauthsettings.NewestFirst()
	assert.Equal(t, database.OrderDesc, order.Direction)
	assert.Equal(t, []database.Column[domain.OAuthSettingsField]{
		database.Col(domain.OAuthSettingsFieldCreatedAt),
		database.Col(domain.OAuthSettingsFieldID),
	}, order.Columns)
}

func TestListOptions(t *testing.T) {
	t.Parallel()
	opts := oauthsettings.ListOptions("proj_1", 3)
	require.NotNil(t, opts)
	assert.Equal(t, uint32(3), opts.Pagination.Limit)
	assert.Equal(t, oauthsettings.NewestFirst(), opts.Pagination.OrderBy)

	eq, ok := opts.Filter.(*database.CompareFilter[domain.OAuthSettingsField])
	require.True(t, ok)
	require.Len(t, eq.Terms, 1)
	assert.Equal(t, domain.OAuthSettingsFieldProjectID, eq.Terms[0].Column.Field())
	assert.Equal(t, "proj_1", eq.Terms[0].Value)
}
