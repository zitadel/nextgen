package variable_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/variable"
)

// VisibleTo has to agree with HasAccessTo exactly. Under the settings ladder
// this replaced, a disagreement in the admitting direction only cost IO, since
// the domain predicate ran again during resolution. Variables are returned as
// scanned, so VisibleTo is the only enforcement there is and an over-admitting
// filter is a leak. The filter is inspected rather than evaluated in a
// database: it must be an AND of plain equalities, one on the owner column and
// one on the kind column binding the kind's stored name, and those equalities,
// evaluated against every owner and kind combination, must admit exactly the
// rows the domain predicate does for the kind.
func TestVisibleTo_AgreesWithHasAccessTo(t *testing.T) {
	t.Parallel()

	owner := domain.VariableOwner{ProjectID: "match"}
	kind := domain.OriginKindPreview

	opts := variable.VisibleTo(owner, kind)
	require.NotNil(t, opts)

	and, ok := opts.Filter.(database.AndFilter[variable.VariableStorageField])
	require.True(t, ok, "VisibleTo must AND its restrictions: %T", opts.Filter)
	require.Len(t, and.Filters, 2, "one equality per column, no name filter when no names are given")

	// Flatten the filter to column → bound value. Every term is a single
	// equality: anything else could admit more than one row per column.
	bound := make(map[variable.VariableStorageField]any, len(and.Filters))
	for _, filter := range and.Filters {
		eq, ok := filter.(*database.CompareFilter[variable.VariableStorageField])
		require.True(t, ok, "%T is not an equality", filter)
		require.Equal(t, database.OpEqual, eq.Op)
		require.Len(t, eq.Terms, 1)
		bound[eq.Terms[0].Column.Field()] = eq.Terms[0].Value
	}
	assert.Equal(t, map[variable.VariableStorageField]any{
		variable.VariableStorageFieldProjectID: "match",
		variable.VariableStorageFieldKind:      kind.String(),
	}, bound, "the kind is stored under its name, so the filter must bind the name")

	// The compiled equalities, evaluated over every row the table could
	// hold, admit the rows HasAccessTo admits for the kind and no other. The
	// empty string is an ordinary value here, not a wildcard, and primary is
	// not a fallback for preview.
	for _, project := range []string{"", "match", "other"} {
		for _, rowKind := range domain.OriginKindValues() {
			v := &domain.Variable{Owner: domain.VariableOwner{ProjectID: project}, Kind: rowKind}
			admitted := bound[variable.VariableStorageFieldProjectID] == project &&
				bound[variable.VariableStorageFieldKind] == rowKind.String()

			assert.Equal(t, owner.HasAccessTo(v) && v.Kind == kind, admitted, "project=%q kind=%s", project, rowKind)
		}
	}
}

// Another project's variables are unreachable, which is what makes project_id
// mandatory.
func TestVisibleTo_ProjectIsolation(t *testing.T) {
	t.Parallel()

	project := domain.VariableOwner{ProjectID: "project-1"}
	projectVariable := &domain.Variable{Owner: project}

	assert.True(t, project.HasAccessTo(projectVariable))

	otherProject := domain.VariableOwner{ProjectID: "project-2"}
	assert.False(t, otherProject.HasAccessTo(projectVariable))
}

func TestToDomain_MapsRowsInOrder(t *testing.T) {
	t.Parallel()

	rows := []*variable.VariableStorage{
		{Name: "a_variable", ProjectID: "project-1", Kind: domain.OriginKindPrimary, Value: "a-prod"},
		{Name: "b_variable", ProjectID: "project-1", Kind: domain.OriginKindPreview, Value: "b-preview", IsSecret: true},
	}

	got := variable.ToDomain(rows)
	require.Len(t, got, 2)

	// Scan order is preserved: the query already ordered by name.
	assert.Equal(t, []any{"a-prod", "b-preview"}, []any{got[0].Value, got[1].Value})

	assert.Equal(t, "b_variable", got[1].Name)
	assert.Equal(t, domain.VariableOwner{ProjectID: "project-1"}, got[1].Owner)
	assert.Equal(t, domain.OriginKindPreview, got[1].Kind)
	assert.True(t, got[1].IsSecret)
}
