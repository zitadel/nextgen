package api

import (
	"context"
	"net/http"
	"time"

	"github.com/go-faster/errors"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Handler) CreateAuthAttempt(ctx context.Context, req *api.CreateAuthAttemptRequest) (api.CreateAuthAttemptRes, error) {
	id := "att_" + time.Now().Format("2006-01-02T15-04-05Z")
	attempt := &domain.AuthAttempt{
		ID:        id,
		ProjectID: string(req.GetProjectID()),
	}
	if sessionId, ok := req.GetSessionID().Get(); ok {
		attempt.SessionID = new(string(sessionId))
	}
	var repo domain.AuthAttemptRepository
	repo = &repository.AuthAttempt{}
	err := repo.Create(ctx, h.pool, attempt)
	if err != nil {
		return nil, err
	}
	return authAttemptToAPI(attempt), nil
}

func (h *Handler) GetAuthAttempt(ctx context.Context, params api.GetAuthAttemptParams) (api.GetAuthAttemptRes, error) {
	repo := &repository.AuthAttempt{}
	scopeCtx, _ := GetScopeContext(ctx)
	attempt, err := repo.GetByID(ctx, h.pool, scopeCtx.ProjectID, string(params.AttemptID))
	if err != nil {
		if errors.Is(err, domain.ErrAuthAttemptNotFound()) {
			return errorResponse(http.StatusNotFound, err), nil
		}
		return internalErrorResponse(err), nil
	}
	return authAttemptToAPI(attempt), nil
}

//
//func (h *Handler) IssueChallenge(ctx context.Context, req *api.IssueChallengeRequest, params api.IssueChallengeParams) (api.IssueChallengeRes, error) {
//	attempt, ok := attempts[string(params.AttemptID)]
//	if !ok {
//		return &api.ErrorDetailsStatusCode{
//			StatusCode: http.StatusNotFound,
//			Response: api.ErrorDetails{
//				Code:    "att_not_found",
//				Message: "Attempt not found",
//			},
//		}, nil
//	}
//	id := "ch_" + time.Now().Format("2006-01-02T15-04-05Z")
//	challenge := &api.ChallengeResponse{
//		ChallengeID: api.ChallengeID(id),
//		Method:      req.GetMethod(),
//		State:       api.ChallengeResponseStatePending,
//		CreatedAt:   time.Now(),
//		ExpiresAt:   api.OptNilDateTime{},
//	}
//	if len(attempt.Challenges) == 0 {
//		attempt.Challenges = make([]api.ChallengeResponse, 0, 1)
//	}
//	attempt.Challenges = append(attempt.Challenges, *challenge)
//	return challenge, nil
//}
//
//func (h *Handler) VerifyChallengeProof(ctx context.Context, req *api.VerifyChallengeRequest, params api.VerifyChallengeProofParams) (api.VerifyChallengeProofRes, error) {
//	attempt, ok := attempts[string(params.AttemptID)]
//	if !ok {
//		return &api.ErrorDetailsStatusCode{
//			StatusCode: http.StatusNotFound,
//			Response: api.ErrorDetails{
//				Code:    "att_not_found",
//				Message: "Attempt not found",
//			},
//		}, nil
//	}
//	for _, challenge := range attempt.Challenges {
//		if challenge.ChallengeID == params.ChallengeID {
//			switch challenge.Method {
//			case api.FactorMethodPassword:
//				v, ok := req.OneOf.GetPasswordProof()
//				if !ok {
//					return &api.ErrorDetailsStatusCode{
//						StatusCode: http.StatusNotFound,
//						Response: api.ErrorDetails{
//							Code:    "ch_not_found",
//							Message: "Challenge not found",
//						},
//					}, nil
//				}
//				if v.GetPassword() != "a" {
//					return &api.ErrorDetailsStatusCode{
//						StatusCode: http.StatusNotFound,
//						Response: api.ErrorDetails{
//							Code:    "ch_not_found",
//							Message: "Challenge not found",
//						},
//					}, nil
//				}
//			default:
//				return &api.ErrorDetailsStatusCode{
//					StatusCode: http.StatusNotFound,
//					Response: api.ErrorDetails{
//						Code:    "ch_not_found",
//						Message: "Challenge not found",
//					},
//				}, nil
//			}
//			return attempt, nil
//		}
//		if !ok {
//			return &api.ErrorDetailsStatusCode{
//				StatusCode: http.StatusNotFound,
//				Response: api.ErrorDetails{
//					Code:    "ch_not_found",
//					Message: "Challenge not found",
//				},
//			}, nil
//		}
//	}
//	return attempt, nil
//}

func authAttemptToAPI(attempt *domain.AuthAttempt) *api.AuthAttemptResponse {
	resp := &api.AuthAttemptResponse{
		AttemptID:        api.AttemptID(attempt.ID),
		ProjectID:        api.ProjectID(attempt.ProjectID),
		State:            authAttemptStateToAPI(attempt),
		UserID:           api.OptNilUserID{},
		RequiredFactors:  nil,
		CompletedFactors: nil,
		Challenges:       nil,
		CreatedAt:        attempt.CreatedAt,
	}
	if !attempt.ExpiresAt().IsZero() {
		resp.ExpiresAt = api.NewOptNilDateTime(attempt.ExpiresAt())
	}
	return resp
}

func authAttemptStateToAPI(attempt *domain.AuthAttempt) api.AuthAttemptResponseState {
	if attempt.IsExpired() {
		return api.AuthAttemptResponseStateExpired
	}
	if attempt.IsCompleted() {
		return api.AuthAttemptResponseStateCompleted
	}
	return api.AuthAttemptResponseStateInProgress
}
