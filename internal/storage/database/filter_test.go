package database_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestEqualFilterRestricts(t *testing.T) {
	t.Parallel()

	filter := database.Equal(database.Col(domain.ProjectFieldID), "proj_1")
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldID)))
	assert.False(t, filter.Restricts(database.Col(domain.ProjectFieldCreatedAt)))
	assert.Equal(t, database.OpEqual, filter.Op)
	assert.Len(t, filter.Terms, 1)
}

func TestCompareGreaterRestrictsAllTerms(t *testing.T) {
	t.Parallel()

	filter := database.CompareGreater(
		database.Term(database.Col(domain.ProjectFieldCreatedAt), "t1"),
		database.Term(database.Col(domain.ProjectFieldID), "proj_1"),
		database.Term(database.Col(domain.ProjectFieldUpdatedAt), "t2"),
	)
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldCreatedAt)))
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldID)))
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldUpdatedAt)))
	assert.Equal(t, database.OpGreater, filter.Op)
}

func TestAndFilterRestricts(t *testing.T) {
	t.Parallel()

	filter := database.And(
		database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
		database.Equal(database.Col(domain.ProjectFieldCreatedAt), "now"),
	)
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldID)))
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldCreatedAt)))
	assert.False(t, filter.Restricts(database.Col(domain.ProjectFieldUpdatedAt)))
}

func TestOrFilterRestricts(t *testing.T) {
	t.Parallel()

	filter := database.Or(
		database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
		database.Equal(database.Col(domain.ProjectFieldCreatedAt), "now"),
	)
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldID)))
	assert.True(t, filter.Restricts(database.Col(domain.ProjectFieldCreatedAt)))
	assert.False(t, filter.Restricts(database.Col(domain.ProjectFieldUpdatedAt)))
}

func TestGreaterAndLessThanFilterRestricts(t *testing.T) {
	t.Parallel()

	gt := database.GreaterThan(database.Col(domain.ProjectFieldCreatedAt), "t1")
	gte := database.GreaterThanOrEqual(database.Col(domain.ProjectFieldCreatedAt), "t1")
	lt := database.LessThan(database.Col(domain.ProjectFieldID), "proj_1")
	assert.True(t, gt.Restricts(database.Col(domain.ProjectFieldCreatedAt)))
	assert.True(t, gte.Restricts(database.Col(domain.ProjectFieldCreatedAt)))
	assert.Equal(t, database.OpGreaterOrEqual, gte.Op)
	assert.True(t, lt.Restricts(database.Col(domain.ProjectFieldID)))
}

func TestStringFilterConstructors(t *testing.T) {
	t.Parallel()

	col := database.Col(domain.FlowDefinitionFieldName)

	equal := database.StringEqual(col, "login")
	assert.Equal(t, database.StringMatchEqual, equal.Match)
	assert.False(t, equal.IgnoreCase)

	starts := database.StringStartsWith(col, "acme")
	assert.Equal(t, database.StringMatchStartsWith, starts.Match)
	assert.False(t, starts.IgnoreCase)

	contains := database.StringContains(col, "flow")
	assert.Equal(t, database.StringMatchContains, contains.Match)

	ends := database.StringEndsWith(col, "suffix")
	assert.Equal(t, database.StringMatchEndsWith, ends.Match)

	fold := database.StringEqualFold(col, "Login")
	assert.Equal(t, database.StringMatchEqual, fold.Match)
	assert.True(t, fold.IgnoreCase)

	foldContains := database.StringContainsFold(col, "flow")
	assert.Equal(t, database.StringMatchContains, foldContains.Match)
	assert.True(t, foldContains.IgnoreCase)
}

func TestStringFilterRestricts(t *testing.T) {
	t.Parallel()

	col := database.Col(domain.FlowDefinitionFieldName)
	filter := database.StringContains(col, "login")
	assert.True(t, filter.Restricts(col))
	assert.False(t, filter.Restricts(database.Col(domain.FlowDefinitionFieldID)))
}

func TestArrayContainsFilter(t *testing.T) {
	t.Parallel()

	col := database.Col(domain.FlowDefinitionFieldPurposes)
	filter := database.ArrayContains(col, "login")
	assert.Equal(t, col, filter.Column)
	assert.Equal(t, "login", filter.Value)
	assert.True(t, filter.Restricts(col))
	assert.False(t, filter.Restricts(database.Col(domain.FlowDefinitionFieldID)))
}

func TestCorrelatedEqualFilter(t *testing.T) {
	t.Parallel()

	col := database.Col(domain.SessionFieldTeamID)
	filter := database.CorrelatedEqual(col, "team_01H")
	assert.Equal(t, col, filter.Column)
	assert.Equal(t, "team_01H", filter.Value)
	assert.True(t, filter.Restricts(col))
	assert.False(t, filter.Restricts(database.Col(domain.SessionFieldUserID)))

	// It must compose like any other filter, so a wrapping And reports the
	// restriction through it.
	combined := database.And(database.Equal(database.Col(domain.SessionFieldProjectID), "proj_01H"), filter)
	assert.True(t, combined.Restricts(col))
}
