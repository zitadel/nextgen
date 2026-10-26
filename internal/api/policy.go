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

// GetPolicy reads a policy at its newest revision. The id resolves in the
// named project like an IdP connection's, so a grant scoped to one policy
// reaches it and another project's id reads as unknown.
func (h *Handler) GetPolicy(ctx context.Context, params api.GetPolicyParams) (api.GetPolicyRes, error) {
	projectID, err := h.requireResourceAccessInProject(ctx, string(params.ProjectID), string(params.PolicyID), policyAccess, opRead)
	if err != nil {
		return nil, err
	}
	if h.policyService == nil {
		return nil, domain.ErrInternal(errors.New("policy service not configured"))
	}
	entity, err := h.policyService.Get(ctx, projectID, string(params.PolicyID))
	if err != nil {
		return nil, err
	}
	return toAPIPolicy(entity)
}

func (h *Handler) ListPolicies(ctx context.Context, params api.ListPoliciesParams) (api.ListPoliciesRes, error) {
	ctx, _, err := h.requireProjectListAccess(ctx, string(params.ProjectID), policyAccess, domain.ResourceKindPolicy)
	if err != nil {
		return nil, err
	}
	if h.policyService == nil {
		return nil, domain.ErrInternal(errors.New("policy service not configured"))
	}
	result, err := h.policyService.List(ctx, service.ListPoliciesInput{
		ProjectID: string(params.ProjectID),
		Operation: string(params.Operation.Or("")),
		Limit:     int(params.Limit.Or(0)),
		PageToken: string(params.PageToken.Or("")),
	})
	if err != nil {
		return nil, err
	}
	policies, err := toAPIPolicies(result.Items)
	if err != nil {
		return nil, err
	}
	resp := &api.ListPoliciesResponse{Policies: policies}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return resp, nil
}

func (h *Handler) ListPolicyRevisions(ctx context.Context, params api.ListPolicyRevisionsParams) (api.ListPolicyRevisionsRes, error) {
	projectID, err := h.requireResourceAccessInProject(ctx, string(params.ProjectID), string(params.PolicyID), policyAccess, opRead)
	if err != nil {
		return nil, err
	}
	if h.policyService == nil {
		return nil, domain.ErrInternal(errors.New("policy service not configured"))
	}
	// The check above allowed the caller on this very policy, and every row
	// of the list is one of its revisions, so the list takes the one-shot
	// skip instead of the per-policy filter.
	ctx = service.WithAuthzListSkipOnce(ctx)
	result, err := h.policyService.ListRevisions(ctx, service.ListPolicyRevisionsInput{
		ProjectID: projectID,
		ID:        string(params.PolicyID),
		Limit:     int(params.Limit.Or(0)),
		PageToken: string(params.PageToken.Or("")),
	})
	if err != nil {
		return nil, err
	}
	revisions, err := toAPIPolicies(result.Items)
	if err != nil {
		return nil, err
	}
	resp := &api.ListPolicyRevisionsResponse{Revisions: revisions}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return resp, nil
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

func toAPIPolicies(entities []*domain.Policy) ([]api.Policy, error) {
	out := make([]api.Policy, 0, len(entities))
	for _, entity := range entities {
		policy, err := toAPIPolicy(entity)
		if err != nil {
			return nil, err
		}
		out = append(out, *policy)
	}
	return out, nil
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
