package resolver_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service/mocks"
)

func TestCheck_Orchestration(t *testing.T) {
	t.Parallel()

	base := resolver.Request{
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   "user_alice",
		ProjectID:     "proj_1",
		HomeProjectID: "proj_1",
		ObjectType:    "project",
		Relation:      "viewer",
	}

	t.Run("allow", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)
		stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
		stmts.EXPECT().CheckAuthz(gomock.Any(), domain.AuthzCheckParams{
			CatalogID:              domain.SystemCatalogID,
			ProjectID:              base.ProjectID,
			PrincipalHomeProjectID: base.ProjectID,
			PrincipalType:          base.PrincipalType,
			PrincipalID:            base.PrincipalID,
			ObjectType:             base.ObjectType,
			Relation:               base.Relation,
		}).Return(true, true, nil)

		d, err := resolver.New().Check(context.Background(), stmts, base)
		require.NoError(t, err)
		assert.Equal(t, resolver.DecisionAllow, d)
	})

	t.Run("forbidden with foothold", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)
		stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
		stmts.EXPECT().CheckAuthz(gomock.Any(), gomock.Any()).Return(false, true, nil)

		d, err := resolver.New().Check(context.Background(), stmts, base)
		require.NoError(t, err)
		assert.Equal(t, resolver.DecisionForbidden, d)
	})

	t.Run("not found without foothold", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)
		stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
		stmts.EXPECT().CheckAuthz(gomock.Any(), gomock.Any()).Return(false, false, nil)

		d, err := resolver.New().Check(context.Background(), stmts, base)
		require.NoError(t, err)
		assert.Equal(t, resolver.DecisionNotFound, d)
	})

	t.Run("sk_team allowlist short circuit", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)

		d, err := resolver.New().Check(context.Background(), stmts, resolver.Request{
			PrincipalType: domain.AuthzPrincipalTypeSKTeam,
			PrincipalID:   "sk_team_1",
			ProjectID:     "proj_1",
			ObjectType:    "project",
			Relation:      "write",
			TeamID:        "team_1",
		})
		require.NoError(t, err)
		assert.Equal(t, resolver.DecisionNotFound, d)
	})

	t.Run("sk_team allowed permission reaches storage", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)
		stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
		stmts.EXPECT().CheckAuthz(gomock.Any(), domain.AuthzCheckParams{
			CatalogID:              domain.SystemCatalogID,
			ProjectID:              "proj_1",
			PrincipalHomeProjectID: "proj_1",
			PrincipalType:          domain.AuthzPrincipalTypeSKTeam,
			PrincipalID:            "sk_team_1",
			ObjectType:             "user",
			Relation:               "read",
			ConstraintTeamID:       "team_1",
			ResourceID:             "usr_in",
		}).Return(true, true, nil)

		d, err := resolver.New().Check(context.Background(), stmts, resolver.Request{
			PrincipalType: domain.AuthzPrincipalTypeSKTeam,
			PrincipalID:   "sk_team_1",
			ProjectID:     "proj_1",
			HomeProjectID: "proj_1",
			ObjectType:    "user",
			Relation:      "read",
			TeamID:        "team_1",
			ResourceID:    "usr_in",
		})
		require.NoError(t, err)
		assert.Equal(t, resolver.DecisionAllow, d)
	})

	t.Run("sk_team missing team id", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)
		_, err := resolver.New().Check(context.Background(), stmts, resolver.Request{
			PrincipalType: domain.AuthzPrincipalTypeSKTeam,
			PrincipalID:   "sk_team_1",
			ProjectID:     "proj_1",
			ObjectType:    "user",
			Relation:      "read",
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "team id is required")
	})

	t.Run("sk_team team-bound check requires resource id", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)
		_, err := resolver.New().Check(context.Background(), stmts, resolver.Request{
			PrincipalType: domain.AuthzPrincipalTypeSKTeam,
			PrincipalID:   "sk_team_1",
			ProjectID:     "proj_1",
			ObjectType:    "user",
			Relation:      "read",
			TeamID:        "team_1",
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "resource id is required")
	})

	t.Run("invalid input", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)
		_, err := resolver.New().Check(context.Background(), stmts, resolver.Request{})
		require.Error(t, err)
	})

	t.Run("memoizes decision", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)
		stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil).Times(1)
		stmts.EXPECT().CheckAuthz(gomock.Any(), gomock.Any()).Return(true, true, nil).Times(1)

		r := resolver.New()
		d1, err := r.Check(context.Background(), stmts, base)
		require.NoError(t, err)
		d2, err := r.Check(context.Background(), stmts, base)
		require.NoError(t, err)
		assert.Equal(t, resolver.DecisionAllow, d1)
		assert.Equal(t, resolver.DecisionAllow, d2)
	})

	t.Run("catalog lookup error", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)
		stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return("", errors.New("boom"))
		_, err := resolver.New().Check(context.Background(), stmts, base)
		require.Error(t, err)
	})
}

func TestListObjects_Orchestration(t *testing.T) {
	ctrl := gomock.NewController(t)
	stmts := mocks.NewMockAuthzResolverStatements(ctrl)
	stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
	stmts.EXPECT().ListAuthzObjectIDs(gomock.Any(), domain.AuthzListObjectsParams{
		AuthzCheckParams: domain.AuthzCheckParams{
			CatalogID:              domain.SystemCatalogID,
			ProjectID:              "proj_1",
			PrincipalHomeProjectID: "proj_1",
			PrincipalType:          domain.AuthzPrincipalTypeUser,
			PrincipalID:            "user_a",
			ObjectType:             "project",
			Relation:               "viewer",
		},
		ResourceKind: domain.ResourceKindUser,
	}).Return([]string{"u1", "u2"}, nil)

	ids, err := resolver.New().ListObjects(context.Background(), stmts, resolver.ListRequest{
		Request: resolver.Request{
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   "user_a",
			ProjectID:     "proj_1",
			HomeProjectID: "proj_1",
			ObjectType:    "project",
			Relation:      "viewer",
		},
		ResourceKind: domain.ResourceKindUser,
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"u1", "u2"}, ids)
}

func TestListObjects_SKTeamDeny(t *testing.T) {
	ctrl := gomock.NewController(t)
	stmts := mocks.NewMockAuthzResolverStatements(ctrl)
	ids, err := resolver.New().ListObjects(context.Background(), stmts, resolver.ListRequest{
		Request: resolver.Request{
			PrincipalType: domain.AuthzPrincipalTypeSKTeam,
			PrincipalID:   "sk",
			ProjectID:     "proj_1",
			ObjectType:    "project",
			Relation:      "viewer",
			TeamID:        "team_1",
		},
		ResourceKind: domain.ResourceKindUser,
	})
	require.NoError(t, err)
	assert.Empty(t, ids)
}

func TestCheckParams_SKTeamConstraint(t *testing.T) {
	ctrl := gomock.NewController(t)
	stmts := mocks.NewMockAuthzResolverStatements(ctrl)
	stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)

	params, err := resolver.New().CheckParams(context.Background(), stmts, resolver.Request{
		PrincipalType: domain.AuthzPrincipalTypeSKTeam,
		PrincipalID:   "sk_team_1",
		ProjectID:     "proj_1",
		HomeProjectID: "proj_home",
		ObjectType:    "project",
		Relation:      "viewer",
		TeamID:        "team_eng",
	})
	require.NoError(t, err)
	assert.Equal(t, "team_eng", params.ConstraintTeamID)
	assert.Equal(t, domain.SystemCatalogID, params.CatalogID)
	assert.Equal(t, "proj_home", params.PrincipalHomeProjectID)
	assert.Equal(t, "proj_1", params.ProjectID)
}

func TestCheckParams_DoesNotDefaultHomeToTarget(t *testing.T) {
	ctrl := gomock.NewController(t)
	stmts := mocks.NewMockAuthzResolverStatements(ctrl)
	stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)

	params, err := resolver.New().CheckParams(context.Background(), stmts, resolver.Request{
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   "user_alice",
		ProjectID:     "proj_target",
		ObjectType:    "project",
		Relation:      "viewer",
	})
	require.NoError(t, err)
	assert.Empty(t, params.PrincipalHomeProjectID)
	assert.Equal(t, "proj_target", params.ProjectID)
}

func TestListObjects_SKTeamTeamBoundDoesNotRequireResourceID(t *testing.T) {
	ctrl := gomock.NewController(t)
	stmts := mocks.NewMockAuthzResolverStatements(ctrl)
	stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
	stmts.EXPECT().ListAuthzObjectIDs(gomock.Any(), domain.AuthzListObjectsParams{
		AuthzCheckParams: domain.AuthzCheckParams{
			CatalogID:              domain.SystemCatalogID,
			ProjectID:              "proj_1",
			PrincipalHomeProjectID: "proj_1",
			PrincipalType:          domain.AuthzPrincipalTypeSKTeam,
			PrincipalID:            "sk",
			ObjectType:             "user",
			Relation:               "read",
			ConstraintTeamID:       "team_1",
		},
		ResourceKind: domain.ResourceKindUser,
	}).Return([]string{"usr_in"}, nil)

	ids, err := resolver.New().ListObjects(context.Background(), stmts, resolver.ListRequest{
		Request: resolver.Request{
			PrincipalType: domain.AuthzPrincipalTypeSKTeam,
			PrincipalID:   "sk",
			ProjectID:     "proj_1",
			HomeProjectID: "proj_1",
			ObjectType:    "user",
			Relation:      "read",
			TeamID:        "team_1",
		},
		ResourceKind: domain.ResourceKindUser,
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"usr_in"}, ids)
}
