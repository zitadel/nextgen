package service

import (
	"context"
	"log/slog"
	"unicode/utf8"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// PasswordSaveOperation is the catalogued operation guarding a password set.
const PasswordSaveOperation = "user.password.save"

// PasswordPolicy evaluates the `user.password.save` policy (ADR 066) before a
// password is stored. It derives the request context in Go, so the rules
// never see the password: only its length and whether it matches a previous
// one.
type PasswordPolicy struct {
	engine   *policy.Engine
	resolver policy.Resolver
	verifier crypto.HashVerifier
}

// NewPasswordPolicy wires the engine, the instance resolver and the hash
// verifier used for the history check. A nil resolver means every project
// runs on the template defaults.
func NewPasswordPolicy(engine *policy.Engine, resolver policy.Resolver, verifier crypto.HashVerifier) *PasswordPolicy {
	return &PasswordPolicy{engine: engine, resolver: resolver, verifier: verifier}
}

// Constraints returns the pre-auth projection for the project's effective
// instance: what a login form renders before the user types.
func (p *PasswordPolicy) Constraints(ctx context.Context, projectID string, hint policy.Hint) (policy.Constraints, error) {
	inst, err := policy.Effective(ctx, p.engine, p.resolver, projectID, PasswordSaveOperation, hint)
	if err != nil {
		return policy.Constraints{}, err
	}
	return p.engine.Constraints(inst)
}

// FieldValidation projects the constraints onto the flow field validation
// the step payload already carries. Only the project default is reachable
// here: the field resolver runs before the request's team is known.
func (p *PasswordPolicy) FieldValidation(ctx context.Context, projectID string) (*domain.FlowFieldValidation, error) {
	c, err := p.Constraints(ctx, projectID, policy.Hint{})
	if err != nil {
		return nil, err
	}
	out := &domain.FlowFieldValidation{}
	if n, ok := c.Rules["min_length"]["min_length"].(int64); ok {
		out.MinLength = int(n)
	}
	return out, nil
}

// Check evaluates the policy for a candidate password. It returns
// [domain.ErrUserPasswordPolicyViolation] on a blocking deny and nil when the
// operation may proceed. Under `enforcement: audit` a deny is logged and the
// operation proceeds.
func (p *PasswordPolicy) Check(ctx context.Context, stmts AllStatements, projectID, userID, candidate string) error {
	inst, err := policy.Effective(ctx, p.engine, p.resolver, projectID, PasswordSaveOperation, policy.Hint{})
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to resolve password policy")
	}
	requestContext, err := p.buildContext(ctx, stmts, inst, projectID, userID, candidate)
	if err != nil {
		return err
	}
	decision, err := p.engine.Evaluate(ctx, inst, requestContext)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to evaluate password policy")
	}
	if decision.Allow {
		return nil
	}
	if !inst.Blocks() {
		// TODO(ADR 066): record the audit decision as a wide event once the
		// event type is catalogued; until then it is only logged.
		slog.WarnContext(ctx, "password policy denied in audit mode",
			slog.String("project_id", projectID),
			slog.String("user_id", userID),
			slog.Any("violations", decision.Violations),
		)
		return nil
	}
	return domain.ErrUserPasswordPolicyViolation(decision.Violations)
}

// buildContext derives the `user.password.save` context. Length counts
// Unicode characters, as NIST 800-63B requires. History compares the
// candidate against the stored password only when the policy enables
// history: the current password is the one entry available today, and it
// counts as soon as history is on (#898).
func (p *PasswordPolicy) buildContext(ctx context.Context, stmts AllStatements, inst *policy.Instance, projectID, userID, candidate string) (map[string]any, error) {
	historyMatches := []bool{}
	if p.historyEnabled(inst) {
		current, err := stmts.GetUserPassword(ctx, database.And(
			database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
			database.Equal(database.Col(domain.UserPasswordFieldUserID), userID),
		))
		switch {
		case err == nil:
			historyMatches = append(historyMatches, p.verifier.VerifyHash(current.EncodedHash, candidate) == nil)
		case isNoRowFound(err):
			// first password: nothing to compare against
		default:
			return nil, domain.ErrInternal(err).WithMessage("failed to load password history")
		}
	}
	return map[string]any{
		"candidate": map[string]any{
			"length": int64(utf8.RuneCountInString(candidate)),
		},
		"history_matches": historyMatches,
	}, nil
}

// historyEnabled reads the effective history depth: the instance value when
// set, the template default otherwise.
func (p *PasswordPolicy) historyEnabled(inst *policy.Instance) bool {
	raw, set := inst.Config["history_depth"]
	if !set {
		t, err := p.engine.Template(PasswordSaveOperation)
		if err != nil {
			return false
		}
		raw = t.Config["history_depth"].Default
	}
	switch v := raw.(type) {
	case int64:
		return v > 0
	case int:
		return v > 0
	case float64:
		return v > 0
	}
	return false
}
