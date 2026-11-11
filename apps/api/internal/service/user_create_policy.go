package service

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
)

// OperationUserCreate is the policy operation a sign-up is evaluated against
// (ADR 088). It is named after `user.created`, the event it precedes.
const OperationUserCreate = "user.create"

// UserCreatePolicy is the gate for [OperationUserCreate] on the public plane:
// which challenge a sign-up must solve, and whether the one it solved is that
// challenge. The guard, the signup proof of work and its per-flow limits,
// applies with or without a policy: a policy chooses among challenges and
// never switches the guard off (ADR 078 §4, ADR 088 §5). Credentialed callers
// are never challenged (ADR 088 §3), so creating a user through the API does
// not call it.
type UserCreatePolicy struct {
	engine   *policy.Engine
	resolver PolicyResolver
}

// NewUserCreatePolicy builds the gate. It fails when the catalog has no
// template for [OperationUserCreate], so a renamed template stops the server
// at startup instead of failing every sign-up.
func NewUserCreatePolicy(engine *policy.Engine, resolver PolicyResolver) (*UserCreatePolicy, error) {
	if _, err := engine.Template(OperationUserCreate); err != nil {
		return nil, fmt.Errorf("user create policy: %w", err)
	}
	return &UserCreatePolicy{engine: engine, resolver: resolver}, nil
}

// Challenge is the challenge a sign-up in the project must solve: the one
// the policy names, or the guard's built-in proof of work when it names none.
// Like the password gate, it fails closed when the policy cannot be read.
func (p *UserCreatePolicy) Challenge(ctx context.Context, projectID string) (string, error) {
	bound, err := p.bind(ctx, projectID)
	if err != nil {
		return "", err
	}
	constraints, err := bound.Constraints()
	if err != nil {
		return "", domain.ErrInternal(err).WithMessage("failed to read the user create policy")
	}
	raw, set := constraints.Rules["challenge"]
	if !set {
		return domain.SignupGateProvider, nil
	}
	// The template admits only strings from its enum; anything else read as
	// "unset" would serve a challenge the policy does not name.
	challenge, ok := raw.(string)
	if !ok {
		return "", domain.ErrInternal(fmt.Errorf("challenge is %v", raw)).WithMessage("failed to read the user create policy")
	}
	return challenge, nil
}

// CheckSolved evaluates the policy for a sign-up that solved the named
// challenge. One the policy does not name is refused as an invalid proof,
// so the client refreshes the step and gets the challenge the policy asks
// for.
func (p *UserCreatePolicy) CheckSolved(ctx context.Context, projectID, solved string) error {
	bound, err := p.bind(ctx, projectID)
	if err != nil {
		return err
	}
	decision, err := bound.Evaluate(ctx, map[string]any{"solved_challenge": solved})
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to evaluate the user create policy")
	}
	if !decision.Allow {
		return domain.ErrFlowProofInvalid()
	}
	return nil
}

// bind resolves the project's user create policy and binds it to the
// template. A policy that cannot be read, or a stored instance the current
// template rejects, fails closed, as for passwords.
func (p *UserCreatePolicy) bind(ctx context.Context, projectID string) (*policy.Bound, error) {
	inst, err := p.resolver.ResolvePolicy(ctx, projectID, OperationUserCreate)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to resolve the user create policy")
	}
	bound, err := p.engine.Bind(ctx, OperationUserCreate, inst)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to bind the user create policy")
	}
	return bound, nil
}
