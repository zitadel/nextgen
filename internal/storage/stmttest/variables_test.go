//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// variableFixture is one requester occupying every owner level, plus a name,
// all suffixed per test so cases never collide in a shared database.
type variableFixture struct {
	name      string
	requester domain.VariableOwner
}

func newVariableFixture(t *testing.T, stmts service.AllStatements) variableFixture {
	t.Helper()
	suffix := uniqueSuffix(t)
	projectID := "proj-var-" + suffix

	// The variables table carries no foreign key to projects (a root-level
	// variable stores '' rather than a project id), but a real project keeps the
	// fixture honest about what an owner id looks like.
	require.NoError(t, stmts.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	return variableFixture{
		name: "login.appearance." + suffix,
		requester: domain.VariableOwner{
			ProjectID:    projectID,
			TeamID:       "team-var-" + suffix,
			UserSchemaID: "usch-var-" + suffix,
			UserID:       "user-var-" + suffix,
		},
	}
}

// set writes a variable at owner and registers its removal.
func (f variableFixture) set(t *testing.T, stmts service.AllStatements, owner domain.VariableOwner, value any, isSecret bool) *domain.Variable {
	t.Helper()
	v := &domain.Variable{Name: f.name, Owner: owner, Value: value, IsSecret: isSecret}
	require.NoError(t, stmts.SetVariable(t.Context(), v))
	t.Cleanup(func() { _ = stmts.DeleteVariable(context.Background(), owner, f.name) })
	return v
}

// ownerAt truncates the requester to the given level, which is how a variable
// entered further up the hierarchy is addressed.
func (f variableFixture) ownerAt(level domain.VariableScope) domain.VariableOwner {
	owner := domain.VariableOwner{ProjectID: f.requester.ProjectID}
	if level >= domain.VariableScopeTeam {
		owner.TeamID = f.requester.TeamID
	}
	if level >= domain.VariableScopeUserSchema {
		owner.UserSchemaID = f.requester.UserSchemaID
	}
	if level >= domain.VariableScopeUser {
		owner.UserID = f.requester.UserID
	}
	return owner
}

func (f variableFixture) get(t *testing.T, stmts service.AllStatements, requester domain.VariableOwner) []*domain.Variable {
	t.Helper()
	got, err := stmts.GetVariables(t.Context(), requester, f.name)
	require.NoError(t, err)
	return got
}

// TestVariablesRoundTrip covers the write path: what comes back out, and what
// a second write at the same name and owner does to it.
func TestVariablesRoundTrip(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		owner := f.ownerAt(domain.VariableScopeProject)

		f.set(t, d.stmts, owner, map[string]any{"theme": "dark"}, true)

		got := f.get(t, d.stmts, f.requester)
		require.Len(t, got, 1)
		assert.Equal(t, f.name, got[0].Name)
		assert.Equal(t, owner, got[0].Owner)
		assert.Equal(t, map[string]any{"theme": "dark"}, got[0].Value)
		assert.True(t, got[0].IsSecret)

		// The primary key is name plus owner, so a second write at the same one
		// replaces the value in place.
		rewrite := &domain.Variable{Name: f.name, Owner: owner, Value: "light", IsSecret: false}
		require.NoError(t, d.stmts.SetVariable(t.Context(), rewrite))

		got = f.get(t, d.stmts, f.requester)
		require.Len(t, got, 1, "rewrite must replace the variable, not add a second one")
		assert.Equal(t, "light", got[0].Value)
		assert.False(t, got[0].IsSecret)
	})
}

// TestVariablesDoNotOverride is the difference from the settings ladder this
// table replaced: a name held at several levels yields one variable per level.
func TestVariablesDoNotOverride(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		levels := []domain.VariableScope{
			domain.VariableScopeProject,
			domain.VariableScopeTeam,
			domain.VariableScopeUserSchema,
			domain.VariableScopeUser,
		}
		for _, level := range levels {
			f.set(t, d.stmts, f.ownerAt(level), int(level), false)
		}

		got := f.get(t, d.stmts, f.requester)
		require.Len(t, got, len(levels), "every level the requester holds must come back")

		// NameThenOwner orders the owner columns broadest first, so the levels
		// arrive in the order they were written.
		for i, level := range levels {
			assert.Equal(t, f.ownerAt(level), got[i].Owner)
		}
	})
}

// TestVariablesVisibility is the owner predicate pushed into SQL: a requester
// sees its own branch and everything above it, and nothing off to the side.
func TestVariablesVisibility(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)

		f.set(t, d.stmts, f.ownerAt(domain.VariableScopeProject), "project", false)
		f.set(t, d.stmts, f.ownerAt(domain.VariableScopeTeam), "team", false)

		// A sibling team under the same project is off the requester's branch.
		sibling := f.ownerAt(domain.VariableScopeTeam)
		sibling.TeamID = f.requester.TeamID + "-sibling"
		f.set(t, d.stmts, sibling, "sibling", false)

		t.Run("full requester sees own branch but not the sibling", func(t *testing.T) {
			got := f.get(t, d.stmts, f.requester)
			require.Len(t, got, 2)
			assert.Equal(t, []any{"project", "team"}, []any{got[0].Value, got[1].Value})
		})

		t.Run("requester unset at a level sees only what is unset there", func(t *testing.T) {
			// A project-only requester holds no team, so no team-level variable
			// is on its branch -- including its own team's.
			got := f.get(t, d.stmts, domain.VariableOwner{ProjectID: f.requester.ProjectID})
			require.Len(t, got, 1)
			assert.Equal(t, "project", got[0].Value)
		})

		t.Run("another project sees nothing", func(t *testing.T) {
			got := f.get(t, d.stmts, domain.VariableOwner{ProjectID: f.requester.ProjectID + "-other"})
			assert.Empty(t, got)
		})

		t.Run("the sibling team sees the project variable and its own", func(t *testing.T) {
			got := f.get(t, d.stmts, sibling)
			require.Len(t, got, 2)
			assert.Equal(t, []any{"project", "sibling"}, []any{got[0].Value, got[1].Value})
		})
	})
}

// TestVariablesNameFilter checks that names narrow the read and that omitting
// them does not.
func TestVariablesNameFilter(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		owner := f.ownerAt(domain.VariableScopeProject)
		f.set(t, d.stmts, owner, "wanted", false)

		other := variableFixture{name: f.name + ".other", requester: f.requester}
		other.set(t, d.stmts, owner, "unwanted", false)

		byName, err := d.stmts.GetVariables(t.Context(), f.requester, f.name)
		require.NoError(t, err)
		require.Len(t, byName, 1)
		assert.Equal(t, "wanted", byName[0].Value)

		bothNames, err := d.stmts.GetVariables(t.Context(), f.requester, f.name, other.name)
		require.NoError(t, err)
		assert.Len(t, bothNames, 2)
	})
}

// TestVariablesDelete covers removal, which addresses a variable the same way
// the primary key does: by name and the exact owner that entered it.
func TestVariablesDelete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		owner := f.ownerAt(domain.VariableScopeProject)
		f.set(t, d.stmts, owner, "value", false)

		// A descendant inherits the variable but does not own it, so it cannot
		// delete it -- every owner column has to match.
		err := d.stmts.DeleteVariable(t.Context(), f.ownerAt(domain.VariableScopeTeam), f.name)
		require.Error(t, err)
		_, ok := errorsAsNoRowFound(err)
		assert.True(t, ok, "deleting an inherited variable should report NoRowFoundError, got %v", err)
		require.Len(t, f.get(t, d.stmts, f.requester), 1, "the variable must survive that attempt")

		require.NoError(t, d.stmts.DeleteVariable(t.Context(), owner, f.name))
		assert.Empty(t, f.get(t, d.stmts, f.requester))

		// Deleting what is not there is reported, not silently accepted.
		err = d.stmts.DeleteVariable(t.Context(), owner, f.name)
		require.Error(t, err)
		_, ok = errorsAsNoRowFound(err)
		assert.True(t, ok, "second delete should report NoRowFoundError, got %v", err)
	})
}

// TestVariablesOwnerChainRejected guards the constraint that keeps an empty
// owner id from reading as a wildcard: an owner whose ancestors are unset must
// not be storable at all.
func TestVariablesOwnerChainRejected(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)

		// A team with no project would otherwise be visible from every project.
		err := d.stmts.SetVariable(t.Context(), &domain.Variable{
			Name:  f.name,
			Owner: domain.VariableOwner{TeamID: f.requester.TeamID},
			Value: "orphan",
		})
		require.Error(t, err)
	})
}

func errorsAsNoRowFound(err error) (*database.NoRowFoundError, bool) {
	var target *database.NoRowFoundError
	if errors.As(err, &target) {
		return target, true
	}
	return nil, false
}
