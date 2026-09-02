package variable_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/variable"
)

// VisibleTo has to agree with HasAccessTo exactly. Under the settings ladder
// this replaced, a disagreement in the admitting direction only cost IO, since
// the domain predicate ran again during resolution. Variables are returned as
// scanned, so VisibleTo is the only enforcement there is and an over-admitting
// filter is a leak. Rather than assert on compiled SQL, evaluate the domain
// predicate over every owner combination and check the two agree.
func TestVisibleTo_AgreesWithHasAccessTo(t *testing.T) {
	t.Parallel()

	ids := []string{"", "match", "other"}
	requester := domain.VariableOwner{
		ProjectID:    "match",
		TeamID:       "match",
		UserSchemaID: "match",
		UserID:       "match",
	}

	for _, project := range ids {
		for _, team := range ids {
			for _, schema := range ids {
				for _, user := range ids {
					v := &domain.Variable{Owner: domain.VariableOwner{
						ProjectID:    project,
						TeamID:       team,
						UserSchemaID: schema,
						UserID:       user,
					}}

					// The SQL filter admits a row when every column is either
					// unset or equal to the requester's, which is the predicate
					// ownerScope compiles per column.
					admitted := (project == "" || project == requester.ProjectID) &&
						(team == "" || team == requester.TeamID) &&
						(schema == "" || schema == requester.UserSchemaID) &&
						(user == "" || user == requester.UserID)

					assert.Equal(t, admitted, requester.HasAccessTo(v),
						"project=%q team=%q user_schema=%q user=%q", project, team, schema, user)
				}
			}
		}
	}
}

// A requester that is unset at a level can only reach rows that are also unset
// there. Spelled out separately because it is the case most easily got wrong:
// an empty requester id must not read as "matches anything".
func TestVisibleTo_UnsetRequesterLevelMatchesOnlyUnset(t *testing.T) {
	t.Parallel()

	projectOnly := domain.VariableOwner{ProjectID: "project-1"}

	sameProject := &domain.Variable{Owner: domain.VariableOwner{ProjectID: "project-1"}}
	withTeam := &domain.Variable{Owner: domain.VariableOwner{ProjectID: "project-1", TeamID: "team-1"}}

	assert.True(t, projectOnly.HasAccessTo(sameProject))
	assert.False(t, projectOnly.HasAccessTo(withTeam),
		"a project-level requester holds no team, so no team-level variable is on its branch")
}

func TestToDomain_MapsRowsInOrder(t *testing.T) {
	t.Parallel()

	rows := []*variable.VariableStorage{
		{Name: "a.variable", ProjectID: "project-1", Value: "a-project"},
		{Name: "a.variable", ProjectID: "project-1", TeamID: "team-1", Value: "a-team", IsSecret: true},
		{Name: "b.variable", ProjectID: "project-1", Value: "b-project"},
	}

	got := variable.ToDomain(rows)
	require.Len(t, got, 3, "variables do not override, so every row survives the mapping")

	// Scan order is preserved: the query already ordered by name then owner.
	assert.Equal(t, []any{"a-project", "a-team", "b-project"},
		[]any{got[0].Value, got[1].Value, got[2].Value})

	assert.Equal(t, "a.variable", got[1].Name)
	assert.Equal(t, domain.VariableOwner{ProjectID: "project-1", TeamID: "team-1"}, got[1].Owner)
	assert.Equal(t, "a-team", got[1].Value)
	assert.True(t, got[1].IsSecret)
}
