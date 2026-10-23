package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-faster/jx"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// WithPolicyService wires the operation policy endpoints (ADR 066). A
// chainable setter like WithPersonalTeamEnsurer, so NewHandler's call sites
// stay unchanged; without it the endpoints answer an internal error.
func (h *Handler) WithPolicyService(s *service.PolicyService) *Handler {
	h.policyService = s
	return h
}

func (h *Handler) PublishPolicy(ctx context.Context, req *api.PublishPolicyRequest, params api.PublishPolicyParams) (api.PublishPolicyRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), policyAccess, opWrite); err != nil {
		return nil, err
	}
	if h.policyService == nil {
		return nil, domain.ErrInternal(errors.New("policy service not configured"))
	}
	config, err := fromAPIPolicyConfig(req.Config)
	if err != nil {
		return nil, domain.ErrPolicyInvalid(nil, err).WithMessage("policy: invalid: config values must be JSON")
	}
	entity, err := h.policyService.Publish(ctx, service.PublishPolicyInput{
		ProjectID: string(params.ProjectID),
		Operation: req.Operation,
		Config:    config,
	})
	if err != nil {
		return nil, err
	}
	return toAPIPolicy(entity)
}

func (h *Handler) GetPolicyRevision(ctx context.Context, params api.GetPolicyRevisionParams) (api.GetPolicyRevisionRes, error) {
	// Scoped to the project the caller named, like a release read: a revision
	// of another project reads as an unknown id, not a forbidden one.
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), policyAccess, opRead); err != nil {
		return nil, err
	}
	if h.policyService == nil {
		return nil, domain.ErrInternal(errors.New("policy service not configured"))
	}
	entity, err := h.policyService.GetRevision(ctx, string(params.ProjectID), string(params.RevisionID))
	if err != nil {
		return nil, err
	}
	return toAPIPolicy(entity)
}

// fromAPIPolicyConfig decodes the settings with json.Number, so an integer
// setting keeps its exact value until the template checks it.
func fromAPIPolicyConfig(in api.PublishPolicyRequestConfig) (map[string]any, error) {
	out := make(map[string]any, len(in))
	for name, raw := range in {
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		var value any
		if err := dec.Decode(&value); err != nil {
			return nil, err
		}
		out[name] = value
	}
	return out, nil
}

func toAPIPolicy(entity *domain.Policy) (*api.Policy, error) {
	var settings map[string]json.RawMessage
	if err := json.Unmarshal(entity.Config, &settings); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to decode stored policy config")
	}
	config := make(api.PolicyConfig, len(settings))
	for name, raw := range settings {
		config[name] = jx.Raw(raw)
	}
	return &api.Policy{
		ID:         api.PolicyID(entity.ID),
		RevisionID: api.PolicyRevisionID(entity.RevisionID),
		ProjectID:  api.ProjectID(entity.ProjectID),
		Operation:  entity.Operation,
		Config:     config,
		CreatedAt:  entity.CreatedAt,
		UpdatedAt:  entity.UpdatedAt,
	}, nil
}

func policyErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrPolicyNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrPolicyInvalid(nil, nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrPolicyPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrPolicyRevisionConflict().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}
