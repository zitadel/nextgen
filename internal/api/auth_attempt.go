package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h Handler) CreateAuthAttempt(ctx context.Context, req *api.CreateAuthAttemptRequest) (api.CreateAuthAttemptRes, error) {
	input := service.CreateAuthAttemptInput{
		ProjectID: string(req.GetProjectID()),
	}
	if sessionID, ok := req.GetSessionID().Get(); ok {
		input.SessionID = new(string(sessionID))
	}

	attempt, err := h.authAttemptService.Create(ctx, input)
	if err != nil {
		return nil, err
	}
	return authAttemptToAPI(attempt), nil
}

func (h Handler) GetAuthAttempt(ctx context.Context, params api.GetAuthAttemptParams) (api.GetAuthAttemptRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)
	attempt, err := h.authAttemptService.GetByID(ctx, scopeCtx.ProjectID, string(params.AttemptID))
	if err != nil {
		return nil, err
	}
	return authAttemptToAPI(attempt), nil
}

func (h Handler) IssueChallenge(ctx context.Context, req *api.IssueChallengeRequest, params api.IssueChallengeParams) (api.IssueChallengeRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)

	challenge, err := challengeRequestToChallenge(req)
	if err != nil {
		return nil, err
	}

	attempt, err := h.authAttemptService.IssueChallenge(ctx, service.IssueChallengeInput{
		ProjectID: scopeCtx.ProjectID,
		AttemptID: string(params.AttemptID),
		Challenge: challenge,
	})
	if err != nil {
		return nil, err
	}
	// Return only the newly issued challenge for the requested check type
	check, ok := attempt.ChallengeByType(challenge.ChallengeCheckType())
	if !ok {
		return nil, domain.ErrInternal(nil).WithMessage("challenge not found after issue")
	}
	return checkToChallenge(check), nil
}

func (h Handler) VerifyChallengeProof(ctx context.Context, req *api.VerifyChallengeRequest, params api.VerifyChallengeProofParams) (api.VerifyChallengeProofRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)

	proof, err := verifyRequestToProof(req)
	if err != nil {
		return nil, err
	}
	attempt, err := h.authAttemptService.VerifyProof(ctx, service.VerifyProofInput{
		ProjectID:   scopeCtx.ProjectID,
		AttemptID:   string(params.AttemptID),
		ChallengeID: string(params.ChallengeID),
		Proof:       proof,
	})
	if err != nil {
		return nil, err
	}
	return authAttemptToAPI(attempt), nil
}

func (h Handler) CreateHandoff(ctx context.Context, params api.CreateHandoffParams) (api.CreateHandoffRes, error) {
	scopeCtx, _ := GetScopeContext(ctx)
	input := service.HandoffInput{
		ProjectID: scopeCtx.ProjectID,
		AttemptID: string(params.AttemptID),
	}
	if key, ok := params.IdempotencyKey.Get(); ok {
		input.IdempotencyKey = new(key)
	}
	attempt, err := h.authAttemptService.Handoff(ctx, input)
	if err != nil {
		return nil, err
	}
	return &api.HandoffResponse{
		HandoffToken: attempt.HandoffToken.Plain(),
		ExpiresAt:    attempt.HandoffToken.Expiration(attempt.HandedOffAt),
	}, nil
}

// challengeRequestToChallenge maps the API oneOf challenge to the service Challenge discriminated union.
func challengeRequestToChallenge(req *api.IssueChallengeRequest) (service.Challenge, error) {
	checkType, err := factorMethodToCheckType(req.GetMethod())
	if err != nil {
		return nil, err
	}
	switch checkType {
	case domain.AuthCheckTypeUser:
		return service.UserChallenge{}, nil
	case domain.AuthCheckTypePassword:
		return service.PasswordChallenge{}, err
	case domain.AuthCheckTypePasskey:
		opts, ok := req.GetPasskeyOptions().Get()
		if !ok {
			return nil, domain.ErrAuthAttemptInvalidRequest().WithMessage("passkey options missing")
		}
		userVerification, _ := opts.GetUserVerification().Get()
		return service.PasskeyChallenge{
			UserVerification: string(userVerification),
			RPID:             opts.GetRpID().Value,
			RPOrigins:        opts.GetRpOrigins(),
		}, nil
	default:
		return nil, domain.ErrAuthAttemptInvalidRequest()
	}
}

// verifyRequestToProof maps the API oneOf proof to the service Proof discriminated union.
func verifyRequestToProof(req *api.VerifyChallengeRequest) (service.Proof, error) {
	switch req.GetOneOf().Type {
	case api.IdentifierProofVerifyChallengeRequestSum:
		p := req.GetOneOf().IdentifierProof
		return service.UserProof{
			LoginName: p.GetLoginName(),
		}, nil
	case api.PasswordProofVerifyChallengeRequestSum:
		p := req.GetOneOf().PasswordProof
		return service.PasswordProof{
			Password: p.GetPassword(),
		}, nil
	case api.PasskeyProofVerifyChallengeRequestSum:
		p := req.GetOneOf().PasskeyProof
		pk := p.GetPasskey()
		raw, err := pk.GetAssertion().MarshalJSON()
		if err != nil {
			return nil, domain.ErrAuthAttemptInvalidProof()
		}
		return service.PasskeyProof{
			AssertionResponse: raw,
		}, nil
	default:
		return nil, domain.ErrAuthAttemptInvalidRequest()
	}
}

// factorMethodToCheckType maps the API FactorMethod to the domain AuthCheckType.
// This is the adapter boundary — API types never leak into the service or domain.
func factorMethodToCheckType(method api.FactorMethod) (domain.AuthCheckType, error) {
	switch method {
	case api.FactorMethodIdentifier:
		return domain.AuthCheckTypeUser, nil
	case api.FactorMethodPassword:
		return domain.AuthCheckTypePassword, nil
	case api.FactorMethodPasskey:
		return domain.AuthCheckTypePasskey, nil
	default:
		return domain.AuthCheckTypeUnspecified, domain.ErrAuthAttemptInvalidRequest()
	}
}

func checkToChallenge(check domain.AuthChallenge) *api.ChallengeResponse {
	check.Payload()
	resp := &api.ChallengeResponse{
		ChallengeID: api.ChallengeID(check.GetID()),
		Method:      checkTypeToAPI(check.Type()),
		State:       api.ChallengeResponseStatePending,
		CreatedAt:   check.GetLastChallengedAt(),
		ExpiresAt:   api.OptNilDateTime{},
		Payload:     api.OptChallengeResponsePayload{},
	}
	if passkey, ok := check.(*domain.AuthChallengePasskey); ok {
		resp.Payload = api.NewOptChallengeResponsePayload(api.ChallengeResponsePayload{
			Type: api.PasskeyChallengePayloadChallengeResponsePayload,
			PasskeyChallengePayload: api.PasskeyChallengePayload{
				PublicKey: api.PasskeyChallengePayloadPublicKey{
					Challenge:          passkey.Challenge,
					AllowedCredentials: nil,
					UserVerification:   api.OptPasskeyChallengePayloadPublicKeyUserVerification{},
					RpID: api.OptString{
						Value: passkey.RPID,
						Set:   true,
					},
				},
			},
		})
	}
	return resp
}

func authAttemptToAPI(attempt *domain.AuthAttempt) *api.AuthAttemptResponse {
	factors, challenges := checksToAPI(attempt.Checks)
	resp := &api.AuthAttemptResponse{
		AttemptID:        api.AttemptID(attempt.ID),
		ProjectID:        api.ProjectID(attempt.ProjectID),
		State:            authAttemptStateToAPI(attempt),
		UserID:           api.OptNilUserID{},
		RequiredFactors:  requiredFactorsToAPI(attempt.RequiredChecks),
		CompletedFactors: factors,
		Challenges:       challenges,
		CreatedAt:        attempt.CreatedAt,
	}
	if attempt.SessionID != nil {
		resp.SessionID = api.NewOptNilSessionID(api.SessionID(*attempt.SessionID))
	}
	if !attempt.ExpiresAt().IsZero() {
		resp.ExpiresAt = api.NewOptDateTime(attempt.ExpiresAt())
	}
	return resp
}

func checksToAPI(checks []domain.AuthCheck) ([]api.CompletedFactor, []api.ChallengeResponse) {
	factors := make([]api.CompletedFactor, 0, len(checks))
	challenges := make([]api.ChallengeResponse, 0, len(checks))
	for _, check := range checks {
		switch c := check.(type) {
		case domain.AuthFactor:
			factors = append(factors, checkToFactor(c))
		case domain.AuthChallenge:
			challenges = append(challenges, *checkToChallenge(c))
		}
	}
	return factors, challenges
}

func checkToFactor(check domain.AuthFactor) api.CompletedFactor {
	resp := api.CompletedFactor{
		Method:     checkTypeToAPI(check.Type()),
		VerifiedAt: check.GetLastVerifiedAt(),
		Payload:    api.OptCompletedFactorPayload{},
	}
	return resp
}

func requiredFactorsToAPI(checks []domain.AuthCheckType) []api.FactorMethod {
	factors := make([]api.FactorMethod, len(checks))
	for i, check := range checks {
		factors[i] = checkTypeToAPI(check)
	}
	return factors
}

func checkTypeToAPI(check domain.AuthCheckType) api.FactorMethod {
	switch check {
	case domain.AuthCheckTypeUser:
		return api.FactorMethodIdentifier
	case domain.AuthCheckTypePassword:
		return api.FactorMethodPassword
	case domain.AuthCheckTypePasskey:
		return api.FactorMethodPasskey
	default:
		return api.FactorMethodIdentifier //TODO: ?
	}
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

func authAttemptErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrAuthAttemptNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrAuthAttemptInvalidRequest().Code,
		domain.ErrAuthAttemptInvalidProof().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrAuthAttemptInvalidState().Code,
		domain.ErrAuthAttemptAlreadyCompleted().Code,
		domain.ErrAuthAttemptNotCompleted().Code,
		domain.ErrAuthAttemptStaleChallenge().Code,
		domain.ErrAuthAttemptProofRejected().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}
