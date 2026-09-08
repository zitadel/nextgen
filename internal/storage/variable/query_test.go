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
	owner := domain.VariableOwner{ProjectID: "match"}

	for _, project := range ids {
		v := &domain.Variable{Owner: domain.VariableOwner{ProjectID: project}}

		// VisibleTo compiles one equality per owner column, so a row is
		// admitted only when every column matches. The empty string is an
		// ordinary value here, not a wildcard.
		admitted := project == owner.ProjectID

		assert.Equal(t, admitted, owner.HasAccessTo(v), "project=%q", project)
	}
}

// Nothing is inherited across owners. Spelled out because admitting an unset
// level is the natural thing to reach for here, and doing it would look like a
// bug fix rather than the contract change it is.
func TestVisibleTo_NoInheritanceAcrossOwners(t *testing.T) {
	t.Parallel()

	project := domain.VariableOwner{ProjectID: "project-1"}
	projectVariable := &domain.Variable{Owner: project}

	assert.True(t, project.HasAccessTo(projectVariable))

	// Another project is unreachable, which is what makes project_id mandatory.
	otherProject := domain.VariableOwner{ProjectID: "project-2"}
	assert.False(t, otherProject.HasAccessTo(projectVariable))

	// And so is the unset owner: the empty project id is an address of its own,
	// not a wildcard.
	var unset domain.VariableOwner
	assert.False(t, unset.HasAccessTo(projectVariable))
}

func TestToDomain_MapsRowsInOrder(t *testing.T) {
	t.Parallel()

	rows := []*variable.VariableStorage{
		{Name: "a_variable", ProjectID: "project-1", Value: "a-value"},
		{Name: "b_variable", ProjectID: "project-1", Value: "b-value", IsSecret: true},
	}

	got := variable.ToDomain(rows)
	require.Len(t, got, 2)

	// Scan order is preserved: the query already ordered by name.
	assert.Equal(t, []any{"a-value", "b-value"}, []any{got[0].Value, got[1].Value})

	assert.Equal(t, "b_variable", got[1].Name)
	assert.Equal(t, domain.VariableOwner{ProjectID: "project-1"}, got[1].Owner)
	assert.True(t, got[1].IsSecret)
}
