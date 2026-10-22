package api

import (
	"context"
	"encoding/json"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// BeginUserPasskeyRegistration starts a management-plane enrollment ceremony.
// The between-steps state rides an internal auth attempt (ADR 056) the
// service orchestrates; it can never be read, handed off, or exchanged.
func (h *Handler) BeginUserPasskeyRegistration(ctx context.Context, req *api.BeginUserPasskeyRegistrationRequest, params api.BeginUserPasskeyRegistrationParams) (api.BeginUserPasskeyRegistrationRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.UserID), userAccess, opWrite)
	if err != nil {
		return nil, err
	}

	begun, err := h.authAttemptService.BeginPasskeyEnrollment(ctx, service.BeginPasskeyEnrollmentInput{
		ProjectID:   projectID,
		UserID:      string(params.UserID),
		Username:    req.Username.Value,
		DisplayName: req.DisplayName.Value,
		RPID:        req.RpID,
		RPOrigins:   req.RpOrigins,
	})
	if err != nil {
		return nil, err
	}

	var options api.BeginUserPasskeyRegistrationResponseOptions
	if err := json.Unmarshal(begun.Options, &options); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to encode creation options")
	}
	return &api.BeginUserPasskeyRegistrationResponse{
		RegistrationID: begun.RegistrationID,
		Options:        options,
	}, nil
}

// FinishUserPasskeyRegistration verifies the attestation and persists the new
// credential; the service consumes the ceremony atomically.
func (h *Handler) FinishUserPasskeyRegistration(ctx context.Context, req *api.FinishUserPasskeyRegistrationRequest, params api.FinishUserPasskeyRegistrationParams) (api.FinishUserPasskeyRegistrationRes, error) {
	projectID, err := h.requireResourceAccess(ctx, string(params.UserID), userAccess, opWrite)
	if err != nil {
		return nil, err
	}

	attestation, err := req.Attestation.MarshalJSON()
	if err != nil {
		return nil, domain.ErrAuthAttemptInvalidProof()
	}
	finished, err := h.authAttemptService.FinishPasskeyEnrollment(ctx, service.FinishPasskeyEnrollmentInput{
		ProjectID:      projectID,
		RegistrationID: params.RegistrationID,
		UserID:         string(params.UserID),
		Attestation:    attestation,
		Name:           req.Name.Value,
	})
	if err != nil {
		return nil, err
	}

	return &api.FinishUserPasskeyRegistrationResponse{
		ID:        finished.PasskeyID,
		Name:      finished.Name,
		CreatedAt: finished.CreatedAt,
	}, nil
}
