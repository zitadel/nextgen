package api

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

func TestDeploymentErrorResponseStatuses(t *testing.T) {
	cases := []struct {
		err    domain.Error
		status int
	}{
		{domain.ErrDeploymentNotFound(), http.StatusNotFound},
		{domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}), http.StatusConflict},
		{domain.ErrDeploymentInvalid().WithMessage("bad"), http.StatusBadRequest},
		{domain.ErrDeploymentVariablesMissing(domain.DeploymentOriginKindPrimary, []string{"GONE"}), http.StatusBadRequest},
		{domain.ErrDeploymentPermissionDenied(), http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.err.Code, func(t *testing.T) {
			resp := deploymentErrorResponse(tc.err)
			assert.Equal(t, tc.status, resp.StatusCode)
		})
	}
}

// The 409 exists so the caller can retry on top of what actually runs, which
// only works if details.deployment reaches the caller. Nothing deployed yet
// is a null deployment rather than a dropped key.
func TestDeploymentConflictCarriesDetails(t *testing.T) {
	resp, ok := deploymentConflictResponse(domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}))
	require.True(t, ok)
	body := resp.DeploymentGuardConflict
	assert.Equal(t, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code, body.Code)
	assert.True(t, body.Details.Deployment.Null)
}

// A conflict renders the deployment in the API's shape, kind and status
// included.
func TestDeploymentConflictRendersTheDeployment(t *testing.T) {
	newest := &domain.Deployment{
		ProjectID:  "proj_1",
		ID:         "dep_1",
		ReleaseID:  "rel_1",
		OriginKind: domain.DeploymentOriginKindPrimary,
		Targets:    []domain.DeploymentTarget{{Origin: "https://app.acme.com"}},
		DeployedAt: time.Date(2026, 10, 2, 14, 52, 0, 0, time.UTC),
		Metadata: domain.DeploymentMetadata{
			Reason:         domain.DeploymentReasonRollback,
			RollbackTo:     new("dep_0"),
			DeployedByType: new(domain.EventActorTypeService),
		},
	}
	resp, ok := deploymentConflictResponse(domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{Deployment: newest}))
	require.True(t, ok)
	assert.Equal(t, api.NewNilDeployment(api.Deployment{
		ID:         "dep_1",
		ProjectID:  "proj_1",
		ReleaseID:  "rel_1",
		Kind:       api.DeploymentKindPrimary,
		Targets:    []api.DeploymentTarget{{Origin: "https://app.acme.com"}},
		Status:     api.DeploymentStatusLive,
		DeployedAt: time.Date(2026, 10, 2, 14, 52, 0, 0, time.UTC),
		Metadata: api.DeploymentMetadata{
			Reason:         api.DeploymentReasonRollback,
			RollbackTo:     api.NewOptNilDeploymentID("dep_0"),
			DeployedByType: api.NewOptNilDeploymentMetadataDeployedByType(api.DeploymentMetadataDeployedByTypeService),
		},
	}), resp.DeploymentGuardConflict.Details.Deployment)
}

func TestDeploymentTargetRendersTheDefaultToken(t *testing.T) {
	newest := &domain.Deployment{
		ProjectID:  "proj_1",
		ID:         "dep_1",
		ReleaseID:  "rel_1",
		OriginKind: domain.DeploymentOriginKindPrimary,
		Targets:    []domain.DeploymentTarget{{Origin: domain.DefaultTargetOrigin}},
		DeployedAt: time.Date(2026, 10, 2, 14, 52, 0, 0, time.UTC),
		Metadata:   domain.DeploymentMetadata{Reason: domain.DeploymentReasonDeploy},
	}
	resp, ok := deploymentConflictResponse(domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{Deployment: newest}))
	require.True(t, ok)
	require.Len(t, resp.DeploymentGuardConflict.Details.Deployment.Value.Targets, 1)
	assert.Equal(t, "default", string(resp.DeploymentGuardConflict.Details.Deployment.Value.Targets[0].Origin))
}

// A revoked release is the other member of the 409 union.
func TestDeploymentConflictRendersARevokedRelease(t *testing.T) {
	resp, ok := deploymentConflictResponse(domain.ErrReleaseRevoked())
	require.True(t, ok)
	assert.Equal(t, api.ReleaseRevokedConflictDeploymentConflict, resp.Type)
	assert.Equal(t, domain.ErrReleaseRevoked().Code, resp.ReleaseRevokedConflict.Code)
}

// The 400 names the kind and every missing variable on details, sorted.
func TestDeploymentVariablesMissingResponse(t *testing.T) {
	err := domain.ErrDeploymentVariablesMissing(domain.DeploymentOriginKindPreview, []string{"GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_ID"})
	resp, ok := deploymentVariablesMissingResponse(err)
	require.True(t, ok)
	body, isMissing := resp.GetDeploymentVariablesMissing()
	require.True(t, isMissing)
	assert.Equal(t, err.Code, body.Code)
	assert.Equal(t, err.Message, body.Message)
	assert.Equal(t, api.DeploymentVariablesMissingDetails{
		Kind:  api.DeploymentKindPreview,
		Names: []string{"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"},
	}, body.Details)
}

func TestDeploymentVariablesMissingResponseIgnoresOtherErrors(t *testing.T) {
	_, ok := deploymentVariablesMissingResponse(domain.ErrDeploymentInvalid())
	assert.False(t, ok)
}

// Any other error is left to NewError.
func TestDeploymentConflictResponseIgnoresOtherErrors(t *testing.T) {
	_, ok := deploymentConflictResponse(domain.ErrDeploymentNotFound())
	assert.False(t, ok)
}

// The explanation is the message, so the body matches the contract.
func TestDeploymentInvalidCarriesItsExplanationAsMessage(t *testing.T) {
	resp := deploymentErrorResponse(domain.ErrDeploymentInvalid().WithMessage("ttl is only valid for preview URLs"))
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	assert.Equal(t, "ttl is only valid for preview URLs", resp.Response.Message)
	assert.False(t, resp.Response.Details.Set)
}

// Pins the deployment resource-flavored answers through the resolver gate,
// like TestReleaseAccessRow: a foreign-project write reports the project as
// missing and a read reports the deployment as missing, so neither confirms
// the other project exists.
func TestDeploymentAccessRow(t *testing.T) {
	stmts := stubAuthzStmts{}
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_a",
		Scope:         []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_a",
	})

	require.NoError(t, requireProjectAccess(operator, stmts, "proj_a", deploymentAccess, opWrite))
	require.NoError(t, requireProjectAccess(operator, stmts, "proj_a", deploymentAccess, opRead))

	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", deploymentAccess, opWrite),
		domain.ErrEnvironmentProjectNotFound().Code)
	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", deploymentAccess, opRead),
		domain.ErrDeploymentNotFound().Code)

	// A foothold without a project-wide read is Forbidden, which this gate
	// answers as permission denied. The handler that chooses the gate is
	// TestListPreviewsRefusesAPartialGrant.
	member := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_platform",
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   "user_alice",
	})
	assertDomainCode(t,
		requireProjectAccess(member, stubAuthzStmts{allowCheck: new(false), foothold: new(true)}, "proj_a", deploymentAccess, opRead),
		domain.ErrDeploymentPermissionDenied().Code)
}

// A partial grant must not reach the preview list. The list cannot apply the
// row filter requireProjectListAccess would attach, so the handler refuses
// before it asks the service.
func TestListPreviewsRefusesAPartialGrant(t *testing.T) {
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil)
	stmts.EXPECT().CheckAuthz(gomock.Any(), gomock.Any()).Return(false, true, nil)

	svcPool := servicemocks.NewMockPool(ctrl)
	svcStmts := servicemocks.NewMockAllStatements(ctrl)
	svcPool.EXPECT().Statements().Return(svcStmts).AnyTimes()

	db := service.NewPool(svcPool)
	h := Handler{
		pool:              service.NewPool(pool),
		deploymentService: service.NewDeploymentService(db, service.NewVariableService(db, servicemocks.NewMockKeyService(ctrl))),
	}
	member := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_platform",
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   "user_alice",
	})

	_, err := h.ListPreviews(member, api.ListPreviewsParams{ProjectID: "proj_a"})
	assertDomainCode(t, err, domain.ErrDeploymentPermissionDenied().Code)
}
