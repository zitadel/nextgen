package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/policystore"
)

// PublishPolicyInput is one publish of a project's policy for an operation:
// the instance's settings, which the operation's template validates.
type PublishPolicyInput struct {
	ProjectID string
	Operation string
	Config    map[string]any
}

// PolicyService publishes operation policies and resolves the one an
// operation is evaluated against (ADR 066). A project has one policy per
// operation; every publish appends an immutable revision (ADR 063).
type PolicyService struct {
	v2Pool *DB
	engine *policy.Engine
}

func NewPolicyService(v2Pool *DB, engine *policy.Engine) *PolicyService {
	return &PolicyService{v2Pool: v2Pool, engine: engine}
}

var _ PolicyResolver = (*PolicyService)(nil)

// Publish validates the instance against the operation's template and
// appends it as the operation's newest revision, creating the policy on the
// first publish. The newest revision applies to the next operation; nothing
// already stored (a password, a session) is re-evaluated.
func (s *PolicyService) Publish(ctx context.Context, in PublishPolicyInput) (_ *domain.Policy, err error) {
	ctx, end := startSpan(ctx, "PolicyService.Publish")
	defer end(&err)

	config := in.Config
	if config == nil {
		// A missing config is not "no rules": only an explicit {} is.
		return nil, domain.ErrPolicyInvalid(nil, nil).WithMessage("policy: invalid: config is required; use {} to switch every rule off")
	}
	inst := &policy.Instance{Kind: policy.KindPolicy, Operation: in.Operation, Config: config}
	bound, err := s.engine.Bind(ctx, in.Operation, inst)
	if err != nil {
		if errors.Is(err, policy.ErrInvalidInstance) || errors.Is(err, policy.ErrUnknownOperation) {
			return nil, domain.ErrPolicyInvalid(nil, err).WithMessage("policy: invalid: " + strings.TrimPrefix(err.Error(), "policy: "))
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to validate policy")
	}
	// Stored in canonical form (12, not 12.0 or 1.2e1), so reads, events and a
	// later comparison with the authoring file see one spelling.
	settings := bound.Settings()
	if settings == nil {
		settings = map[string]any{}
	}
	raw, err := json.Marshal(settings)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to encode policy config")
	}

	var entity *domain.Policy
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		// Built per attempt: a read-write transaction may be replayed (Spanner
		// aborts and retries), and an attempt must not start from the state a
		// previous one left behind.
		entity = &domain.Policy{ProjectID: in.ProjectID, Operation: in.Operation, Config: raw}
		eventType := domain.EventTypePolicyCreated
		stmts := tx.Statements()
		current, err := stmts.GetPolicy(ctx, policystore.ByOperation(in.ProjectID, in.Operation))
		switch {
		case err == nil:
			// The lock serializes publishes of one operation, so this
			// revision follows the one read above and not a concurrent one.
			if err := stmts.LockPolicy(ctx, current.ProjectID, current.ID); err != nil {
				return err
			}
			entity.ID, entity.CreatedAt = current.ID, current.CreatedAt
			if err := stmts.RevisePolicy(ctx, entity); err != nil {
				return err
			}
			eventType = domain.EventTypePolicyUpdated
		case isNoRowFound(err):
			if err := stmts.CreatePolicy(ctx, entity); err != nil {
				return err
			}
		default:
			return err
		}
		return audit.Emit(ctx, stmts, audit.EmitSpec{
			Type:       eventType,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  entity.ProjectID,
			EntityType: "policy",
			EntityID:   entity.ID,
			Payload: domain.PolicyPayload{
				Operation:  entity.Operation,
				RevisionID: entity.RevisionID,
				Config:     raw,
			},
		})
	})
	if err != nil {
		// A concurrent first publish of the operation won the unique index, or
		// two revisions landed in the same instant: either way the caller
		// retries on top of the winner.
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return nil, domain.ErrPolicyRevisionConflict().WithParent(err)
		}
		// The only foreign key a publish can trip is the project's.
		if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
			return nil, domain.ErrPolicyInvalid(nil, err).WithMessage("policy: invalid: project does not exist")
		}
		if _, ok := errors.AsType[*database.IntegrityViolationError](err); ok {
			return nil, domain.ErrPolicyInvalid(nil, err).WithMessage("policy: invalid: project does not exist")
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to publish policy")
	}
	return entity, nil
}

// GetRevision returns one revision of a policy in the project, newest or not.
func (s *PolicyService) GetRevision(ctx context.Context, projectID, revisionID string) (_ *domain.Policy, err error) {
	ctx, end := startSpan(ctx, "PolicyService.GetRevision")
	defer end(&err)

	entity, err := s.v2Pool.Statements().GetPolicyRevision(ctx, projectID, revisionID)
	if err != nil {
		if isNoRowFound(err) {
			return nil, domain.ErrPolicyNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get policy revision")
	}
	return entity, nil
}

// ResolvePolicy implements [PolicyResolver]: the newest revision of the
// project's policy for the operation, or nil when the project has none.
//
// It reads through the pool, outside any transaction: the password gate runs
// in Prepare, before the write transaction begins. Until releases pin
// policies, the newest stored revision is what applies (ADR 066).
func (s *PolicyService) ResolvePolicy(ctx context.Context, projectID, operation string) (_ *policy.Instance, err error) {
	ctx, end := startSpan(ctx, "PolicyService.ResolvePolicy")
	defer end(&err)

	entity, err := s.v2Pool.Statements().GetPolicy(ctx, policystore.ByOperation(projectID, operation))
	if err != nil {
		if isNoRowFound(err) {
			return nil, nil
		}
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(entity.Config))
	dec.UseNumber()
	var config map[string]any
	if err := dec.Decode(&config); err != nil {
		return nil, err
	}
	return &policy.Instance{Kind: policy.KindPolicy, Operation: entity.Operation, Config: config}, nil
}
