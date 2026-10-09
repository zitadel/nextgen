package authz_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

func TestScopeManagedGrantList(t *testing.T) {
	t.Parallel()

	_, err := authz.ScopeManagedGrantList("", nil)
	require.Error(t, err)

	opts, err := authz.ScopeManagedGrantList("proj_a", nil)
	require.NoError(t, err)
	require.True(t, opts.Filter.Restricts(database.Col(domain.AuthzAssignmentFieldProjectID)))

	opts, err = authz.ScopeManagedGrantList("proj_a", &database.ListOptions[domain.AuthzAssignmentField]{
		Filter: database.Equal(database.Col(domain.AuthzAssignmentFieldRelation), "viewer"),
	})
	require.NoError(t, err)
	require.True(t, opts.Filter.Restricts(database.Col(domain.AuthzAssignmentFieldProjectID)))
	require.True(t, opts.Filter.Restricts(database.Col(domain.AuthzAssignmentFieldRelation)))
}
