package api

import (
	"context"
	"encoding/json"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// BeginUserPasskeyRegistration starts a management-plane enrollment ceremony.
// The between-steps state rides an internal auth attempt (ADR 056) that is
// never exposed to the caller beyond the opaque registration id.
func (h *Handler) BeginUserPasskeyRegistration(ctx context.Context, req *api.BeginUserPasskeyRegistrationRequest, params api.BeginUserPasskeyRegistrationParams) (api.BeginUserPasskeyRegistrationRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.UserID), userAccess, opWrite)
	if err != nil {
		return nil, err
	}
	// Reject a missing user before minting a ceremony for it.
	if _, err := h.userService.GetUserByID(ctx, service.GetUserInput{
		ProjectID: projectID,
		UserID:    string(params.UserID),
	}); err != nil {
		return nil, err
	}

	attempt, err := h.authAttemptService.Create(ctx, service.CreateAuthAttemptInput{ProjectID: projectID})
	if err != nil {
		return nil, err
	}
	issued, err := h.authAttemptService.IssueChallenge(ctx, service.IssueChallengeInput{
		ProjectID: projectID,
		AttemptID: attempt.ID,
		Challenge: service.PasskeyRegistrationChallenge{
			UserID:      string(params.UserID),
			Username:    req.Username.Value,
			DisplayName: req.DisplayName.Value,
			RPID:        req.RpID,
			RPOrigins:   req.RpOrigins,
		},
	})
	if err != nil {
		return nil, err
	}

	check, ok := issued.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
	if !ok {
		return nil, domain.ErrInternal(nil).WithMessage("registration challenge missing after issue")
	}
	registrationCh, ok := check.(*domain.AuthChallengePasskeyRegistration)
	if !ok {
		return nil, domain.ErrInternal(nil).WithMessage("unexpected registration challenge type")
	}
	optionsJSON, err := domain.BuildPasskeyCreationOptions(registrationCh)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to build creation options")
	}
	var options api.BeginUserPasskeyRegistrationResponseOptions
	if err := json.Unmarshal(optionsJSON, &options); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to encode creation options")
	}

	return &api.BeginUserPasskeyRegistrationResponse{
		// The internal attempt's id doubles as the ceremony handle: finish
		// re-reads the attempt and its pending registration challenge from it.
		RegistrationID: attempt.ID,
		Options:        options,
	}, nil
}

// FinishUserPasskeyRegistration verifies the attestation and persists the new
// credential; the internal attempt is deleted on success.
func (h *Handler) FinishUserPasskeyRegistration(ctx context.Context, req *api.FinishUserPasskeyRegistrationRequest, params api.FinishUserPasskeyRegistrationParams) (api.FinishUserPasskeyRegistrationRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.UserID), userAccess, opWrite)
	if err != nil {
		return nil, err
	}

	attempt, err := h.authAttemptService.GetByID(ctx, projectID, params.RegistrationID)
	if err != nil {
		return nil, err
	}
	check, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
	if !ok {
		return nil, domain.ErrAuthAttemptStaleChallenge()
	}
	registrationCh, ok := check.(*domain.AuthChallengePasskeyRegistration)
	if !ok {
		return nil, domain.ErrInternal(nil).WithMessage("unexpected registration challenge type")
	}
	// The ceremony must target the user named in the path.
	if registrationCh.UserID != string(params.UserID) {
		return nil, domain.ErrAuthAttemptInvalidRequest().WithMessage("The registration does not belong to this user.")
	}

	attestation, err := req.Attestation.MarshalJSON()
	if err != nil {
		return nil, domain.ErrAuthAttemptInvalidProof()
	}
	verified, err := h.authAttemptService.VerifyProof(ctx, service.VerifyProofInput{
		ProjectID:   projectID,
		AttemptID:   attempt.ID,
		ChallengeID: check.GetID(),
		Proof: service.PasskeyRegistrationProof{
			AttestationResponse: attestation,
			Name:                req.Name.Value,
		},
	})
	if err != nil {
		return nil, err
	}

	factor, ok := domain.CheckAs[*domain.AuthFactorPasskeyRegistration](verified, domain.AuthCheckTypePasskeyRegistration)
	if !ok || factor.PasskeyID == "" {
		return nil, domain.ErrInternal(nil).WithMessage("registration factor missing after verify")
	}

	// Best-effort cleanup: the ceremony is consumed, the attempt has no
	// further purpose. A leftover row ages out with the attempt TTL.
	_ = h.pool.Statements().DeleteAuthAttemptByID(ctx, projectID, attempt.ID)

	// The verify transaction carries the created row's identity on the
	// factor, so the response needs no read-back that could fail after the
	// ceremony is already consumed. The factor's verification time is the
	// same transaction's commit clock as the row's created_at.
	return &api.FinishUserPasskeyRegistrationResponse{
		ID:        factor.PasskeyID,
		Name:      factor.Name,
		CreatedAt: factor.GetLastVerifiedAt(),
	}, nil
}
