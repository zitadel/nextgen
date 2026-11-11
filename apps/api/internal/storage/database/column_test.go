package database_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestColField(t *testing.T) {
	t.Parallel()
	col := database.Col(domain.ProjectFieldID)
	assert.Equal(t, domain.ProjectFieldID, col.Field())
}

func TestColumnEquality(t *testing.T) {
	t.Parallel()
	a := database.Col(domain.ProjectFieldID)
	b := database.Col(domain.ProjectFieldID)
	c := database.Col(domain.ProjectFieldCreatedAt)

	assert.Equal(t, a, b)
	assert.NotEqual(t, a, c)
}

func TestColumnJSONRoundTrip(t *testing.T) {
	t.Parallel()
	col := database.Col(domain.ProjectFieldUpdatedAt)
	data, err := col.MarshalJSON()
	require.NoError(t, err)

	var decoded database.Column[domain.ProjectField]
	err = decoded.UnmarshalJSON(data)
	require.NoError(t, err)
	assert.Equal(t, col, decoded)
}
