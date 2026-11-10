package resolver_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service/mocks"
)

func TestCheckPath_PlatformOperator(t *testing.T) {
	t.Parallel()

	// A platform-project user checking a customer project, as the gate asks
	// for a session homed in the platform project.
	operator := resolver.Request{
		PrincipalType:     domain.AuthzPrincipalTypeUser,
		PrincipalID:       "user_op",
		ProjectID:         "proj_customer",
		HomeProjectID:     "proj_platform",
		PlatformProjectID: "proj_platform",
		ObjectType:        "project",
		Relation:          "editor",
	}
	asked := domain.AuthzPlatformCheckParams{
		CatalogID:         domain.SystemCatalogID,
		PlatformProjectID: "proj_platform",
		UserID:            "user_op",
		ObjectType:        "project",
		Relation:          "editor",
	}

	setup := func(t *testing.T, allowed, foothold bool) *mocks.MockAuthzResolverStatements {
		t.Helper()
		stmts := mocks.NewMockAuthzResolverStatements(gomock.NewController(t))
		stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
		stmts.EXPECT().CheckAuthz(gomock.Any(), gomock.Any()).Return(allowed, foothold, nil)
		return stmts
	}

	t.Run("grants answer first and the operator path is not asked", func(t *testing.T) {
		stmts := setup(t, true, true)
		d, path, err := resolver.New().CheckPath(t.Context(), stmts, operator)
		require.NoError(t, err)
		assert.Equal(t, resolver.DecisionAllow, d)
		assert.Equal(t, resolver.PathGrant, path)
	})

	t.Run("an operator is allowed where no grant reaches", func(t *testing.T) {
		stmts := setup(t, false, false)
		stmts.EXPECT().CheckPlatformOperator(gomock.Any(), asked).Return(true, nil)
		d, path, err := resolver.New().CheckPath(t.Context(), stmts, operator)
		require.NoError(t, err)
		assert.Equal(t, resolver.DecisionAllow, d)
		assert.Equal(t, resolver.PathPlatformOperator, path)
	})

	t.Run("anyone else keeps the grant answer", func(t *testing.T) {
		stmts := setup(t, false, true)
		stmts.EXPECT().CheckPlatformOperator(gomock.Any(), asked).Return(false, nil)
		d, path, err := resolver.New().CheckPath(t.Context(), stmts, operator)
		require.NoError(t, err)
		assert.Equal(t, resolver.DecisionForbidden, d)
		assert.Equal(t, resolver.PathNone, path)
	})

	ineligible := map[string]func(resolver.Request) resolver.Request{
		"no platform project": func(r resolver.Request) resolver.Request {
			r.PlatformProjectID = ""
			return r
		},
		"homed in another project": func(r resolver.Request) resolver.Request {
			r.HomeProjectID = "proj_customer"
			return r
		},
		"a project secret": func(r resolver.Request) resolver.Request {
			r.PrincipalType = domain.AuthzPrincipalTypeSKProj
			r.PrincipalID = "proj_platform"
			return r
		},
	}
	for name, change := range ineligible {
		t.Run(name+" never reaches the operator path", func(t *testing.T) {
			stmts := setup(t, false, false)
			// No CheckPlatformOperator expectation: gomock fails the test if it is asked.
			d, path, err := resolver.New().CheckPath(t.Context(), stmts, change(operator))
			require.NoError(t, err)
			assert.Equal(t, resolver.DecisionNotFound, d)
			assert.Equal(t, resolver.PathNone, path)
		})
	}

	t.Run("the answer is memoized with its path", func(t *testing.T) {
		stmts := setup(t, false, false)
		stmts.EXPECT().CheckPlatformOperator(gomock.Any(), asked).Return(true, nil).Times(1)
		r := resolver.New()
		for range 2 {
			d, path, err := r.CheckPath(t.Context(), stmts, operator)
			require.NoError(t, err)
			assert.Equal(t, resolver.DecisionAllow, d)
			assert.Equal(t, resolver.PathPlatformOperator, path)
		}
	})
}

func TestPlatformOperator(t *testing.T) {
	t.Parallel()

	req := resolver.Request{
		PrincipalType:     domain.AuthzPrincipalTypeUser,
		PrincipalID:       "user_op",
		HomeProjectID:     "proj_platform",
		PlatformProjectID: "proj_platform",
		ObjectType:        "project",
		Relation:          "viewer",
	}

	t.Run("asks storage without a target project", func(t *testing.T) {
		stmts := mocks.NewMockAuthzResolverStatements(gomock.NewController(t))
		stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
		stmts.EXPECT().CheckPlatformOperator(gomock.Any(), domain.AuthzPlatformCheckParams{
			CatalogID:         domain.SystemCatalogID,
			PlatformProjectID: "proj_platform",
			UserID:            "user_op",
			ObjectType:        "project",
			Relation:          "viewer",
		}).Return(true, nil)
		ok, err := resolver.New().PlatformOperator(t.Context(), stmts, req)
		require.NoError(t, err)
		assert.True(t, ok)
	})

	t.Run("answers no for a user homed elsewhere without asking", func(t *testing.T) {
		stmts := mocks.NewMockAuthzResolverStatements(gomock.NewController(t))
		other := req
		other.HomeProjectID = "proj_customer"
		ok, err := resolver.New().PlatformOperator(t.Context(), stmts, other)
		require.NoError(t, err)
		assert.False(t, ok)
	})

	t.Run("refuses an incomplete request", func(t *testing.T) {
		stmts := mocks.NewMockAuthzResolverStatements(gomock.NewController(t))
		missing := req
		missing.Relation = ""
		_, err := resolver.New().PlatformOperator(t.Context(), stmts, missing)
		assert.Error(t, err)
	})
}
