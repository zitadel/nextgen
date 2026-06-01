//go:build integration || spanner_integration

package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	generatedapi "github.com/zitadel/nextgen/api/generated"
	internalapi "github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

// newTestServer starts an httptest.Server backed by the real handler + repository.
// The server is stopped via t.Cleanup.
func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()

	repo := repository.NewProjectRepository(testPool)
	projectSvc := service.NewProjectService(testPool, repo, idgen.NewULID())

	handler := internalapi.NewHandler(nil, stubFlowService{}, &stubAuthAttemptService{}, nil, projectSvc, nil, nil, nil)
	secHandler := internalapi.NewSecurityHandler()

	srv, err := generatedapi.NewServer(handler, secHandler)
	require.NoError(t, err)

	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return ts
}

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

var _ service.AuthAttemptService = (*stubAuthAttemptService)(nil)

func TestCreateProject(t *testing.T) {
	ts := newTestServer(t)

	tests := []struct {
		name        string
		body        map[string]any
		wantStatus  int
		wantOrigins []string
	}{
		{
			name:        "no preview origins",
			body:        map[string]any{},
			wantStatus:  http.StatusCreated,
			wantOrigins: []string{},
		},
		{
			name:        "with preview origins",
			body:        map[string]any{"preview_origins": []string{"*.vercel.app", "*.netlify.app"}},
			wantStatus:  http.StatusCreated,
			wantOrigins: []string{"*.vercel.app", "*.netlify.app"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			bodyBytes, err := json.Marshal(tc.body)
			require.NoError(t, err)

			resp, err := http.Post(ts.URL+"/projects", "application/json", bytes.NewReader(bodyBytes))
			require.NoError(t, err)
			defer resp.Body.Close()

			require.Equal(t, tc.wantStatus, resp.StatusCode)

			var got map[string]any
			require.NoError(t, json.NewDecoder(resp.Body).Decode(&got))

			assert.NotEmpty(t, got["project_id"], "project_id should be non-empty")
			assert.NotEmpty(t, got["project_secret"], "project_secret should be non-empty")
			assert.NotEmpty(t, got["preview_secret"], "preview_secret should be non-empty")
			assert.Equal(t, "unclaimed", got["lifecycle"])
			assert.Equal(t, []any{"preview", "production"}, got["claim_required_for"])

			originsRaw, ok := got["preview_origins"].([]any)
			require.True(t, ok, "preview_origins should be an array")
			origins := make([]string, len(originsRaw))
			for i, o := range originsRaw {
				origins[i] = o.(string)
			}
			assert.Equal(t, tc.wantOrigins, origins)
		})
	}
}

func TestGetProject(t *testing.T) {
	ts := newTestServer(t)

	t.Run("existing project", func(t *testing.T) {
		// Create a project first.
		resp, err := http.Post(ts.URL+"/projects", "application/json", bytes.NewReader([]byte("{}")))
		require.NoError(t, err)
		defer resp.Body.Close()
		require.Equal(t, http.StatusCreated, resp.StatusCode)

		var created map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
		id := created["project_id"].(string)

		// GET the project using the project secret as bearer token.
		req, err := http.NewRequest(http.MethodGet, ts.URL+"/projects/"+id, nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer "+created["project_secret"].(string))

		client := &http.Client{}
		getResp, err := client.Do(req)
		require.NoError(t, err)
		defer getResp.Body.Close()

		assert.Equal(t, http.StatusOK, getResp.StatusCode)

		var got map[string]any
		require.NoError(t, json.NewDecoder(getResp.Body).Decode(&got))
		assert.Equal(t, id, got["project_id"])
		assert.Equal(t, "unclaimed", got["lifecycle"])
		assert.NotEmpty(t, got["created_at"])
		assert.NotEmpty(t, got["updated_at"])
	})

	t.Run("unauthorized — token for another project", func(t *testing.T) {
		resp, err := http.Post(ts.URL+"/projects", "application/json", bytes.NewReader([]byte("{}")))
		require.NoError(t, err)
		defer resp.Body.Close()
		require.Equal(t, http.StatusCreated, resp.StatusCode)

		var first map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&first))
		id := first["project_id"].(string)

		resp, err = http.Post(ts.URL+"/projects", "application/json", bytes.NewReader([]byte("{}")))
		require.NoError(t, err)
		defer resp.Body.Close()
		require.Equal(t, http.StatusCreated, resp.StatusCode)

		var second map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&second))

		req, err := http.NewRequest(http.MethodGet, ts.URL+"/projects/"+id, nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer "+second["project_secret"].(string))

		client := &http.Client{}
		getResp, err := client.Do(req)
		require.NoError(t, err)
		defer getResp.Body.Close()

		assert.Equal(t, http.StatusUnauthorized, getResp.StatusCode)
	})

	t.Run("not found", func(t *testing.T) {
		req, err := http.NewRequest(http.MethodGet, ts.URL+"/projects/proj_doesnotexist", nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer sk_proj_doesnotexist")

		client := &http.Client{}
		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	})

	t.Run("unauthorized — missing token", func(t *testing.T) {
		resp, err := http.Get(ts.URL + "/projects/some-id")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})
}

func TestCreateProject_IdempotencyKey(t *testing.T) {
	ts := newTestServer(t)

	body := []byte(`{"preview_origins":["*.vercel.app"]}`)
	req, err := http.NewRequest(http.MethodPost, ts.URL+"/projects", bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "same-key")

	client := &http.Client{}
	first, err := client.Do(req)
	require.NoError(t, err)
	defer first.Body.Close()
	require.Equal(t, http.StatusCreated, first.StatusCode)

	var firstBody map[string]any
	require.NoError(t, json.NewDecoder(first.Body).Decode(&firstBody))

	req, err = http.NewRequest(http.MethodPost, ts.URL+"/projects", bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "same-key")
	second, err := client.Do(req)
	require.NoError(t, err)
	defer second.Body.Close()
	require.Equal(t, http.StatusCreated, second.StatusCode)

	var secondBody map[string]any
	require.NoError(t, json.NewDecoder(second.Body).Decode(&secondBody))
	assert.Equal(t, firstBody["project_id"], secondBody["project_id"])
}

func TestProjectClaimFlow(t *testing.T) {
	ts := newTestServer(t)
	client := &http.Client{}

	resp, err := http.Post(ts.URL+"/projects", "application/json", bytes.NewReader([]byte("{}")))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	var created map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
	projectID := created["project_id"].(string)
	projectSecret := created["project_secret"].(string)

	req, err := http.NewRequest(http.MethodPatch, ts.URL+"/projects/"+projectID+"/config?environment=preview", bytes.NewReader([]byte("{}")))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+projectSecret)
	req.Header.Set("Content-Type", "application/json")
	rejected, err := client.Do(req)
	require.NoError(t, err)
	defer rejected.Body.Close()
	assert.Equal(t, http.StatusConflict, rejected.StatusCode)

	req, err = http.NewRequest(http.MethodPatch, ts.URL+"/projects/"+projectID+"/config?environment=development", bytes.NewReader([]byte("{}")))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer sk_proj_wrong")
	req.Header.Set("Content-Type", "application/json")
	unauthorized, err := client.Do(req)
	require.NoError(t, err)
	defer unauthorized.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, unauthorized.StatusCode)

	req, err = http.NewRequest(http.MethodPost, ts.URL+"/projects/"+projectID+"/claim/init", bytes.NewReader([]byte("{}")))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+projectSecret)
	req.Header.Set("Content-Type", "application/json")
	initResp, err := client.Do(req)
	require.NoError(t, err)
	defer initResp.Body.Close()
	require.Equal(t, http.StatusCreated, initResp.StatusCode)

	var initBody map[string]any
	require.NoError(t, json.NewDecoder(initResp.Body).Decode(&initBody))
	challengeID := initBody["challenge_id"].(string)

	completeBody := []byte(`{"challenge_id":"` + challengeID + `","team_choice":{"create_team_name":"Acme"}}`)
	req, err = http.NewRequest(http.MethodPost, ts.URL+"/projects/"+projectID+"/claim/complete", bytes.NewReader(completeBody))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+projectSecret)
	req.Header.Set("Content-Type", "application/json")
	completeResp, err := client.Do(req)
	require.NoError(t, err)
	defer completeResp.Body.Close()
	require.Equal(t, http.StatusOK, completeResp.StatusCode)

	req, err = http.NewRequest(http.MethodGet, ts.URL+"/projects/"+projectID+"/claim/status?challenge_id="+challengeID, nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+projectSecret)
	statusResp, err := client.Do(req)
	require.NoError(t, err)
	defer statusResp.Body.Close()
	require.Equal(t, http.StatusOK, statusResp.StatusCode)

	var statusBody map[string]any
	require.NoError(t, json.NewDecoder(statusResp.Body).Decode(&statusBody))
	assert.Equal(t, "completed", statusBody["status"])
	assert.NotEmpty(t, statusBody["rotated_project_secret"])

	req, err = http.NewRequest(http.MethodGet, ts.URL+"/projects/"+projectID+"/claim/status?challenge_id="+challengeID, nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+projectSecret)
	consumedResp, err := client.Do(req)
	require.NoError(t, err)
	defer consumedResp.Body.Close()
	assert.Equal(t, http.StatusGone, consumedResp.StatusCode)
}
