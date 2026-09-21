package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreatePolicy(ctx context.Context, req *api.Policy, params api.CreatePolicyParams) (api.CreatePolicyRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), policyAccess, opWrite); err != nil {
		return nil, err
	}
	inst, err := convertUsingJson[policy.Instance](req)
	if err != nil {
		return nil, domain.ErrPolicyInvalid("malformed policy document", err)
	}
	revision, err := h.policyService.Create(ctx, service.CreatePolicyInput{
		ProjectID: string(params.ProjectID),
		Instance:  inst,
	})
	if err != nil {
		return nil, err
	}
	return policyRevisionResponse(revision)
}

func (h *Handler) GetPolicyById(ctx context.Context, params api.GetPolicyByIdParams) (api.GetPolicyByIdRes, error) {
	projectID, err := h.requireResourceAccess(ctx, params.ID, policyAccess, opRead)
	if err != nil {
		return nil, err
	}
	revision, err := h.policyService.Get(ctx, projectID, params.ID)
	if err != nil {
		return nil, err
	}
	return policyRevisionResponse(revision)
}

func (h *Handler) ListPolicies(ctx context.Context, params api.ListPoliciesParams) (api.ListPoliciesRes, error) {
	ctx, err := h.requireProjectListAccess(ctx, string(params.ProjectID), policyAccess, domain.ResourceKindPolicy)
	if err != nil {
		return nil, err
	}
	revisions, err := h.policyService.List(ctx, string(params.ProjectID))
	if err != nil {
		return nil, err
	}
	resp := make(api.ListPoliciesResponse, 0, len(revisions))
	for _, r := range revisions {
		resp = append(resp, api.ListPoliciesResponseItem{
			ID:        r.ID,
			Operation: r.Operation,
			CreatedAt: r.CreatedAt,
		})
	}
	return &resp, nil
}

// policyRevisionResponse echoes the stored document through the wire type so
// the CLI reconciles against exactly what the server keeps.
func policyRevisionResponse(r *domain.Policy) (*api.PolicyRevisionResponse, error) {
	doc, err := convertUsingJson[api.Policy](r.Instance())
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to render policy revision")
	}
	return &api.PolicyRevisionResponse{
		ID:        r.ID,
		CreatedAt: r.CreatedAt,
		Policy:    *doc,
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
	default:
		return internalErrorResponse(err)
	}
}
