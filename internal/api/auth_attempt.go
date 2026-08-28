package api

import (
	"context"
	"encoding/base64"
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
	// TODO: handle challenge nonce in the future

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
	if attempt.Internal {
		// A server-orchestrated ceremony's attempt is a state carrier, not an
		// attempt-surface resource: it stays invisible here.
		return nil, domain.ErrAuthAttemptNotFound()
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

	check, ok := attempt.ChallengeByType(challenge.ChallengeCheckType())
	if !ok {
		return nil, domain.ErrInternal(nil).WithMessage("challenge not found after issue")
	}
	return challengeToAPI(check), nil
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
		ExpiresAt:    attempt.HandoffToken.ExpiresAt(attempt.HandedOffAt),
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

var methodChecks = map[api.FactorMethod]domain.AuthCheckType{
	api.FactorMethodIdentifier: domain.AuthCheckTypeUser,
	api.FactorMethodPassword:   domain.AuthCheckTypePassword,
	api.FactorMethodPasskey:    domain.AuthCheckTypePasskey,
}

func factorMethodToCheckType(method api.FactorMethod) (domain.AuthCheckType, error) {
	check, ok := methodChecks[method]
	if !ok {
		return domain.AuthCheckTypeUnspecified, domain.ErrAuthAttemptInvalidRequest()
	}
	return check, nil
}

func challengeToAPI(challenge domain.AuthChallenge) *api.ChallengeResponse {
	return &api.ChallengeResponse{
		ChallengeID: api.ChallengeID(challenge.GetID()),
		Method:      checkTypeToAPI(challenge.Type()),
		State:       api.ChallengeResponseStatePending,
		CreatedAt:   challenge.GetLastChallengedAt(),
		ExpiresAt:   api.OptNilDateTime{},
		Payload:     challengePayloadToAPI(challenge),
	}
}

func challengePayloadToAPI(check domain.AuthChallenge) api.OptChallengeResponsePayload {
	switch challenge := check.(type) {
	case *domain.AuthChallengePasskey:
		return api.NewOptChallengeResponsePayload(api.ChallengeResponsePayload{
			Type: api.PasskeyChallengePayloadChallengeResponsePayload,
			PasskeyChallengePayload: api.PasskeyChallengePayload{
				PublicKey: api.PasskeyChallengePayloadPublicKey{
					Challenge:          challenge.Challenge,
					AllowedCredentials: allowedCredentialsToAPI(challenge.AllowedCredentialIDs),
					UserVerification:   userVerificationToAPI(challenge.UserVerification),
					RpID: api.OptString{
						Value: challenge.RPID,
						Set:   true,
					},
				},
			},
		})
	case *domain.AuthChallengePasskeyRegistration:
		// A pending enrollment renders in the passkey payload shape with the
		// fields both ceremonies share (challenge, rp id). The full creation
		// options are not modeled here: the payload union discriminates by
		// method and `passkey` is taken by the assertion shape — the flow
		// step and the management begin endpoint carry the real options.
		return api.NewOptChallengeResponsePayload(api.ChallengeResponsePayload{
			Type: api.PasskeyChallengePayloadChallengeResponsePayload,
			PasskeyChallengePayload: api.PasskeyChallengePayload{
				PublicKey: api.PasskeyChallengePayloadPublicKey{
					Challenge: challenge.Challenge,
					RpID: api.OptString{
						Value: challenge.RPID,
						Set:   true,
					},
				},
			},
		})
	}
	return api.OptChallengeResponsePayload{}
}

// allowedCredentialsToAPI maps the challenge's allowed credential IDs into the WebAuthn
// allowCredentials list the browser needs for an identified login. The IDs are base64url
// encoded, matching the encoding the browser expects for PublicKeyCredentialDescriptor.id.
// A discoverable (usernameless) login has no allowed credentials and yields nil.
func allowedCredentialsToAPI(ids [][]byte) []api.PasskeyChallengePayloadPublicKeyAllowedCredentialsItem {
	if len(ids) == 0 {
		return nil
	}
	out := make([]api.PasskeyChallengePayloadPublicKeyAllowedCredentialsItem, 0, len(ids))
	for _, id := range ids {
		out = append(out, api.PasskeyChallengePayloadPublicKeyAllowedCredentialsItem{
			ID:   base64.RawURLEncoding.EncodeToString(id),
			Type: api.PasskeyChallengePayloadPublicKeyAllowedCredentialsItemTypePublicKey,
		})
	}
	return out
}

// userVerificationToAPI maps the challenge's WebAuthn user verification requirement into the
// response. An empty requirement (none set when issuing) yields an unset optional.
func userVerificationToAPI(uv string) api.OptPasskeyChallengePayloadPublicKeyUserVerification {
	if uv == "" {
		return api.OptPasskeyChallengePayloadPublicKeyUserVerification{}
	}
	return api.OptPasskeyChallengePayloadPublicKeyUserVerification{
		Value: api.PasskeyChallengePayloadPublicKeyUserVerification(uv),
		Set:   true,
	}
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
		domain.ErrAuthAttemptProofRejected(nil).Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}
