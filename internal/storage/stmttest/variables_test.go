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

// variableFixture is a project and a name, both suffixed per test so cases
// never collide in a shared database.
type variableFixture struct {
	name      string
	projectID string
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

	return variableFixture{
		name:      name,
		projectID: projectID,
	}
}

// projectOwner addresses the project the fixture created.
func (f variableFixture) projectOwner() domain.VariableOwner {
	return domain.VariableOwner{ProjectID: f.projectID}
}

// set writes a variable at owner for kind and registers its removal.
func (f variableFixture) set(t *testing.T, stmts service.AllStatements, owner domain.VariableOwner, kind domain.OriginKind, value any, isSecret bool) *domain.Variable {
	t.Helper()
	v := &domain.Variable{Name: f.name, Owner: owner, Kind: kind, Value: value, IsSecret: isSecret}
	require.NoError(t, stmts.SetVariable(t.Context(), v))
	t.Cleanup(func() { _ = stmts.DeleteVariable(context.Background(), owner, kind, f.name) })
	return v
}

func (f variableFixture) get(t *testing.T, stmts service.AllStatements, owner domain.VariableOwner, kind domain.OriginKind) []*domain.Variable {
	t.Helper()
	got, err := stmts.GetVariables(t.Context(), owner, kind, f.name)
	require.NoError(t, err)
	return got
}

// TestVariablesRoundTrip covers the write path: what comes back out, and what
// a second write at the same name, owner and kind does to it.
func TestVariablesRoundTrip(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		owner := f.projectOwner()

		// A secret holds what the domain's secret constructor produces: the
		// JWE the project's key encrypted the value to, which is a string and
		// never a structure.
		const ciphertext = "eyJhbGciOiJBMjU2R0NNS1ciLCJraWQiOiJrZXktMSJ9.encrypted.value"
		f.set(t, d.stmts, owner, domain.OriginKindPrimary, ciphertext, true)

		got := f.get(t, d.stmts, owner, domain.OriginKindPrimary)
		require.Len(t, got, 1)
		assert.Equal(t, f.name, got[0].Name)
		assert.Equal(t, owner, got[0].Owner)
		assert.Equal(t, domain.OriginKindPrimary, got[0].Kind)
		assert.Equal(t, ciphertext, got[0].Value)
		assert.True(t, got[0].IsSecret)

		// The primary key is name plus owner and kind, so a second write at
		// the same one replaces the value in place.
		rewrite := &domain.Variable{Name: f.name, Owner: owner, Kind: domain.OriginKindPrimary, Value: "light", IsSecret: false}
		require.NoError(t, d.stmts.SetVariable(t.Context(), rewrite))

		got = f.get(t, d.stmts, owner, domain.OriginKindPrimary)
		require.Len(t, got, 1, "rewrite must replace the variable, not add a second one")
		assert.Equal(t, "light", got[0].Value)
		assert.False(t, got[0].IsSecret)
	})
}

// TestVariablesKindsAreIndependent checks that the primary and preview rows of
// one name are two variables: each read, rewritten and removed on its own, and
// neither standing in for the other (ADR 069).
func TestVariablesKindsAreIndependent(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		owner := f.projectOwner()

		f.set(t, d.stmts, owner, domain.OriginKindPrimary, "https://api.example.test", false)
		f.set(t, d.stmts, owner, domain.OriginKindPreview, "https://preview.example.test", false)

		t.Run("each kind reads its own value", func(t *testing.T) {
			primary := f.get(t, d.stmts, owner, domain.OriginKindPrimary)
			require.Len(t, primary, 1, "a read admits one kind, so one name is one row")
			assert.Equal(t, "https://api.example.test", primary[0].Value)
			assert.Equal(t, domain.OriginKindPrimary, primary[0].Kind)

			preview := f.get(t, d.stmts, owner, domain.OriginKindPreview)
			require.Len(t, preview, 1)
			assert.Equal(t, "https://preview.example.test", preview[0].Value)
			assert.Equal(t, domain.OriginKindPreview, preview[0].Kind)
		})

		t.Run("an unfiltered read is still one kind", func(t *testing.T) {
			all, err := d.stmts.GetVariables(t.Context(), owner, domain.OriginKindPreview)
			require.NoError(t, err)
			require.Len(t, all, 1)
			assert.Equal(t, domain.OriginKindPreview, all[0].Kind)
		})

		t.Run("a rewrite of one kind leaves the other", func(t *testing.T) {
			rewrite := &domain.Variable{Name: f.name, Owner: owner, Kind: domain.OriginKindPreview, Value: "https://pr-42.example.test"}
			require.NoError(t, d.stmts.SetVariable(t.Context(), rewrite))

			assert.Equal(t, "https://pr-42.example.test", f.get(t, d.stmts, owner, domain.OriginKindPreview)[0].Value)
			assert.Equal(t, "https://api.example.test", f.get(t, d.stmts, owner, domain.OriginKindPrimary)[0].Value)
		})

		t.Run("removing one kind leaves the other", func(t *testing.T) {
			require.NoError(t, d.stmts.DeleteVariable(t.Context(), owner, domain.OriginKindPrimary, f.name))

			assert.Empty(t, f.get(t, d.stmts, owner, domain.OriginKindPrimary))
			require.Len(t, f.get(t, d.stmts, owner, domain.OriginKindPreview), 1, "the preview row must survive the primary delete")

			// The primary row is gone, and the preview one is not what the
			// primary address names: no fallback on delete either.
			err := d.stmts.DeleteVariable(t.Context(), owner, domain.OriginKindPrimary, f.name)
			_, ok := errorsAsNoRowFound(err)
			assert.True(t, ok, "deleting the removed kind again should report NoRowFoundError, got %v", err)
		})

		// The other half of "no fallback": a name entered for one kind only is
		// absent from a read of the other, not inherited by it.
		t.Run("a name entered for one kind is absent from the other", func(t *testing.T) {
			only := variableFixture{name: f.name + "_primary_only", projectID: f.projectID}
			only.set(t, d.stmts, owner, domain.OriginKindPrimary, "primary", false)

			require.Len(t, only.get(t, d.stmts, owner, domain.OriginKindPrimary), 1)
			assert.Empty(t, only.get(t, d.stmts, owner, domain.OriginKindPreview))
		})
	})
}

// TestVariablesOwnersAreIndependent checks that a read admits one project: a
// name another project entered is not visible.
func TestVariablesOwnersAreIndependent(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)

		f.set(t, d.stmts, f.projectOwner(), domain.OriginKindPrimary, "project", false)

		t.Run("the project reads its own value", func(t *testing.T) {
			got := f.get(t, d.stmts, f.projectOwner(), domain.OriginKindPrimary)
			require.Len(t, got, 1, "a read admits one owner, so one name is one row")
			assert.Equal(t, "project", got[0].Value)
		})

		t.Run("another project sees nothing", func(t *testing.T) {
			assert.Empty(t, f.get(t, d.stmts, domain.VariableOwner{ProjectID: f.projectID + "-other"}, domain.OriginKindPrimary))
		})
	})
}

// TestVariablesNameFilter checks that names narrow the read and that omitting
// them does not.
func TestVariablesNameFilter(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		owner := f.projectOwner()
		f.set(t, d.stmts, owner, domain.OriginKindPrimary, "wanted", false)

		other := variableFixture{name: f.name + "_other", projectID: f.projectID}
		other.set(t, d.stmts, owner, domain.OriginKindPrimary, "unwanted", false)

		byName, err := d.stmts.GetVariables(t.Context(), owner, domain.OriginKindPrimary, f.name)
		require.NoError(t, err)
		require.Len(t, byName, 1)
		assert.Equal(t, "wanted", byName[0].Value)

		bothNames, err := d.stmts.GetVariables(t.Context(), owner, domain.OriginKindPrimary, f.name, other.name)
		require.NoError(t, err)
		assert.Len(t, bothNames, 2)

		// No names at all is not a narrower read: it is every name this owner
		// entered for the kind, which here is both.
		unfiltered, err := d.stmts.GetVariables(t.Context(), owner, domain.OriginKindPrimary)
		require.NoError(t, err)
		assert.Len(t, unfiltered, 2)
	})
}

// TestVariablesDelete covers removal, which addresses a variable the same way
// the primary key does: by name, kind and the exact owner that entered it.
func TestVariablesDelete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		owner := f.projectOwner()
		f.set(t, d.stmts, owner, domain.OriginKindPrimary, "value", false)

		// A different owner did not enter this variable, so it cannot remove
		// it -- the owner column has to match.
		err := d.stmts.DeleteVariable(t.Context(), domain.VariableOwner{ProjectID: f.projectID + "-other"}, domain.OriginKindPrimary, f.name)
		require.Error(t, err)
		_, ok := errorsAsNoRowFound(err)
		assert.True(t, ok, "deleting another owner's variable should report NoRowFoundError, got %v", err)
		require.Len(t, f.get(t, d.stmts, owner, domain.OriginKindPrimary), 1, "the variable must survive that attempt")

		require.NoError(t, d.stmts.DeleteVariable(t.Context(), owner, domain.OriginKindPrimary, f.name))
		assert.Empty(t, f.get(t, d.stmts, owner, domain.OriginKindPrimary))

		// Deleting what is not there is reported, not silently accepted.
		err = d.stmts.DeleteVariable(t.Context(), owner, domain.OriginKindPrimary, f.name)
		require.Error(t, err)
		_, ok = errorsAsNoRowFound(err)
		assert.True(t, ok, "second delete should report NoRowFoundError, got %v", err)
	})
}

// TestVariablesOwnerWithoutProjectRejected guards the constraint that keeps a
// variable from belonging to nothing.
func TestVariablesOwnerWithoutProjectRejected(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)

		err := d.stmts.SetVariable(t.Context(), &domain.Variable{
			Name:  f.name,
			Owner: domain.VariableOwner{},
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

		f.set(t, d.stmts, f.projectOwner(), domain.OriginKindPrimary, "project", false)
		f.set(t, d.stmts, f.projectOwner(), domain.OriginKindPreview, "project", false)
		require.Len(t, f.get(t, d.stmts, f.projectOwner(), domain.OriginKindPrimary), 1)

		_, err = d.stmts.DeleteProjectByID(t.Context(), f.projectID)
		require.NoError(t, err)
		assert.Empty(t, f.get(t, d.stmts, f.projectOwner(), domain.OriginKindPrimary), "deleting the project takes its variables with it")
		assert.Empty(t, f.get(t, d.stmts, f.projectOwner(), domain.OriginKindPreview), "of every kind")
	})
}

func errorsAsNoRowFound(err error) (*database.NoRowFoundError, bool) {
	var target *database.NoRowFoundError
	if errors.As(err, &target) {
		return target, true
	}
	return nil, false
}
