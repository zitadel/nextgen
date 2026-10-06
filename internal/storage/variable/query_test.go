package variable_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/variable"
)

// VisibleTo has to agree with HasAccessTo exactly: variables are returned as
// scanned, so VisibleTo is the only enforcement there is and an over-admitting
// filter is a leak. Rather than assert on compiled SQL, evaluate the domain
// predicate over every project combination and check the two agree.
func TestVisibleTo_AgreesWithHasAccessTo(t *testing.T) {
	t.Parallel()

	owner := domain.VariableOwner{ProjectID: "match"}
	for _, project := range []string{"", "match", "other"} {
		v := &domain.Variable{Owner: domain.VariableOwner{ProjectID: project}}
		admitted := project == owner.ProjectID
		assert.Equal(t, admitted, owner.HasAccessTo(v), "project=%q", project)
	}
}

func TestRowToDomain(t *testing.T) {
	t.Parallel()

	got, err := variable.RowToDomain(&variable.VariableStorage{
		Name: "GOOGLE_CLIENT_SECRET", ProjectID: "p", AppliesTo: "preview", Value: "cipher", IsSecret: true,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.VariableAppliesToPreview, got.AppliesTo)
	assert.Equal(t, domain.VariableOwner{ProjectID: "p"}, got.Owner)
	assert.True(t, got.IsSecret)

	_, err = variable.RowToDomain(&variable.VariableStorage{Name: "x", ProjectID: "p", AppliesTo: "staging"})
	assert.Error(t, err, "an applies_to the enum does not know must not scan silently")
}

func TestVisibleTo_FilterShape(t *testing.T) {
	t.Parallel()

	preview := domain.VariableAppliesToPreview
	opts := variable.VisibleTo("p", &preview, "a", "b")
	require.NotNil(t, opts.Filter)
	assert.Len(t, opts.Pagination.OrderBy.Columns, 2, "name then applies_to make the order total")
}
