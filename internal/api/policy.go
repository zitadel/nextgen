package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
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

func (h *Handler) PublishPolicy(ctx context.Context, req api.PublishPolicyRequest, params api.PublishPolicyParams) (api.PublishPolicyRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), policyAccess, opWrite); err != nil {
		return nil, err
	}
	if h.policyService == nil {
		return nil, domain.ErrInternal(errors.New("policy service not configured"))
	}
	operation, config, err := fromAPIPublishPolicy(req)
	if err != nil {
		return nil, err
	}
	entity, err := h.policyService.Publish(ctx, service.PublishPolicyInput{
		ProjectID: string(params.ProjectID),
		Operation: operation,
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

// fromAPIPublishPolicy reads the operation and its settings from the typed
// request. A setting left out stays out of the map: it is off, not zero.
func fromAPIPublishPolicy(req api.PublishPolicyRequest) (string, map[string]any, error) {
	switch req.Type {
	case api.PasswordSetPolicyInputPublishPolicyRequest:
		in := req.PasswordSetPolicyInput
		return string(in.Operation), fromAPIPasswordSetConfig(in.Config), nil
	default:
		return "", nil, domain.ErrPolicyInvalid(nil, nil).WithMessage("policy: invalid: unknown operation")
	}
}

func fromAPIPasswordSetConfig(in api.PasswordSetConfig) map[string]any {
	config := make(map[string]any, 3)
	for name, setting := range map[string]api.OptInt{
		"min_length":    in.MinLength,
		"max_length":    in.MaxLength,
		"history_depth": in.HistoryDepth,
	} {
		if v, ok := setting.Get(); ok {
			config[name] = int64(v)
		}
	}
	return config
}

// toAPIPolicy types a stored revision by its operation. A stored operation
// the API does not know is a server fault: publishing only accepts known ones.
func toAPIPolicy(entity *domain.Policy) (*api.Policy, error) {
	switch entity.Operation {
	case string(api.PasswordSetPolicyOperationAuthFactorPasswordSet):
		var config api.PasswordSetConfig
		if err := config.UnmarshalJSON(entity.Config); err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to decode stored policy config")
		}
		policy := api.NewPasswordSetPolicyPolicy(api.PasswordSetPolicy{
			ID:         api.PolicyID(entity.ID),
			RevisionID: api.PolicyRevisionID(entity.RevisionID),
			ProjectID:  api.ProjectID(entity.ProjectID),
			Operation:  api.PasswordSetPolicyOperationAuthFactorPasswordSet,
			Config:     config,
			CreatedAt:  entity.CreatedAt,
			UpdatedAt:  entity.UpdatedAt,
		})
		return &policy, nil
	default:
		return nil, domain.ErrInternal(fmt.Errorf("stored policy has unknown operation %q", entity.Operation)).WithMessage("failed to read policy")
	}
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
