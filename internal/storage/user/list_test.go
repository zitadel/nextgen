package user

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestEnsureListOptions_DefaultsOrderBy(t *testing.T) {
	opts := EnsureListOptions(nil)
	require.NotNil(t, opts)
	assert.Equal(t, []database.Column[domain.UserField]{
		database.Col(domain.UserFieldCreatedAt),
		database.Col(domain.UserFieldID),
	}, opts.Pagination.OrderBy.Columns)
	assert.Equal(t, database.OrderAsc, opts.Pagination.OrderBy.Direction)
}

func TestGroupByProject_ClearsAttributesAndIndexes(t *testing.T) {
	users := []*domain.User{
		{ProjectID: "p1", ID: "u1", Attributes: []domain.Attribute{{Key: "email", Value: "a"}}},
		{ProjectID: "p1", ID: "u2", Attributes: []domain.Attribute{{Key: "email", Value: "b"}}},
		{ProjectID: "p2", ID: "u3", Attributes: []domain.Attribute{{Key: "email", Value: "c"}}},
	}
	groups := GroupByProject(users)
	require.Len(t, groups, 2)
	assert.Equal(t, "p1", groups[0].ProjectID)
	assert.Equal(t, []string{"u1", "u2"}, groups[0].IDs)
	assert.Nil(t, groups[0].ByID["u1"].Attributes)
	assert.Equal(t, "p2", groups[1].ProjectID)
	assert.Equal(t, []string{"u3"}, groups[1].IDs)
}

func TestNextCursor_OnlyWhenPageFull(t *testing.T) {
	now := time.Now().UTC()
	users := []*domain.User{
		{ID: "u1", Metadata: domain.UserMetadata{CreatedAt: now}},
		{ID: "u2", Metadata: domain.UserMetadata{CreatedAt: now.Add(time.Second)}},
	}
	page := database.Page[domain.UserField]{
		Limit: 2,
		OrderBy: database.OrderBy[domain.UserField]{
			Columns: []database.Column[domain.UserField]{
				database.Col(domain.UserFieldCreatedAt),
				database.Col(domain.UserFieldID),
			},
			Direction: database.OrderAsc,
		},
	}
	assert.NotEmpty(t, NextCursor(users, page))
	assert.Empty(t, NextCursor(users[:1], page))
}
