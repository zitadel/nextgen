package spanner

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestActiveUniqueKey(t *testing.T) {
	t.Parallel()

	teamID := "team_1"
	resourceID := "res_1"
	delegationID := "del_1"
	revokedAt := time.Now()

	base := &domain.AuthzAssignment{
		ProjectID:     "proj_1",
		CatalogID:     "cat_1",
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   "user_1",
		ObjectType:    "document",
		Relation:      "viewer",
		ScopeKind:     domain.AuthzScopeKindProject,
	}

	t.Run("active project scope", func(t *testing.T) {
		t.Parallel()
		key := activeUniqueKey(base)
		require.NotNil(t, key)
		assert.Equal(t, "proj_1\x1fcat_1\x1fuser\x1fuser_1\x1fdocument\x1fviewer\x1fproject\x1f\x1f", *key)
	})

	t.Run("active team scope includes team id", func(t *testing.T) {
		t.Parallel()
		a := *base
		a.ApplyScope(domain.NewTeamAssignmentScope(teamID))
		key := activeUniqueKey(&a)
		require.NotNil(t, key)
		assert.Equal(t, "proj_1\x1fcat_1\x1fuser\x1fuser_1\x1fdocument\x1fviewer\x1fteam\x1fteam_1\x1f", *key)
	})

	t.Run("active resource scope includes resource id", func(t *testing.T) {
		t.Parallel()
		a := *base
		a.ApplyScope(domain.NewResourceAssignmentScope(resourceID))
		key := activeUniqueKey(&a)
		require.NotNil(t, key)
		assert.Equal(t, "proj_1\x1fcat_1\x1fuser\x1fuser_1\x1fdocument\x1fviewer\x1fresource\x1f\x1fres_1", *key)
	})

	t.Run("revoked is nil", func(t *testing.T) {
		t.Parallel()
		a := *base
		a.RevokedAt = &revokedAt
		assert.Nil(t, activeUniqueKey(&a))
	})

	t.Run("delegated is nil", func(t *testing.T) {
		t.Parallel()
		a := *base
		a.DelegationID = &delegationID
		assert.Nil(t, activeUniqueKey(&a))
	})
}
