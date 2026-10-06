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
	// variable can name it.
	require.NoError(t, stmts.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })

	// A name is what a document references, so it has to be one the placeholder
	// syntax can address: \w only, which the suffix's separator is not.
	name := "login_appearance_" + strings.ReplaceAll(suffix, "-", "_")
	require.Regexp(t, domain.NameRegex, name, "the fixture must use a referenceable name")

	return variableFixture{name: name, projectID: projectID}
}

func (f variableFixture) owner() domain.VariableOwner {
	return domain.VariableOwner{ProjectID: f.projectID}
}

// set writes one value of the name and registers its removal.
func (f variableFixture) set(t *testing.T, stmts service.AllStatements, appliesTo domain.VariableAppliesTo, value any, isSecret bool) *domain.Variable {
	t.Helper()
	v := &domain.Variable{Name: f.name, Owner: f.owner(), AppliesTo: appliesTo, Value: value, IsSecret: isSecret}
	require.NoError(t, stmts.SetVariable(t.Context(), v))
	t.Cleanup(func() { _ = stmts.DeleteVariable(context.Background(), f.projectID, appliesTo, f.name) })
	return v
}

func (f variableFixture) get(t *testing.T, stmts service.AllStatements, appliesTo *domain.VariableAppliesTo) []*domain.Variable {
	t.Helper()
	got, err := stmts.GetVariables(t.Context(), f.projectID, appliesTo, f.name)
	require.NoError(t, err)
	return got
}

var (
	appliesAll     = domain.VariableAppliesToAll
	appliesPreview = domain.VariableAppliesToPreview
)

// TestVariablesRoundTrip covers the write path: what comes back out, and what
// a second write of the same name and applies_to does to it.
func TestVariablesRoundTrip(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)

		// A secret holds what the domain's secret constructor produces: the
		// JWE the project's key encrypted the value to, which is a string and
		// never a structure.
		const ciphertext = "eyJhbGciOiJBMjU2R0NNS1ciLCJraWQiOiJrZXktMSJ9.encrypted.value"
		f.set(t, d.stmts, appliesAll, ciphertext, true)

		got := f.get(t, d.stmts, &appliesAll)
		require.Len(t, got, 1)
		assert.Equal(t, f.name, got[0].Name)
		assert.Equal(t, f.owner(), got[0].Owner)
		assert.Equal(t, domain.VariableAppliesToAll, got[0].AppliesTo)
		assert.Equal(t, ciphertext, got[0].Value)
		assert.True(t, got[0].IsSecret)

		// The primary key is the project, name and applies_to, so a second
		// write of the same one replaces the value in place.
		rewrite := &domain.Variable{Name: f.name, Owner: f.owner(), AppliesTo: appliesAll, Value: "light", IsSecret: false}
		require.NoError(t, d.stmts.SetVariable(t.Context(), rewrite))

		got = f.get(t, d.stmts, &appliesAll)
		require.Len(t, got, 1, "rewrite must replace the variable, not add a second one")
		assert.Equal(t, "light", got[0].Value)
		assert.False(t, got[0].IsSecret)
	})
}

// A name may hold a value for every deploy and an override for previews. A
// read of one applies_to sees that one; a read of neither sees both, in a
// stable order.
func TestVariablesAppliesToIsTwoValues(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)

		f.set(t, d.stmts, appliesAll, "prod", false)
		f.set(t, d.stmts, appliesPreview, "preview", false)

		got := f.get(t, d.stmts, &appliesAll)
		require.Len(t, got, 1)
		assert.Equal(t, "prod", got[0].Value)

		got = f.get(t, d.stmts, &appliesPreview)
		require.Len(t, got, 1)
		assert.Equal(t, "preview", got[0].Value)

		got = f.get(t, d.stmts, nil)
		require.Len(t, got, 2)
		assert.Equal(t, domain.VariableAppliesToAll, got[0].AppliesTo)
		assert.Equal(t, domain.VariableAppliesToPreview, got[1].AppliesTo)

		t.Run("another project sees nothing", func(t *testing.T) {
			other, err := d.stmts.GetVariables(t.Context(), f.projectID+"-other", nil, f.name)
			require.NoError(t, err)
			assert.Empty(t, other)
		})
	})
}

// TestVariablesNameFilter checks that names narrow the read and that omitting
// them does not.
func TestVariablesNameFilter(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		f.set(t, d.stmts, appliesAll, "wanted", false)

		other := variableFixture{name: f.name + "_other", projectID: f.projectID}
		other.set(t, d.stmts, appliesAll, "unwanted", false)

		byName, err := d.stmts.GetVariables(t.Context(), f.projectID, &appliesAll, f.name)
		require.NoError(t, err)
		require.Len(t, byName, 1)
		assert.Equal(t, "wanted", byName[0].Value)

		bothNames, err := d.stmts.GetVariables(t.Context(), f.projectID, &appliesAll, f.name, other.name)
		require.NoError(t, err)
		assert.Len(t, bothNames, 2)

		// No names at all is not a narrower read: it is every name the
		// project holds, which here is both.
		unfiltered, err := d.stmts.GetVariables(t.Context(), f.projectID, nil)
		require.NoError(t, err)
		assert.Len(t, unfiltered, 2)
	})
}

// TestVariablesDelete covers removal, which addresses a value the same way the
// primary key does: by name and applies_to.
func TestVariablesDelete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)
		f.set(t, d.stmts, appliesAll, "value", false)

		// The preview value was never entered, so it cannot be removed, and
		// the attempt leaves the other value alone.
		err := d.stmts.DeleteVariable(t.Context(), f.projectID, appliesPreview, f.name)
		require.Error(t, err)
		_, ok := errorsAsNoRowFound(err)
		assert.True(t, ok, "deleting a value that is not there should report NoRowFoundError, got %v", err)
		require.Len(t, f.get(t, d.stmts, nil), 1, "the other value must survive that attempt")

		require.NoError(t, d.stmts.DeleteVariable(t.Context(), f.projectID, appliesAll, f.name))
		assert.Empty(t, f.get(t, d.stmts, nil))

		// Deleting what is not there is reported, not silently accepted.
		err = d.stmts.DeleteVariable(t.Context(), f.projectID, appliesAll, f.name)
		require.Error(t, err)
		_, ok = errorsAsNoRowFound(err)
		assert.True(t, ok, "second delete should report NoRowFoundError, got %v", err)
	})
}

// TestVariablesProjectForeignKey covers the project being mandatory: it is a
// real reference, so a variable cannot name a project that does not exist and
// does not outlive the one it belongs to.
func TestVariablesProjectForeignKey(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newVariableFixture(t, d.stmts)

		err := d.stmts.SetVariable(t.Context(), &domain.Variable{
			Name:  f.name,
			Owner: domain.VariableOwner{ProjectID: f.projectID + "-missing"},
			Value: "orphan",
		})
		require.Error(t, err, "a variable cannot belong to a project that is not there")

		err = d.stmts.SetVariable(t.Context(), &domain.Variable{Name: f.name, Value: "orphan"})
		require.Error(t, err, "a variable cannot belong to nothing")

		f.set(t, d.stmts, appliesAll, "project", false)
		f.set(t, d.stmts, appliesPreview, "preview", false)
		require.Len(t, f.get(t, d.stmts, nil), 2)

		_, err = d.stmts.DeleteProjectByID(t.Context(), f.projectID)
		require.NoError(t, err)
		assert.Empty(t, f.get(t, d.stmts, nil), "deleting the project takes its variables with it")
	})
}

func errorsAsNoRowFound(err error) (*database.NoRowFoundError, bool) {
	var target *database.NoRowFoundError
	if errors.As(err, &target) {
		return target, true
	}
	return nil, false
}
