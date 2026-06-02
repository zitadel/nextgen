package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) BeginPasskeyRegistration(ctx context.Context, req *api.BeginPasskeyRegistrationRequest, params api.BeginPasskeyRegistrationParams) (api.BeginPasskeyRegistrationRes, error) {
	// Project scope is always taken from the authenticated token, never from the
	// request body, to prevent cross-project IDOR attacks.
	scopeCtx, _ := GetScopeContext(ctx)

	origin, err := url.Parse(params.Origin)
	if err != nil || origin.Hostname() == "" {
		return nil, fmt.Errorf("could not parse Origin header %q", params.Origin)
	}

	project, err := h.projectService.Get(ctx, scopeCtx.ProjectID)
	if err != nil {
		return nil, err
	}
	if err := validateOriginAgainstProject(origin.String(), project); err != nil {
		return nil, err
	}

	out, err := h.passkeyRegistrationService.BeginPasskeyRegistration(ctx, service.BeginPasskeyRegistrationInput{
		ProjectID: scopeCtx.ProjectID,
		SessionID: req.SessionID,
		RPID:      origin.Hostname(),
		RPOrigins: []string{origin.String()},
	})
	if err != nil {
		return nil, err
	}

	// options is already a JSON blob; decode it into the map the generated type expects.
	var optionsMap api.BeginPasskeyRegistrationResponseOptions
	if err := json.Unmarshal(out.Options, &optionsMap); err != nil {
		return nil, fmt.Errorf("passkey handler: marshal options: %w", err)
	}

	return &api.BeginPasskeyRegistrationResponse{
		RegistrationID: out.RegistrationID,
		Options:        optionsMap,
	}, nil
}

func (h *Handler) FinishPasskeyRegistration(ctx context.Context, req *api.FinishPasskeyRegistrationRequest, params api.FinishPasskeyRegistrationParams) (api.FinishPasskeyRegistrationRes, error) {
	// Project scope is always taken from the authenticated token, never from the
	// request body, to prevent cross-project IDOR attacks.
	scopeCtx, _ := GetScopeContext(ctx)

	attestation, err := json.Marshal(req.Attestation)
	if err != nil {
		return nil, fmt.Errorf("passkey handler: marshal attestation: %w", err)
	}

	if err := h.passkeyRegistrationService.FinishPasskeyRegistration(ctx, service.FinishPasskeyRegistrationInput{
		ProjectID:      scopeCtx.ProjectID,
		RegistrationID: params.RegistrationID,
		Attestation:    attestation,
	}); err != nil {
		return nil, err
	}

	return &api.FinishPasskeyRegistrationResponse{
		PasskeyID: params.RegistrationID, // echoed as a stable reference for the client
		CreatedAt: time.Now(),
	}, nil
}

// validateOriginAgainstProject returns an error if the origin is not in the
// project's PreviewOrigins allowlist. An empty allowlist means allow all
// (development/test mode).
func validateOriginAgainstProject(originStr string, project *domain.Project) error {
	if len(project.PreviewOrigins) == 0 {
		return nil
	}
	for _, allowed := range project.PreviewOrigins {
		if allowed == originStr {
			return nil
		}
	}
	return fmt.Errorf("origin %q is not allowed for this project", originStr)
}

func passkeyRegistrationErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrPasskeyRegistrationNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	default:
		return errorResponseWithStatusCode(http.StatusInternalServerError, err)
	}
}
