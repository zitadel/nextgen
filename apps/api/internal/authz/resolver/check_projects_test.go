package resolver_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service/mocks"
)

// CheckProjects decides several projects as CheckPath decides each, from one
// check statement, and asks the platform operator question at most once.
func TestCheckProjects(t *testing.T) {
	t.Parallel()

	base := resolver.Request{
		PrincipalType:     domain.AuthzPrincipalTypeUser,
		PrincipalID:       "user_alice",
		HomeProjectID:     "proj_platform",
		PlatformProjectID: "proj_platform",
		ObjectType:        "project",
		Relation:          "viewer",
	}
	projects := []string{"proj_granted", "proj_team", "proj_none"}
	results := []domain.AuthzCheckResult{{Allowed: true, Foothold: true}, {Foothold: true}, {}}

	t.Run("grants, a foothold and a miss", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)
		stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
		stmts.EXPECT().CheckAuthzProjects(gomock.Any(), gomock.Any(), projects).Return(results, nil)
		stmts.EXPECT().CheckPlatformOperator(gomock.Any(), gomock.Any()).Return(false, nil).Times(1)

		decisions, paths, err := resolver.New().CheckProjects(context.Background(), stmts, base, projects)
		require.NoError(t, err)
		assert.Equal(t, []resolver.Decision{resolver.DecisionAllow, resolver.DecisionForbidden, resolver.DecisionNotFound}, decisions)
		assert.Equal(t, resolver.PathGrant, paths[0])
	})

	t.Run("an operator is allowed every project the grants do not reach", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)
		stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
		stmts.EXPECT().CheckAuthzProjects(gomock.Any(), gomock.Any(), projects).Return(results, nil)
		stmts.EXPECT().CheckPlatformOperator(gomock.Any(), gomock.Any()).Return(true, nil).Times(1)

		decisions, paths, err := resolver.New().CheckProjects(context.Background(), stmts, base, projects)
		require.NoError(t, err)
		assert.Equal(t, []resolver.Decision{resolver.DecisionAllow, resolver.DecisionAllow, resolver.DecisionAllow}, decisions)
		assert.Equal(t, []resolver.Path{resolver.PathGrant, resolver.PathPlatformOperator, resolver.PathPlatformOperator}, paths)
	})

	t.Run("no projects asks nothing", func(t *testing.T) {
		t.Parallel()
		ctrl := gomock.NewController(t)
		stmts := mocks.NewMockAuthzResolverStatements(ctrl)
		decisions, _, err := resolver.New().CheckProjects(context.Background(), stmts, base, nil)
		require.NoError(t, err)
		assert.Empty(t, decisions)
	})
}
