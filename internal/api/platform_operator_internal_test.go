package api

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

const testPlatformProject = "proj_platform"

// operatorScope is the Console session of a user homed in the platform
// project, as HandleNextgenSession mints it (ADR 075).
var operatorScope = ScopeContext{
	ProjectID:         testPlatformProject,
	PrincipalType:     domain.AuthzPrincipalTypeUser,
	PrincipalID:       "user_op",
	PlatformProjectID: testPlatformProject,
}

func TestHandleNextgenSession_PlatformProject(t *testing.T) {
	t.Parallel()

	scopeOf := func(t *testing.T, handler *SecurityHandler, tokens *servicemocks.MockTokenService, homeProjectID string) ScopeContext {
		t.Helper()
		tokens.EXPECT().IntrospectToken(gomock.Any(), "raw-cookie").Return(&domain.Token{
			ProjectID: homeProjectID,
			TokenID:   "token-1",
			UserID:    "user-1",
			Type:      domain.TokenTypeSessionToken,
			SessionID: new("session-1"),
		}, nil)
		ctx, err := handler.HandleNextgenSession(safeRequestContext(t), api.GetMySessionOperation, api.NextgenSession{APIKey: "raw-cookie"})
		require.NoError(t, err)
		scope, ok := GetScopeContext(ctx)
		require.True(t, ok)
		return scope
	}

	t.Run("a session homed in the platform project carries it", func(t *testing.T) {
		t.Parallel()
		tokens := servicemocks.NewMockTokenService(gomock.NewController(t))
		handler := NewSecurityHandler(tokens).WithPlatformProject(testPlatformProject)
		assert.Equal(t, testPlatformProject, scopeOf(t, handler, tokens, testPlatformProject).PlatformProjectID)
	})

	t.Run("a session homed anywhere else does not", func(t *testing.T) {
		t.Parallel()
		tokens := servicemocks.NewMockTokenService(gomock.NewController(t))
		handler := NewSecurityHandler(tokens).WithPlatformProject(testPlatformProject)
		assert.Empty(t, scopeOf(t, handler, tokens, "proj_customer").PlatformProjectID)
	})

	t.Run("without a platform project nobody does", func(t *testing.T) {
		t.Parallel()
		tokens := servicemocks.NewMockTokenService(gomock.NewController(t))
		assert.Empty(t, scopeOf(t, NewSecurityHandler(tokens), tokens, testPlatformProject).PlatformProjectID)
	})

	t.Run("a project secret of the platform project never does", func(t *testing.T) {
		t.Parallel()
		tokens := servicemocks.NewMockTokenService(gomock.NewController(t))
		tokens.EXPECT().IntrospectToken(gomock.Any(), "raw-bearer").Return(&domain.Token{
			ProjectID: testPlatformProject,
			TokenID:   "token-1",
			Type:      domain.TokenTypeProjectToken,
			Scope:     []string{"project.write", "project.read"},
		}, nil)
		handler := NewSecurityHandler(tokens).WithPlatformProject(testPlatformProject)
		ctx, err := handler.HandleOAuth2(t.Context(), api.QueryProjectsOperation, api.OAuth2{Token: "raw-bearer"})
		require.NoError(t, err)
		scope, ok := GetScopeContext(ctx)
		require.True(t, ok)
		assert.Empty(t, scope.PlatformProjectID)
	})
}

func TestCheckProjectAccess_PlatformOperator(t *testing.T) {
	t.Parallel()

	request := func(t *testing.T, scope ScopeContext) context.Context {
		t.Helper()
		return WithScopeContext(audit.WithActorSlot(t.Context()), scope)
	}

	t.Run("an operator is allowed where no grant reaches, and the request is marked", func(t *testing.T) {
		t.Parallel()
		var asked []domain.AuthzPlatformCheckParams
		stmts := stubAuthzStmts{allowCheck: new(false), foothold: new(false), operator: true, operatorAsked: &asked}
		ctx := request(t, operatorScope)

		require.NoError(t, requireProjectAccess(ctx, stmts, "proj_customer", projectAccess, opWrite))
		assert.Equal(t, []domain.AuthzPlatformCheckParams{{
			CatalogID:         domain.SystemCatalogID,
			PlatformProjectID: testPlatformProject,
			UserID:            "user_op",
			ObjectType:        "project",
			Relation:          "editor",
		}}, asked)

		ev := audit.FromContext(ctx, domain.EventTypeAuthzGranted, domain.EventCategoryAdmin)
		assert.JSONEq(t, `{"authorization":{"path":"platform_operator","actor_home_project_id":"proj_platform"}}`, string(ev.Metadata))
	})

	t.Run("a grant is not marked", func(t *testing.T) {
		t.Parallel()
		stmts := stubAuthzStmts{allowCheck: new(true), foothold: new(true), operator: true}
		ctx := request(t, operatorScope)

		require.NoError(t, requireProjectAccess(ctx, stmts, "proj_customer", projectAccess, opRead))
		slot, ok := audit.ActorSlotFromContext(ctx)
		require.True(t, ok)
		assert.Nil(t, slot.Authorization)
	})

	t.Run("anyone else keeps the ordinary miss", func(t *testing.T) {
		t.Parallel()
		stmts := stubAuthzStmts{allowCheck: new(false), foothold: new(false)}
		ctx := request(t, operatorScope)

		err := requireProjectAccess(ctx, stmts, "proj_customer", projectAccess, opRead)
		assertDomainCode(t, err, domain.ErrProjectNotFound().Code)
		slot, ok := audit.ActorSlotFromContext(ctx)
		require.True(t, ok)
		assert.Nil(t, slot.Authorization)
	})

	t.Run("a session homed elsewhere never reaches the operator path", func(t *testing.T) {
		t.Parallel()
		var asked []domain.AuthzPlatformCheckParams
		stmts := stubAuthzStmts{allowCheck: new(false), foothold: new(false), operator: true, operatorAsked: &asked}
		customer := operatorScope
		customer.ProjectID = "proj_other"
		customer.PlatformProjectID = ""

		err := requireProjectAccess(request(t, customer), stmts, "proj_customer", projectAccess, opRead)
		assertDomainCode(t, err, domain.ErrProjectNotFound().Code)
		assert.Empty(t, asked)
	})
}

// operatorHandler is a Handler whose statements answer the platform operator
// question with operator, and whose project service is projects.
func operatorHandler(t *testing.T, operator *bool) (Handler, *servicemocks.MockProjectService) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	if operator != nil {
		stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
		stmts.EXPECT().CheckPlatformOperator(gomock.Any(), domain.AuthzPlatformCheckParams{
			CatalogID:         domain.SystemCatalogID,
			PlatformProjectID: testPlatformProject,
			UserID:            "user_op",
			ObjectType:        "project",
			Relation:          "viewer",
		}).Return(*operator, nil)
	}
	projects := servicemocks.NewMockProjectService(ctrl)
	return Handler{pool: service.NewPool(pool), projectService: projects}, projects
}

func TestQueryProjects_Session(t *testing.T) {
	t.Parallel()

	t.Run("an operator searches every project", func(t *testing.T) {
		t.Parallel()
		h, projects := operatorHandler(t, new(true))
		projects.EXPECT().List(gomock.Any(), gomock.Any()).DoAndReturn(
			func(_ context.Context, req service.ListProjectsRequest) (*service.ListProjectsResponse, error) {
				assert.True(t, req.AllProjects)
				assert.Empty(t, req.ProjectID)
				return &service.ListProjectsResponse{Projects: []*domain.Project{{ID: "proj_a"}, {ID: "proj_b"}}}, nil
			})
		ctx := WithScopeContext(audit.WithActorSlot(t.Context()), operatorScope)

		res, err := h.QueryProjects(ctx, &api.QueryProjectsRequest{})
		require.NoError(t, err)
		resp, ok := res.(*api.QueryProjectsResponse)
		require.True(t, ok, "got %T", res)
		require.Len(t, resp.Projects, 2)
		assert.Equal(t, "proj_a", resp.Projects[0].ID)

		slot, ok := audit.ActorSlotFromContext(ctx)
		require.True(t, ok)
		require.NotNil(t, slot.Authorization)
		assert.Equal(t, domain.EventAuthorizationPathPlatformOperator, slot.Authorization.Path)
	})

	t.Run("any other platform session is refused", func(t *testing.T) {
		t.Parallel()
		h, _ := operatorHandler(t, new(false))
		_, err := h.QueryProjects(WithScopeContext(t.Context(), operatorScope), &api.QueryProjectsRequest{})
		assertDomainCode(t, err, domain.ErrProjectPermissionDenied().Code)
	})

	t.Run("a session homed elsewhere is refused without asking", func(t *testing.T) {
		t.Parallel()
		h, _ := operatorHandler(t, nil)
		customer := operatorScope
		customer.ProjectID = "proj_customer"
		customer.PlatformProjectID = ""
		_, err := h.QueryProjects(WithScopeContext(t.Context(), customer), &api.QueryProjectsRequest{})
		assertDomainCode(t, err, domain.ErrProjectPermissionDenied().Code)
	})
}

func TestGetMyPlatformAccess(t *testing.T) {
	t.Parallel()

	session := func(t *testing.T, scope ScopeContext) context.Context {
		t.Helper()
		ctx := context.WithValue(t.Context(), sessionTokenKey{}, &domain.Token{
			Type:      domain.TokenTypeSessionToken,
			ProjectID: scope.ProjectID,
			UserID:    scope.PrincipalID,
			SessionID: new("sess_1"),
			TokenID:   "tkn_1",
		})
		return WithScopeContext(ctx, scope)
	}
	relations := func(t *testing.T, res api.GetMyPlatformAccessRes) []api.PlatformAccessResponseRelationsItem {
		t.Helper()
		resp, ok := res.(*api.PlatformAccessResponseHeaders)
		require.True(t, ok, "got %T", res)
		assert.Equal(t, sessionStateCacheControl, resp.CacheControl.Value)
		return resp.Response.Relations
	}

	t.Run("an operator", func(t *testing.T) {
		t.Parallel()
		h, _ := operatorHandler(t, new(true))
		res, err := h.GetMyPlatformAccess(session(t, operatorScope), api.GetMyPlatformAccessParams{})
		require.NoError(t, err)
		assert.Equal(t, []api.PlatformAccessResponseRelationsItem{api.PlatformAccessResponseRelationsItemOperator}, relations(t, res))
	})

	t.Run("anyone else gets an empty list", func(t *testing.T) {
		t.Parallel()
		h, _ := operatorHandler(t, new(false))
		res, err := h.GetMyPlatformAccess(session(t, operatorScope), api.GetMyPlatformAccessParams{})
		require.NoError(t, err)
		assert.Empty(t, relations(t, res))
	})

	t.Run("a user homed elsewhere is answered without asking", func(t *testing.T) {
		t.Parallel()
		h, _ := operatorHandler(t, nil)
		customer := operatorScope
		customer.ProjectID = "proj_customer"
		customer.PlatformProjectID = ""
		res, err := h.GetMyPlatformAccess(session(t, customer), api.GetMyPlatformAccessParams{})
		require.NoError(t, err)
		assert.Empty(t, relations(t, res))
	})
}
