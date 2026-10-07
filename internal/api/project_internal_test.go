package api

import (
	"context"
	"net/http"
	"reflect"
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
func (stubProjectService) OwningTeamID(context.Context, string) (string, error) {
	return "", nil
}
func (stubProjectService) DefaultProject(context.Context, string) (*domain.Project, error) {
	return nil, nil
}
func (stubProjectService) Update(context.Context, service.UpdateProjectRequest) (*domain.Project, error) {
	return nil, domain.ErrProjectNotFound()
}
func (stubProjectService) List(context.Context, service.ListProjectsRequest) (*service.ListProjectsResponse, error) {
	return nil, domain.ErrProjectMissingID()
}
func (stubProjectService) ListAuthorized(context.Context, service.ListAuthorizedProjectsRequest) (*service.ListProjectsResponse, error) {
	return nil, domain.ErrSessionTokenInvalid()
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
		{"claim_window_expired", domain.ErrProjectClaimWindowExpired(), http.StatusGone},
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

// TestProjectDetailResponseCarriesProjectResponse keeps the two project bodies
// in step: every field projectResponse sets must reach projectDetailResponse
// with the same value, so a field added to one cannot be left out of the
// other. The fixture fills every field, which the first check enforces.
func TestProjectDetailResponseCarriesProjectResponse(t *testing.T) {
	now := time.Now()
	project := &domain.Project{
		ID:             "proj_detail",
		Name:           "Acme",
		PreviewOrigins: []string{"https://preview.example.com"},
		CreatedAt:      now.Add(-time.Hour),
		UpdatedAt:      now,
		PasswordHashPolicy: &domain.PasswordHashPolicy{
			Algorithm: "bcrypt",
			Params:    map[string]any{"cost": float64(10)},
		},
	}
	base := reflect.ValueOf(*projectResponse(project))
	detail := reflect.ValueOf(*projectDetailResponse(project, "team_owner"))
	for i := range base.NumField() {
		name := base.Type().Field(i).Name
		require.False(t, base.Field(i).IsZero(), "the fixture must set %s so the comparison covers it", name)
		got := detail.FieldByName(name)
		require.True(t, got.IsValid(), "ProjectDetailResponse has no field %s", name)
		assert.Equal(t, base.Field(i).Interface(), got.Interface(), "projectDetailResponse must copy %s", name)
	}
	assert.Equal(t, api.NewNilTeamID("team_owner"), detail.FieldByName("OwningTeamID").Interface())
	assert.True(t, projectDetailResponse(project, "").OwningTeamID.IsNull(), "no owning team is null")
}
