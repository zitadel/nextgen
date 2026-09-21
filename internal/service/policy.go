package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/storage/database"
	policystore "github.com/zitadel/nextgen/internal/storage/policy"
)

// CreatePolicyInput publishes one instance document as a new revision.
type CreatePolicyInput struct {
	ProjectID string
	Instance  *policy.Instance
}

// PolicyService publishes and resolves immutable policy revisions (ADR 066).
// Revisions are create-only; evaluation resolves the newest revision per
// operation and audience, which makes the service the [policy.Resolver] the
// gates read from.
type PolicyService struct {
	v2Pool *DB
	engine *policy.Engine
}

func NewPolicyService(v2Pool *DB, engine *policy.Engine) *PolicyService {
	return &PolicyService{v2Pool: v2Pool, engine: engine}
}

var _ policy.Resolver = (*PolicyService)(nil)

// Engine exposes the compiled catalog for callers that need constraints or
// warnings next to the stored revisions.
func (s *PolicyService) Engine() *policy.Engine {
	return s.engine
}

// Create validates the instance against its template and publishes it.
func (s *PolicyService) Create(ctx context.Context, input CreatePolicyInput) (*domain.Policy, error) {
	entity, err := domain.NewPolicy(input.ProjectID, input.Instance)
	if err != nil {
		return nil, err
	}
	if err := s.engine.ValidateInstance(entity.Instance()); err != nil {
		return nil, domain.ErrPolicyInvalid(err.Error(), err)
	}
	if err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreatePolicy(ctx, entity); err != nil {
			return err
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypePolicyCreated,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  entity.ProjectID,
			EntityType: "policy",
			EntityID:   entity.ID,
			Payload: domain.PolicyPayload{
				Operation:   entity.Operation,
				Enforcement: string(entity.Enforcement),
				TeamIDs:     entity.Audience.TeamIDs,
			},
		})
	}); err != nil {
		if _, ok := errors.AsType[*database.IntegrityViolationError](err); ok {
			return nil, domain.ErrPolicyInvalid("project does not exist", err)
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create policy revision in database")
	}
	return entity, nil
}

// Get returns a single revision by id.
func (s *PolicyService) Get(ctx context.Context, projectID, id string) (*domain.Policy, error) {
	entity, err := s.v2Pool.Statements().GetPolicyByID(ctx, projectID, id)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrPolicyNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get policy revision from database")
	}
	return entity, nil
}

// maxPolicyListRevisions caps the list response, as branding does: revisions
// accumulate forever by design.
const maxPolicyListRevisions = 100

// List returns the project's revisions, newest first, capped.
func (s *PolicyService) List(ctx context.Context, projectID string) ([]*domain.Policy, error) {
	result, err := s.v2Pool.Statements().ListPolicies(ctx, policystore.ListOptions(projectID, maxPolicyListRevisions))
	if err != nil {
		return nil, mapListError(err, "failed to list policy revisions")
	}
	return result.Items, nil
}

// Resolve implements [policy.Resolver]: among the operation's stored
// revisions the most specific matching audience wins (ADR 065), newest first
// within a tier; nil when the project has authored nothing, so the caller
// falls back to the template defaults.
func (s *PolicyService) Resolve(ctx context.Context, projectID, operation string, hint policy.Hint) (*policy.Instance, error) {
	result, err := s.v2Pool.Statements().ListPolicies(
		WithAuthzListUnrestricted(ctx),
		policystore.ListOperationOptions(projectID, operation, maxPolicyListRevisions),
	)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to resolve policy revision")
	}
	resolver := policy.NewStaticResolver()
	for _, revision := range result.Items {
		resolver.Add(projectID, revision.Instance())
	}
	return resolver.Resolve(ctx, projectID, operation, hint)
}
