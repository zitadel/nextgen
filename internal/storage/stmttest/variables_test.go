//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// variableFixture is a project, one of its environments, and a name, all
// suffixed per test so cases never collide in a shared database.
type variableFixture struct {
	name        string
	projectID   string
	environment string
}

func newVariableFixture(t *testing.T, stmts service.AllStatements) variableFixture {
	t.Helper()
	suffix := uniqueSuffix(t)
	projectID := "proj-var-" + suffix

	// project_id is a real foreign key, so the project has to exist before a
	// variable can name it. A real one also keeps the fixture honest about what
	// an owner id looks like.
	require.NoError(t, stmts.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	// A name is what a document references, so it has to be one the placeholder
	// syntax can address: \w only, which the suffix's separator is not.
	name := "login_appearance_" + strings.ReplaceAll(suffix, "-", "_")
	require.Regexp(t, domain.NameRegex, name, "the fixture must use a referenceable name")

	// environment_name is a real foreign key too, through the generated
	// environment_ref column, so the environment has to exist before a variable
	// can scope to it.
	environment := environmentNameFrom(t, "env-var-"+suffix)
	require.NoError(t, stmts.CreateEnvironment(t.Context(), &domain.Environment{
		ProjectID: projectID,
		Name:      environment,
	}))

	return variableFixture{
		name:        name,
		projectID:   projectID,
		environment: environment,
	}
}

// environmentNameFrom bends a test suffix into the shape an environment name is
// validated into: a lowercase DNS-style label of at most 63 characters. The
// suffix carries the test name, so it holds underscores and easily runs past
// the length limit; neither would get past the environments table. Collisions
// do not matter -- the name is unique per project and every fixture builds its
// own project.
func environmentNameFrom(t *testing.T, raw string) string {
	t.Helper()
	label := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			return r
		case r >= 'A' && r <= 'Z':
			return r + ('a' - 'A')
		default:
			return '-'
		}
	}, raw)
	if len(label) > domain.EnvironmentNameMaxLength {
		label = label[:domain.EnvironmentNameMaxLength]
	}
	label = strings.Trim(label, "-")
	require.Regexp(t, domain.EnvironmentNamePattern, label,
		"the fixture must use a name the environment resource would accept")
	return label
}

// projectOwner addresses the project level: the environment left unnamed, which
// is stored as the empty string and is an address in its own right rather than
// a wildcard.
func (f variableFixture) projectOwner() domain.VariableOwner {
	return domain.VariableOwner{ProjectID: f.projectID}
}

// environmentOwner addresses one environment of the project.
func (f variableFixture) environmentOwner() domain.VariableOwner {
	return domain.VariableOwner{ProjectID: f.projectID, EnvironmentName: f.environment}
}

// set writes a variable at owner and registers its removal.
func (f variableFixture) set(t *testing.T, stmts service.AllStatements, owner domain.VariableOwner, value any, isSecret bool) *domain.Variable {
	t.Helper()
	v := &domain.Variable{Name: f.name, Owner: owner, Value: value, IsSecret: isSecret}
	require.NoError(t, stmts.SetVariable(t.Context(), v))
	t.Cleanup(func() { _ = stmts.DeleteVariable(context.Background(), owner, f.name) })
	return v
}

func (f variableFixture) get(t *testing.T, stmts service.AllStatements, owner domain.VariableOwner) []*domain.Variable {
	t.Helper()
	got, err := stmts.GetVariables(t.Context(), owner, f.name)
	require.NoError(t, err)
	return got
}

// TestVariablesRoundTrip covers the write path: what comes back out, and what
// a second write at the same name and owner does to it.
func TestVariablesRoundTrip(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		owner := f.projectOwner()

		// A secret holds what the domain's secret constructor produces: the
		// JWE the project's key encrypted the value to, which is a string and
		// never a structure.
		const ciphertext = "eyJhbGciOiJBMjU2R0NNS1ciLCJraWQiOiJrZXktMSJ9.encrypted.value"
		f.set(t, d.stmts, owner, ciphertext, true)

		got := f.get(t, d.stmts, owner)
		require.Len(t, got, 1)
		assert.Equal(t, f.name, got[0].Name)
		assert.Equal(t, owner, got[0].Owner)
		assert.Equal(t, ciphertext, got[0].Value)
		assert.True(t, got[0].IsSecret)

		// The primary key is name plus owner, so a second write at the same one
		// replaces the value in place.
		rewrite := &domain.Variable{Name: f.name, Owner: owner, Value: "light", IsSecret: false}
		require.NoError(t, d.stmts.SetVariable(t.Context(), rewrite))

		got = f.get(t, d.stmts, owner)
		require.Len(t, got, 1, "rewrite must replace the variable, not add a second one")
		assert.Equal(t, "light", got[0].Value)
		assert.False(t, got[0].IsSecret)
	})
}

// TestVariablesOwnersAreIndependent is the difference from the settings ladder
// this table replaced. One name at two owners is two variables, and neither
// read returns the other's: the project level does not reach into an
// environment, and an environment does not inherit from the project.
func TestVariablesOwnersAreIndependent(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)

		f.set(t, d.stmts, f.projectOwner(), "project", false)
		f.set(t, d.stmts, f.environmentOwner(), "environment", false)

		t.Run("the project level reads its own value", func(t *testing.T) {
			got := f.get(t, d.stmts, f.projectOwner())
			require.Len(t, got, 1, "a read admits one owner, so one name is one row")
			assert.Equal(t, "project", got[0].Value)
		})

		t.Run("the environment reads its own value", func(t *testing.T) {
			got := f.get(t, d.stmts, f.environmentOwner())
			require.Len(t, got, 1)
			assert.Equal(t, "environment", got[0].Value)
		})

		t.Run("an environment with nothing entered reads nothing", func(t *testing.T) {
			// The project holds this name, but nothing is inherited: an
			// environment sees only what was entered on it.
			sibling := domain.VariableOwner{ProjectID: f.projectID, EnvironmentName: f.environment + "-sibling"}
			assert.Empty(t, f.get(t, d.stmts, sibling))
		})

		t.Run("another project sees nothing", func(t *testing.T) {
			assert.Empty(t, f.get(t, d.stmts, domain.VariableOwner{ProjectID: f.projectID + "-other"}))
		})
	})
}

// TestVariablesNameFilter checks that names narrow the read and that omitting
// them does not.
func TestVariablesNameFilter(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		owner := f.projectOwner()
		f.set(t, d.stmts, owner, "wanted", false)

		other := variableFixture{name: f.name + "_other", projectID: f.projectID, environment: f.environment}
		other.set(t, d.stmts, owner, "unwanted", false)

		byName, err := d.stmts.GetVariables(t.Context(), owner, f.name)
		require.NoError(t, err)
		require.Len(t, byName, 1)
		assert.Equal(t, "wanted", byName[0].Value)

		bothNames, err := d.stmts.GetVariables(t.Context(), owner, f.name, other.name)
		require.NoError(t, err)
		assert.Len(t, bothNames, 2)

		// No names at all is not a narrower read: it is every name this owner
		// entered, which here is both.
		unfiltered, err := d.stmts.GetVariables(t.Context(), owner)
		require.NoError(t, err)
		assert.Len(t, unfiltered, 2)
	})
}

// TestVariablesDelete covers removal, which addresses a variable the same way
// the primary key does: by name and the exact owner that entered it.
func TestVariablesDelete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		owner := f.projectOwner()
		f.set(t, d.stmts, owner, "value", false)

		// A different owner did not enter this variable, so it cannot remove
		// it -- every owner column has to match.
		err := d.stmts.DeleteVariable(t.Context(), f.environmentOwner(), f.name)
		require.Error(t, err)
		_, ok := errorsAsNoRowFound(err)
		assert.True(t, ok, "deleting another owner's variable should report NoRowFoundError, got %v", err)
		require.Len(t, f.get(t, d.stmts, owner), 1, "the variable must survive that attempt")

		require.NoError(t, d.stmts.DeleteVariable(t.Context(), owner, f.name))
		assert.Empty(t, f.get(t, d.stmts, owner))

		// Deleting what is not there is reported, not silently accepted.
		err = d.stmts.DeleteVariable(t.Context(), owner, f.name)
		require.Error(t, err)
		_, ok = errorsAsNoRowFound(err)
		assert.True(t, ok, "second delete should report NoRowFoundError, got %v", err)
	})
}

// TestVariablesOwnerWithoutProjectRejected guards the constraint that keeps a
// variable from belonging to nothing. The environment may be left unnamed --
// that addresses the project level -- but the project itself may not.
func TestVariablesOwnerWithoutProjectRejected(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)

		err := d.stmts.SetVariable(t.Context(), &domain.Variable{
			Name:  f.name,
			Owner: domain.VariableOwner{EnvironmentName: f.environment},
			Value: "orphan",
		})
		require.Error(t, err)
	})
}

// TestVariablesProjectForeignKey covers the other half of the project being
// mandatory: it is a real reference, so a variable cannot name a project that
// does not exist and does not outlive the one it belongs to.
func TestVariablesProjectForeignKey(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)

		err := d.stmts.SetVariable(t.Context(), &domain.Variable{
			Name:  f.name,
			Owner: domain.VariableOwner{ProjectID: f.projectID + "-missing"},
			Value: "orphan",
		})
		require.Error(t, err, "a variable cannot belong to a project that is not there")

		f.set(t, d.stmts, f.projectOwner(), "project", false)
		f.set(t, d.stmts, f.environmentOwner(), "environment", false)
		require.Len(t, f.get(t, d.stmts, f.projectOwner()), 1)

		_, err = d.stmts.DeleteProjectByID(t.Context(), f.projectID)
		require.NoError(t, err)
		assert.Empty(t, f.get(t, d.stmts, f.projectOwner()), "deleting the project takes its variables with it")
		assert.Empty(t, f.get(t, d.stmts, f.environmentOwner()), "including the ones its environments entered")
	})
}

// TestVariablesEnvironmentForeignKey covers the environment half of the owner
// being a real reference (ADR 061). It is the case the empty string makes
// awkward: ” is the project level, an address of its own that no environment
// row answers to, so the constraint rides a generated column (NULLIF of
// environment_name) that is NULL for exactly that address. Both halves of that
// are asserted here -- the project level writes with no environment in sight,
// and a scoped variable cannot name one that is not there.
func TestVariablesEnvironmentForeignKey(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)

		err := d.stmts.SetVariable(t.Context(), &domain.Variable{
			Name:  f.name,
			Owner: domain.VariableOwner{ProjectID: f.projectID, EnvironmentName: f.environment + "-missing"},
			Value: "orphan",
		})
		require.Error(t, err, "a variable cannot scope to an environment that is not there")
		_, isFK := errorsAsForeignKey(err)
		assert.True(t, isFK, "the refusal has to be the reference failing, not some other write error: %v", err)

		// The project level is the address the constraint must not reach: it
		// names no environment, and there is none for it to name.
		f.set(t, d.stmts, f.projectOwner(), "project", false)
		require.Len(t, f.get(t, d.stmts, f.projectOwner()), 1,
			"the project level writes without an environment to reference")

		f.set(t, d.stmts, f.environmentOwner(), "environment", false)
		require.Len(t, f.get(t, d.stmts, f.environmentOwner()), 1)
	})
}

func errorsAsForeignKey(err error) (*database.ForeignKeyError, bool) {
	var target *database.ForeignKeyError
	if errors.As(err, &target) {
		return target, true
	}
	return nil, false
}

func errorsAsNoRowFound(err error) (*database.NoRowFoundError, bool) {
	var target *database.NoRowFoundError
	if errors.As(err, &target) {
		return target, true
	}
	return nil, false
}
