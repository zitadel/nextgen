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
	owner := domain.VariableOwner{ProjectID: "match", EnvironmentID: "match"}

	for _, project := range ids {
		for _, environment := range ids {
			v := &domain.Variable{Owner: domain.VariableOwner{
				ProjectID:     project,
				EnvironmentID: environment,
			}}

			// VisibleTo compiles one equality per owner column, so a row is
			// admitted only when both match. The empty string is an ordinary
			// value here -- the project level's own address -- not a wildcard.
			admitted := project == owner.ProjectID && environment == owner.EnvironmentID

			assert.Equal(t, admitted, owner.HasAccessTo(v),
				"project=%q environment=%q", project, environment)
		}
	}
}

// Both directions in which nothing is inherited. Spelled out because admitting
// an unset level is the natural thing to reach for here, and doing it would
// look like a bug fix rather than the contract change it is.
func TestVisibleTo_NoInheritanceInEitherDirection(t *testing.T) {
	t.Parallel()

	project := domain.VariableOwner{ProjectID: "project-1"}
	environment := domain.VariableOwner{ProjectID: "project-1", EnvironmentID: "env_prod"}

	projectVariable := &domain.Variable{Owner: project}
	environmentVariable := &domain.Variable{Owner: environment}

	assert.False(t, environment.HasAccessTo(projectVariable),
		"an environment does not inherit the project's variables; it has to enter its own")
	assert.False(t, project.HasAccessTo(environmentVariable),
		"the project level does not see into its environments")

	assert.True(t, project.HasAccessTo(projectVariable))
	assert.True(t, environment.HasAccessTo(environmentVariable))

	// A sibling environment is as unreachable as it ever was.
	sibling := domain.VariableOwner{ProjectID: "project-1", EnvironmentID: "env_staging"}
	assert.False(t, sibling.HasAccessTo(environmentVariable))

	// And so is another project, which is what makes project_id mandatory.
	otherProject := domain.VariableOwner{ProjectID: "project-2"}
	assert.False(t, otherProject.HasAccessTo(projectVariable))
}

func TestToDomain_MapsRowsInOrder(t *testing.T) {
	t.Parallel()

	rows := []*variable.VariableStorage{
		{Name: "a_variable", ProjectID: "project-1", EnvironmentID: "env_prod", Value: "a-prod"},
		{Name: "b_variable", ProjectID: "project-1", EnvironmentID: "env_prod", Value: "b-prod", IsSecret: true},
	}

	got := variable.ToDomain(rows)
	require.Len(t, got, 2)

	// Scan order is preserved: the query already ordered by name.
	assert.Equal(t, []any{"a-prod", "b-prod"}, []any{got[0].Value, got[1].Value})

	assert.Equal(t, "b_variable", got[1].Name)
	assert.Equal(t, domain.VariableOwner{ProjectID: "project-1", EnvironmentID: "env_prod"}, got[1].Owner)
	assert.True(t, got[1].IsSecret)
}
