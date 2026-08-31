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
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
)

type stubProjectService struct {
	created *domain.Project
}

func (s stubProjectService) Create(context.Context, string, []string, bool) (*domain.Project, error) {
	return s.created, nil
}
func (s stubProjectService) CreateWithID(context.Context, string, string, []string, bool) (*domain.Project, error) {
	return s.created, nil
}
func (stubProjectService) Get(context.Context, string) (*domain.Project, error) {
	return nil, domain.ErrProjectNotFound()
}
func (stubProjectService) DefaultProject(context.Context, string) (*domain.Project, error) {
	return nil, nil
}
func (stubProjectService) Update(context.Context, string, string) (*domain.Project, error) {
	return nil, domain.ErrProjectNotFound()
}
func (stubProjectService) List(context.Context, service.ListProjectsRequest) (*service.ListProjectsResponse, error) {
	return nil, domain.ErrProjectMissingID()
}
func (stubProjectService) Delete(context.Context, string) error { return nil }

var _ service.ProjectService = stubProjectService{}

// Every public project error code must map to its documented HTTP status, so a
// handler returning one of these sentinels produces the status the OpenAPI
// contract advertises rather than falling through to 500.
func TestProjectErrorResponse(t *testing.T) {
	tests := []struct {
		name string
		err  domain.Error
		want int
	}{
		{"not_found", domain.ErrProjectNotFound(), http.StatusNotFound},
		{"permission_denied", domain.ErrProjectPermissionDenied(), http.StatusForbidden},
		{"name_invalid", domain.ErrProjectNameInvalid(), http.StatusBadRequest},
		{"missing_id", domain.ErrProjectMissingID(), http.StatusBadRequest},
		{"already_claimed", domain.ErrProjectAlreadyClaimed(), http.StatusConflict},
		{"claim_expired", domain.ErrProjectClaimExpired(), http.StatusGone},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := projectErrorResponse(tt.err); got.StatusCode != tt.want {
				t.Fatalf("projectErrorResponse(%q) status = %d, want %d", tt.err.Code, got.StatusCode, tt.want)
			}
		})
	}
}

func TestCreateProject_StampsActorSlot(t *testing.T) {
	ctrl := gomock.NewController(t)
	tokens := servicemocks.NewMockTokenService(ctrl)
	now := time.Now().UTC()
	tokens.EXPECT().GenerateJWE(gomock.Any(), gomock.Any()).Return("jwe_proj", nil)
	tokens.EXPECT().GenerateJWE(gomock.Any(), gomock.Any()).Return("jwe_prev", nil)

	h := Handler{
		projectService: stubProjectService{created: &domain.Project{
			ID:        "proj_new",
			Name:      "Acme",
			CreatedAt: now,
		}},
		tokenService: tokens,
	}
	ctx := audit.WithActorSlot(t.Context())
	ctx = middleware.WithRequestIDContext(ctx, "req_create")

	res, err := h.CreateProject(ctx, &api.CreateProjectRequest{Name: "Acme"})
	require.NoError(t, err)
	got, ok := res.(*api.CreateProjectResponse)
	require.True(t, ok)
	assert.Equal(t, "proj_new", got.ID)

	slot, ok := audit.ActorSlotFromContext(ctx)
	require.True(t, ok)
	assert.Equal(t, "proj_new", slot.ProjectID)
	require.NotNil(t, slot.RequestID)
	assert.Equal(t, "req_create", *slot.RequestID)
	assert.False(t, slot.Authenticated)
}
