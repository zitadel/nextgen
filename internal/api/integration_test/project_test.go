//go:build postgres_integration || spanner_integration

package integration_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// stubFlowService satisfies [service.FlowService] while doing nothing.
type stubFlowService struct{}

func (stubFlowService) Resolve(_ context.Context, _ service.ResolveFlowRequest) (*domain.FlowDefinition, error) {
	return nil, nil
}

func (stubFlowService) Start(_ context.Context, _ service.StartFlowRequest) (service.FlowStepResult, error) {
	return service.FlowStepResult{}, nil
}

func (stubFlowService) Submit(_ context.Context, _ service.SubmitFlowRequest) (service.FlowStepResult, error) {
	return service.FlowStepResult{}, nil
}

func (stubFlowService) GetStep(_ context.Context, _ service.GetFlowStepRequest) (service.FlowStepResult, error) {
	return service.FlowStepResult{}, nil
}

// stubAuthAttemptService satisfies [service.AuthAttemptService] while doing nothing.
type stubAuthAttemptService struct{}

// Create implements [service.AuthAttemptService].
func (s *stubAuthAttemptService) Create(ctx context.Context, input service.CreateAuthAttemptInput) (*domain.AuthAttempt, error) {
	return nil, nil
}

// GetByID implements [service.AuthAttemptService].
func (s *stubAuthAttemptService) GetByID(ctx context.Context, projectID string, attemptID string) (*domain.AuthAttempt, error) {
	return nil, nil
}

// Handoff implements [service.AuthAttemptService].
func (s *stubAuthAttemptService) Handoff(ctx context.Context, input service.HandoffInput) (*domain.AuthAttempt, error) {
	return nil, nil
}

// IssueChallenge implements [service.AuthAttemptService].
func (s *stubAuthAttemptService) IssueChallenge(ctx context.Context, input service.IssueChallengeInput) (*domain.AuthAttempt, error) {
	return nil, nil
}

// VerifyProof implements [service.AuthAttemptService].
func (s *stubAuthAttemptService) VerifyProof(ctx context.Context, input service.VerifyProofInput) (*domain.AuthAttempt, error) {
	return nil, nil
}

func (s *stubAuthAttemptService) RegisterCreatedUser(ctx context.Context, projectID, attemptID, userID string) error {
	return nil
}

var _ service.AuthAttemptService = (*stubAuthAttemptService)(nil)

func TestCreateProject(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		tcs := []struct {
			name string
			req  *api.CreateProjectRequest
		}{
			{
				name: "no optional fields",
				req: &api.CreateProjectRequest{
					PreviewOrigins: make([]string, 0),
				},
			},
			{
				name: "with optional fields",
				req: &api.CreateProjectRequest{
					PreviewOrigins: []string{"*.vercel.app", "*.netlify.app"},
				},
			},
		}

		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				client := harness.EnsureAnonymousAPIClient(t)

				resp, err := client.CreateProject(t.Context(), tc.req)

				assert.NoError(t, err)
				if (assert.IsType(t, &api.CreateProjectResponse{}, resp, helpers.MustMarshal(t, resp))) {
					got := resp.(*api.CreateProjectResponse)
					assert.NotEmpty(t, got.ID)
					assert.NotEmpty(t, got.ProjectSecret)
					assert.NotEmpty(t, got.PreviewSecret)
					assert.Equal(t, tc.req.PreviewOrigins, got.PreviewOrigins)
				}
			})
		}
	})
}

func TestGetProject(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
		client := harness.EnsureAPIClient(t, project.ID)
		require.NoError(t, err)

		params := api.GetProjectParams{
			ProjectID: api.ProjectID(project.ID),
		}

		resp, err := client.GetProject(t.Context(), params)

		assert.NoError(t, err)
		if assert.IsType(t, &api.GetProjectResponse{}, resp, helpers.MustMarshal(t, resp)) {
			got := resp.(*api.GetProjectResponse)
			assert.NotEmpty(t, got.CreatedAt)
			assert.NotEmpty(t, got.UpdatedAt)
			assert.Equal(t, project.ID, got.ID)
		}
	})

	t.Run("error", func(t *testing.T) {
		t.Run("not found", func(t *testing.T) {
			project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)

			client := harness.EnsureAPIClient(t, project.ID)

			params := api.GetProjectParams{
				ProjectID: "does_not_exist",
			}

			resp, err := client.GetProject(t.Context(), params)

			assert.NoError(t, err)
			assert.IsType(t, &api.GetProjectNotFound{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}
