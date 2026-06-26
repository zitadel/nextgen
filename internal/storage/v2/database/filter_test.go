package database_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestEqualsFilterRestricts(t *testing.T) {
	filter := database.Equal(database.Col(domain.ProjectFieldID), "proj_1")
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldID)))
	assert.False(t, filter.Restricts(database.Col(domain.ProjectFieldCreatedAt)))
}

func TestAndFilterRestricts(t *testing.T) {
	filter := database.And(
		database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
		database.Equal(database.Col(domain.ProjectFieldCreatedAt), "now"),
	)
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldID)))
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldCreatedAt)))
	assert.False(t, filter.Restricts(database.Col(domain.ProjectFieldUpdatedAt)))
}

func TestOrFilterRestricts(t *testing.T) {
	filter := database.Or(
		database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
		database.Equal(database.Col(domain.ProjectFieldCreatedAt), "now"),
	)
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldID)))
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldCreatedAt)))
	assert.False(t, filter.Restricts(database.Col(domain.ProjectFieldUpdatedAt)))
}

func TestGreaterAndLessThanFilterRestricts(t *testing.T) {
	gt := database.GreaterThan(database.Col(domain.ProjectFieldCreatedAt), "t1")
	lt := database.LessThan(database.Col(domain.ProjectFieldID), "proj_1")
	assert.True(t, gt.Restricts(database.Col(domain.ProjectFieldCreatedAt)))
	assert.True(t, lt.Restricts(database.Col(domain.ProjectFieldID)))
}
