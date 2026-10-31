package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
// first publish. Which revision applies to an operation is ResolvePolicy's
// to decide: a request served a release gets the revision it pins, any other
// the newest. Nothing already stored (a password, a session) is re-evaluated.
func (s *PolicyService) Publish(ctx context.Context, in PublishPolicyInput) (_ *domain.Policy, err error) {
	ctx, end := startSpan(ctx, "PolicyService.Publish")
	defer end(&err)

	raw, err := s.canonicalConfig(ctx, in.Operation, in.Config)
	if err != nil {
		return nil, err
	}
	var entity *domain.Policy
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		current, err := getPolicy(ctx, stmts, in.ProjectID, in.Operation)
		if isNoRowFound(err) {
			entity, err = createPolicy(ctx, stmts, in.ProjectID, in.Operation, raw)
			return err
		}
		if err != nil {
			return err
		}
		// The lock serializes publishes of one operation, so this revision
		// follows the one read above and not a concurrent one.
		if err := stmts.LockPolicy(ctx, current.ProjectID, current.ID); err != nil {
			return err
		}
		entity, err = revisePolicy(ctx, stmts, current, raw)
		return err
	})
	if err != nil {
		return nil, mapPolicyPublishError(err)
	}
	return entity, nil
}

// canonicalConfig validates config against the operation's template and
// returns it in the canonical form the store keeps (12, not 12.0 or 1.2e1),
// so reads, events and a later comparison with the authoring file see one
// spelling.
func (s *PolicyService) canonicalConfig(ctx context.Context, operation string, config map[string]any) (json.RawMessage, error) {
	if config == nil {
		// A missing config is not "no rules": only an explicit {} is.
		return nil, domain.ErrPolicyInvalid(nil, nil).WithMessage("policy: invalid: config is required; use {} to switch every rule off")
	}
	inst := &policy.Instance{Kind: policy.KindPolicy, Operation: operation, Config: config}
	bound, err := s.engine.Bind(ctx, operation, inst)
	if err != nil {
		if errors.Is(err, policy.ErrInvalidInstance) || errors.Is(err, policy.ErrUnknownOperation) {
			return nil, domain.ErrPolicyInvalid(policyInvalidDetails(err), err).WithMessage("policy: invalid: " + strings.TrimPrefix(err.Error(), "policy: "))
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to validate policy")
	}
	settings := bound.Settings()
	if settings == nil {
		settings = map[string]any{}
	}
	raw, err := json.Marshal(settings)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to encode policy config")
	}
	return raw, nil
}

// resolveOrPublish is a release build's publish, on the build's statements,
// so a build that fails leaves no revision behind: the operation's newest
// revision when it already holds config, otherwise a new revision of it (or
// the policy's first). raw comes from canonicalConfig. Only the newest is
// reused, never an older match as for IdP connections: a request that
// resolves no release reads the newest revision (see ResolvePolicy), so going
// back to an earlier config must append it for those requests to apply it
// too. Equality is checked again under the lock, so a concurrent build that
// wrote the same config first is not revised again. A lost unique index is the
// conflict a publish answers; every other write failure goes back to the build
// as is, which maps it as it does every bundled kind's (a missing project is
// rel.project_not_found).
func (s *PolicyService) resolveOrPublish(ctx context.Context, stmts AllStatements, projectID, operation string, raw json.RawMessage) (*domain.Policy, error) {
	current, err := getPolicy(ctx, stmts, projectID, operation)
	if isNoRowFound(err) {
		created, err := createPolicy(ctx, stmts, projectID, operation, raw)
		if err != nil {
			return nil, policyWriteConflict(err)
		}
		return created, nil
	}
	if err != nil {
		return nil, err
	}
	same, err := samePolicyConfig(current, raw)
	if err != nil {
		return nil, err
	}
	if same {
		return current, nil
	}
	if err := stmts.LockPolicy(ctx, current.ProjectID, current.ID); err != nil {
		return nil, err
	}
	locked, err := getPolicy(ctx, stmts, projectID, operation)
	if err != nil {
		return nil, err
	}
	same, err = samePolicyConfig(locked, raw)
	if err != nil {
		return nil, err
	}
	if same {
		return locked, nil
	}
	revision, err := revisePolicy(ctx, stmts, locked, raw)
	if err != nil {
		return nil, policyWriteConflict(err)
	}
	return revision, nil
}

// getPolicy reads the operation's policy at its newest revision. A missing
// policy comes back as the storage's no-row error for the caller to create
// it; any other read failure is internal.
func getPolicy(ctx context.Context, stmts AllStatements, projectID, operation string) (*domain.Policy, error) {
	current, err := stmts.GetPolicy(ctx, policystore.ByOperation(projectID, operation))
	if err != nil && !isNoRowFound(err) {
		return nil, domain.ErrInternal(err).WithMessage("failed to look up policy")
	}
	return current, err
}

// samePolicyConfig reports whether the stored revision already holds raw. A
// stored config that does not decode is an internal error, never "changed".
func samePolicyConfig(stored *domain.Policy, raw json.RawMessage) (bool, error) {
	same, err := domain.JSONEqual(stored.Config, raw)
	if err != nil {
		return false, domain.ErrInternal(err).WithMessage("failed to compare policy configs")
	}
	return same, nil
}

// createPolicy writes the operation's first policy and revision and records
// the event.
func createPolicy(ctx context.Context, stmts AllStatements, projectID, operation string, raw json.RawMessage) (*domain.Policy, error) {
	entity := &domain.Policy{ProjectID: projectID, Operation: operation, Config: raw}
	if err := stmts.CreatePolicy(ctx, entity); err != nil {
		return nil, err
	}
	if err := emitPolicyEvent(ctx, stmts, domain.EventTypePolicyCreated, entity); err != nil {
		return nil, err
	}
	return entity, nil
}

// revisePolicy appends raw as current's newest revision and records the
// event. The caller holds current's lock.
func revisePolicy(ctx context.Context, stmts AllStatements, current *domain.Policy, raw json.RawMessage) (*domain.Policy, error) {
	// Built per call: a read-write transaction may be replayed (Spanner aborts
	// and retries), and an attempt must not start from the state a previous
	// one left behind.
	entity := &domain.Policy{
		ProjectID: current.ProjectID,
		ID:        current.ID,
		Operation: current.Operation,
		Config:    raw,
		CreatedAt: current.CreatedAt,
	}
	if err := stmts.RevisePolicy(ctx, entity); err != nil {
		return nil, err
	}
	if err := emitPolicyEvent(ctx, stmts, domain.EventTypePolicyUpdated, entity); err != nil {
		return nil, err
	}
	return entity, nil
}

func emitPolicyEvent(ctx context.Context, stmts AllStatements, eventType domain.EventType, entity *domain.Policy) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       eventType,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "policy",
		EntityID:   entity.ID,
		Payload: domain.PolicyPayload{
			Operation:  entity.Operation,
			RevisionID: entity.RevisionID,
			Config:     entity.Config,
		},
	})
}

// mapPolicyPublishError turns a failed publish transaction into the error the
// API answers.
func mapPolicyPublishError(err error) error {
	if _, ok := errors.AsType[*database.UniqueError](err); ok {
		return policyWriteConflict(err)
	}
	// The only foreign key a publish can trip is the project's.
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return domain.ErrPolicyInvalid(nil, err).WithMessage("policy: invalid: project does not exist")
	}
	if _, ok := errors.AsType[*database.IntegrityViolationError](err); ok {
		return domain.ErrPolicyInvalid(nil, err).WithMessage("policy: invalid: project does not exist")
	}
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	return domain.ErrInternal(err).WithMessage("failed to publish policy")
}

// policyWriteConflict turns a lost unique index into pol.revision_conflict
// and returns every other error unchanged. A concurrent first publish of the
// operation won the index, or two revisions landed in the same instant: either
// way the caller retries on top of the winner.
func policyWriteConflict(err error) error {
	if _, ok := errors.AsType[*database.UniqueError](err); ok {
		return domain.ErrPolicyRevisionConflict().WithParent(err)
	}
	return err
}

// policyInvalidDetails lists the violations the template found, or returns
// nil when the error names none (an unknown operation).
func policyInvalidDetails(err error) any {
	violations := policy.Violations(err)
	if len(violations) == 0 {
		return nil
	}
	details := domain.PolicyInvalidDetails{Violations: make([]domain.PolicyViolation, 0, len(violations))}
	for _, v := range violations {
		details.Violations = append(details.Violations, domain.PolicyViolation{
			Setting:    v.Setting,
			ConfigRule: v.ConfigRule,
			Settings:   v.Settings,
		})
	}
	return details
}

// ListPoliciesInput pages a project's policies, optionally narrowed to one
// operation.
type ListPoliciesInput struct {
	ProjectID string
	Operation string
	Limit     int
	PageToken string
}

// ListPolicyRevisionsInput pages the revisions of one policy.
type ListPolicyRevisionsInput struct {
	ProjectID string
	ID        string
	Limit     int
	PageToken string
}

// ListPoliciesOutput is one page of policies or revisions.
type ListPoliciesOutput struct {
	Items         []*domain.Policy
	NextPageToken string
}

// Get returns a policy of the project at its newest revision.
func (s *PolicyService) Get(ctx context.Context, projectID, id string) (_ *domain.Policy, err error) {
	ctx, end := startSpan(ctx, "PolicyService.Get")
	defer end(&err)

	entity, err := s.v2Pool.Statements().GetPolicy(ctx, policystore.ByID(projectID, id))
	if err != nil {
		if isNoRowFound(err) {
			return nil, domain.ErrPolicyNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get policy")
	}
	return entity, nil
}

// List returns the project's policies, one per operation at its newest
// revision, first published first.
func (s *PolicyService) List(ctx context.Context, input ListPoliciesInput) (_ *ListPoliciesOutput, err error) {
	ctx, end := startSpan(ctx, "PolicyService.List")
	defer end(&err)

	opts := policystore.ListOptions(input.ProjectID, input.Operation, uint32(normalizeLimit(input.Limit)))
	opts.Pagination.Cursor = []byte(input.PageToken)
	result, err := s.v2Pool.Statements().ListPolicies(ctx, opts)
	if err != nil {
		return nil, mapListError(err, "failed to list policies")
	}
	return &ListPoliciesOutput{Items: result.Items, NextPageToken: string(result.NextCursor)}, nil
}

// ListRevisions pages one policy's revisions, newest first.
func (s *PolicyService) ListRevisions(ctx context.Context, input ListPolicyRevisionsInput) (_ *ListPoliciesOutput, err error) {
	ctx, end := startSpan(ctx, "PolicyService.ListRevisions")
	defer end(&err)

	// The revisions statement answers an unknown policy with an empty page,
	// so the lookup is what tells a miss from a policy's history.
	if _, err := s.Get(ctx, input.ProjectID, input.ID); err != nil {
		return nil, err
	}
	result, err := s.v2Pool.Statements().ListPolicyRevisions(ctx, input.ProjectID, input.ID, database.Page[domain.PolicyField]{
		Limit:   uint32(normalizeLimit(input.Limit)),
		OrderBy: policystore.NewestRevisionFirst(),
		Cursor:  []byte(input.PageToken),
	})
	if err != nil {
		return nil, mapListError(err, "failed to list policy revisions")
	}
	return &ListPoliciesOutput{Items: result.Items, NextPageToken: string(result.NextCursor)}, nil
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

// ResolvePolicy implements [PolicyResolver]: the policy revision that applies
// to the request for the operation, or nil when there is none.
//
// A request whose release pins a flow reads the revision that release pins
// for the operation, like the user schema, branding and identity providers
// it serves; a release that pins none means no policy, never the newest
// stored revision (ADR 066). Any other request, which resolved no release or
// one that pins no flow, reads the newest revision until it resolves one
// (#1616).
//
// It reads through the pool, outside any transaction: the password gate runs
// in Prepare, before the write transaction begins.
func (s *PolicyService) ResolvePolicy(ctx context.Context, projectID, operation string) (_ *policy.Instance, err error) {
	ctx, end := startSpan(ctx, "PolicyService.ResolvePolicy")
	defer end(&err)

	stmts := s.v2Pool.Statements()
	var entity *domain.Policy
	if ReleasePinsFlow(ctx) {
		revisionID, ok := PinsFor(ReleaseFromContext(ctx), domain.ReleasePointerKindPolicy)[operation]
		if !ok {
			return nil, nil
		}
		entity, err = stmts.GetPolicyRevision(ctx, projectID, revisionID)
		if isNoRowFound(err) {
			return nil, domain.ErrInternal(err).WithMessage(fmt.Sprintf("release pins a missing policy revision for %q", operation))
		}
		if err != nil {
			return nil, err
		}
	} else {
		entity, err = stmts.GetPolicy(ctx, policystore.ByOperation(projectID, operation))
		if err != nil {
			if isNoRowFound(err) {
				return nil, nil
			}
			return nil, err
		}
	}
	return policyInstance(entity.Operation, entity.Config)
}

// policyInstance decodes a stored or canonical config into the instance the
// engine binds, numbers kept exact.
func policyInstance(operation string, raw json.RawMessage) (*policy.Instance, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var config map[string]any
	if err := dec.Decode(&config); err != nil {
		return nil, err
	}
	return &policy.Instance{Kind: policy.KindPolicy, Operation: operation, Config: config}, nil
}
