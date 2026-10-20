package api

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"go.uber.org/mock/gomock"
)

// runtimeAuthAttemptStub is a minimal AuthAttemptService for handler tests.
type runtimeAuthAttemptStub struct {
	lastCreate service.CreateAuthAttemptInput
}

func (s *runtimeAuthAttemptStub) Create(_ context.Context, in service.CreateAuthAttemptInput) (*domain.AuthAttempt, error) {
	s.lastCreate = in
	return &domain.AuthAttempt{
		ProjectID:    in.ProjectID,
		ID:           "att_1",
		CreatedAt:    time.Now().UTC(),
		TimeToLive:   new(domain.AuthAttemptTTL),
		DeploymentID: in.DeploymentID,
		ReleaseID:    in.ReleaseID,
	}, nil
}

func (s *runtimeAuthAttemptStub) GetByID(context.Context, string, string) (*domain.AuthAttempt, error) {
	return nil, domain.ErrAuthAttemptNotFound()
}
func (s *runtimeAuthAttemptStub) IssueChallenge(context.Context, service.IssueChallengeInput) (*domain.AuthAttempt, error) {
	return nil, domain.ErrAuthAttemptNotFound()
}
func (s *runtimeAuthAttemptStub) IssueSSOState(context.Context, service.IssueSSOStateInput) (*domain.SSOState, error) {
	return nil, domain.ErrAuthAttemptNotFound()
}
func (s *runtimeAuthAttemptStub) ConsumeSSOState(context.Context, string, string, string) (*domain.SSOCallbackCheck, error) {
	return nil, domain.ErrAuthAttemptNotFound()
}
func (s *runtimeAuthAttemptStub) SetSSOCallbackResult(context.Context, string, *domain.SSOCallbackCheck, *domain.SSOCallbackResult, domain.EventType) error {
	return domain.ErrAuthAttemptNotFound()
}
func (s *runtimeAuthAttemptStub) VerifyProof(context.Context, service.VerifyProofInput) (*domain.AuthAttempt, error) {
	return nil, domain.ErrAuthAttemptNotFound()
}
func (s *runtimeAuthAttemptStub) Handoff(context.Context, service.HandoffInput) (*domain.AuthAttempt, error) {
	return nil, domain.ErrAuthAttemptNotFound()
}
func (s *runtimeAuthAttemptStub) BeginPasskeyEnrollment(context.Context, service.BeginPasskeyEnrollmentInput) (*service.BeginPasskeyEnrollmentOutput, error) {
	return nil, domain.ErrAuthAttemptNotFound()
}
func (s *runtimeAuthAttemptStub) FinishPasskeyEnrollment(context.Context, service.FinishPasskeyEnrollmentInput) (*service.FinishPasskeyEnrollmentOutput, error) {
	return nil, domain.ErrAuthAttemptNotFound()
}

var _ service.AuthAttemptService = (*runtimeAuthAttemptStub)(nil)

func TestCreateAuthAttempt_ProjectMismatch(t *testing.T) {
	t.Parallel()

	h := Handler{}
	ctx := WithScopeContext(t.Context(), ScopeContext{ProjectID: "proj_secret"})
	_, err := h.CreateAuthAttempt(ctx, &api.CreateAuthAttemptRequest{
		ProjectID: api.ProjectID("proj_other"),
	})
	require.ErrorIs(t, err, domain.ErrProjectMismatch())
}

func TestCreateAuthAttempt_UsesCredentialProject(t *testing.T) {
	t.Parallel()

	attempts := &runtimeAuthAttemptStub{}
	h := Handler{authAttemptService: attempts}
	ctx := WithScopeContext(t.Context(), ScopeContext{ProjectID: "proj_secret"})
	res, err := h.CreateAuthAttempt(ctx, &api.CreateAuthAttemptRequest{
		ProjectID: api.ProjectID("proj_secret"),
	})
	require.NoError(t, err)
	require.IsType(t, &api.AuthAttemptResponse{}, res)
	require.Equal(t, "proj_secret", attempts.lastCreate.ProjectID)
}

func TestExchangeHandoff_ProjectMismatch(t *testing.T) {
	t.Parallel()

	h := Handler{}
	ctx := WithScopeContext(t.Context(), ScopeContext{ProjectID: "proj_secret"})
	_, err := h.ExchangeHandoff(ctx,
		&api.ExchangeRequest{HandoffToken: "handoff"},
		api.ExchangeHandoffParams{ProjectID: "proj_other"},
	)
	require.ErrorIs(t, err, domain.ErrProjectMismatch())
}

func TestWithSealedRuntime_Revoked(t *testing.T) {
	t.Parallel()

	ctrl := gomock.NewController(t)
	releases := servicemocks.NewMockReleaseService(ctrl)
	now := time.Now().UTC()
	releases.EXPECT().Get(gomock.Any(), "proj_1", "rel_1").Return(&domain.Release{
		ProjectID: "proj_1",
		ID:        "rel_1",
		RevokedAt: &now,
	}, nil)

	h := Handler{releaseService: releases}
	_, err := h.withSealedRuntime(t.Context(), "proj_1", "dep_1", "rel_1")
	require.ErrorIs(t, err, domain.ErrReleaseRevoked())
}

func TestWithSealedRuntime_EmptyIsNoop(t *testing.T) {
	t.Parallel()

	h := Handler{}
	ctx, err := h.withSealedRuntime(t.Context(), "proj_1", "", "")
	require.NoError(t, err)
	require.Nil(t, service.RuntimeResolutionFromContext(ctx))
}
