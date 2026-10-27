package service

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// OperationPasswordSet is the policy operation every password set is
// evaluated against (ADR 066). It is named after the event the set emits.
const OperationPasswordSet = string(domain.EventTypeAuthFactorPasswordSet)

// PasswordGate decides whether a candidate password may be stored. Every path
// that stores a password a user or administrator chose calls it before
// hashing, so no API, SDK or journey can set one past it. The bootstrap user
// import is the exception: it stores hashes it was given, and a hash cannot be
// checked against a policy. An allowed candidate comes with the
// [PasswordCheck] the write must still hold to inside its transaction.
type PasswordGate interface {
	CheckPassword(ctx context.Context, in SetPasswordInput) (PasswordCheck, error)
}

// PasswordCheck is what an allowed check depended on that can change before
// the write. When the candidate was compared with the user's kept passwords,
// the write must replace the password that was current then; otherwise a
// change landed in between and the comparison is stale.
type PasswordCheck struct {
	// HistoryChecked is true when the candidate was compared with the user's
	// kept passwords.
	HistoryChecked bool
	// CurrentPasswordID is the id of the password that was current when the
	// candidate was compared, empty when the user had none.
	CurrentPasswordID string
}

// PolicyResolver returns the project's governing instance for an operation,
// or nil when the project has none: no instance means no policy.
type PolicyResolver interface {
	ResolvePolicy(ctx context.Context, projectID, operation string) (*policy.Instance, error)
}

// NoPolicyResolver resolves no instance for any project, so the gate applies
// only the server's own length cap. The server resolves through
// [PolicyService]; this stands in where no project's policy matters, such as
// tests.
type NoPolicyResolver struct{}

func (NoPolicyResolver) ResolvePolicy(context.Context, string, string) (*policy.Instance, error) {
	return nil, nil
}

// PasswordPolicy is the gate for [OperationPasswordSet]: it resolves the
// project's instance, derives the request context from the candidate and
// evaluates the policy before the password is hashed.
type PasswordPolicy struct {
	engine   *policy.Engine
	resolver PolicyResolver
	verifier crypto.HashVerifier
	pool     StatementPool
}

// NewPasswordPolicy builds the gate. verifier is the deployment-wide hash
// verifier, which can check every stored hash whatever method wrote it; pool
// reads the passwords a history check compares against. It fails when the
// catalog has no template for [OperationPasswordSet], so a renamed event or
// template stops the server at startup instead of failing every password set.
func NewPasswordPolicy(engine *policy.Engine, resolver PolicyResolver, verifier crypto.HashVerifier, pool StatementPool) (*PasswordPolicy, error) {
	if _, err := engine.Template(OperationPasswordSet); err != nil {
		return nil, fmt.Errorf("password policy: %w", err)
	}
	return &PasswordPolicy{engine: engine, resolver: resolver, verifier: verifier, pool: pool}, nil
}

var _ PasswordGate = (*PasswordPolicy)(nil)

var _ domain.FlowPasswordPolicy = (*PasswordPolicy)(nil)

// PasswordLengthBounds implements [domain.FlowPasswordPolicy]: the length
// bounds of the project's policy, which a flow step that asks for a new
// password shows and checks before the gate does. Without a policy, or for a
// bound it leaves unset, the minimum is 0 and the maximum is the domain cap.
// Like the gate, it fails closed when the policy cannot be read.
func (p *PasswordPolicy) PasswordLengthBounds(ctx context.Context, projectID string) (minLength, maxLength int, err error) {
	bound, err := p.bind(ctx, projectID)
	if err != nil {
		return 0, 0, err
	}
	constraints, err := bound.Constraints()
	if err != nil {
		return 0, 0, domain.ErrInternal(err).WithMessage("failed to read the password policy")
	}
	maxLength = domain.MaxPasswordLength
	if v, set, err := intSetting(constraints.Rules, "min_length"); err != nil {
		return 0, 0, err
	} else if set {
		minLength = int(v)
	}
	if v, set, err := intSetting(constraints.Rules, "max_length"); err != nil {
		return 0, 0, err
	} else if set && int(v) < maxLength {
		maxLength = int(v)
	}
	return minLength, maxLength, nil
}

// bind resolves the project's password policy and binds it to the template.
// A policy that cannot be read, or a stored instance the current template
// rejects, fails closed: the compatibility test is meant to prevent the
// latter, and refusing is the only safe answer when it happens anyway.
func (p *PasswordPolicy) bind(ctx context.Context, projectID string) (*policy.Bound, error) {
	inst, err := p.resolver.ResolvePolicy(ctx, projectID, OperationPasswordSet)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to resolve the password policy")
	}
	bound, err := p.engine.Bind(ctx, OperationPasswordSet, inst)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to bind the password policy")
	}
	return bound, nil
}

// intSetting reads an integer setting from the policy's constraints. A
// missing key is an unset rule; a present value that is not an int64 fails
// closed, because reading it as unset would drop the rule and let a password
// through.
func intSetting(rules map[string]any, name string) (value int64, set bool, err error) {
	raw, ok := rules[name]
	if !ok {
		return 0, false, nil
	}
	v, ok := raw.(int64)
	if !ok {
		return 0, false, domain.ErrInternal(fmt.Errorf("%s is %v", name, raw)).WithMessage("failed to read the password policy")
	}
	return v, true, nil
}

// CheckPassword evaluates the candidate. A denied candidate returns
// [domain.ErrUserPasswordPolicyViolation] naming every failed rule; a
// candidate over the server's cap is reported the same way, as max_length,
// so a client renders both alike. A failure to resolve, bind or build the
// context fails the operation closed.
func (p *PasswordPolicy) CheckPassword(ctx context.Context, in SetPasswordInput) (PasswordCheck, error) {
	normalized := domain.NormalizePassword(in.Password)
	// An empty password is a domain guard, not a policy rule: it is refused
	// the same way whatever min_length a project sets.
	if normalized == "" {
		return PasswordCheck{}, domain.ErrUserPasswordEmpty()
	}
	length := utf8.RuneCountInString(normalized)

	bound, err := p.bind(ctx, in.ProjectID)
	if err != nil {
		return PasswordCheck{}, err
	}

	// A candidate over the cap is refused whatever the history says, so it is
	// not compared: the comparison costs up to history_depth slow hashes, and
	// a kept hash that cannot be read would turn the max_length refusal into
	// an internal error.
	var check PasswordCheck
	matches := []bool{}
	if in.SelfService && length <= domain.MaxPasswordLength {
		matches, check, err = p.historyMatches(ctx, bound, in)
		if err != nil {
			return PasswordCheck{}, err
		}
	}
	decision, err := bound.Evaluate(ctx, map[string]any{
		"candidate":       map[string]any{"length": length},
		"self_service":    in.SelfService,
		"history_matches": matches,
	})
	if err != nil {
		return PasswordCheck{}, domain.ErrInternal(err).WithMessage("failed to evaluate the password policy")
	}

	violations := decision.Violations
	if _, reported := violations["max_length"]; !reported && length > domain.MaxPasswordLength {
		if violations == nil {
			violations = make(map[string]any, 1)
		}
		violations["max_length"] = int64(domain.MaxPasswordLength)
	}
	if len(violations) > 0 {
		return PasswordCheck{}, domain.ErrUserPasswordPolicyViolation(violations)
	}
	return check, nil
}

// historyMatches compares the candidate with the user's kept passwords,
// current first, newest first, and only as many as the policy's depth: each
// comparison is a deliberately slow hash verification. With history off it
// verifies nothing.
func (p *PasswordPolicy) historyMatches(ctx context.Context, bound *policy.Bound, in SetPasswordInput) ([]bool, PasswordCheck, error) {
	active, err := bound.Active("history_depth")
	if err != nil {
		return nil, PasswordCheck{}, domain.ErrInternal(err).WithMessage("failed to read the password policy")
	}
	if !active {
		return []bool{}, PasswordCheck{}, nil
	}
	constraints, err := bound.Constraints()
	if err != nil {
		return nil, PasswordCheck{}, domain.ErrInternal(err).WithMessage("failed to read the password policy")
	}
	depth, set, err := intSetting(constraints.Rules, "history_depth")
	if err != nil {
		return nil, PasswordCheck{}, err
	}
	if !set || depth < 1 {
		// Reading no depth would verify nothing and let any password through.
		return nil, PasswordCheck{}, domain.ErrInternal(fmt.Errorf("history_depth is %v", constraints.Rules["history_depth"])).WithMessage("failed to read the password policy")
	}
	check := PasswordCheck{HistoryChecked: true}

	stmts := p.pool.Statements()
	var kept []*domain.UserPassword
	current, err := stmts.GetUserPassword(ctx, database.And(
		database.Equal(database.Col(domain.UserPasswordFieldProjectID), in.ProjectID),
		database.Equal(database.Col(domain.UserPasswordFieldUserID), in.UserID),
	))
	if _, none := errors.AsType[*database.NoRowFoundError](err); err != nil && !none {
		return nil, PasswordCheck{}, domain.ErrInternal(err).WithMessage("failed to read the current password")
	}
	if err == nil {
		check.CurrentPasswordID = current.ID
		kept = append(kept, current)
		if depth > 1 {
			previous, err := stmts.GetUserPasswordHistory(ctx, in.ProjectID, in.UserID)
			if err != nil {
				return nil, PasswordCheck{}, domain.ErrInternal(err).WithMessage("failed to read the password history")
			}
			kept = append(kept, previous...)
		}
	}

	// A hash that cannot be verified is not "different": reading it as a
	// mismatch would let that password be reused. Only a real mismatch counts
	// as no match; anything else fails the set closed.
	candidate := domain.NormalizePassword(in.Password)
	matches := make([]bool, 0, min(int64(len(kept)), depth))
	for _, pw := range kept[:min(int64(len(kept)), depth)] {
		err := p.verifier.VerifyHash(pw.EncodedHash, candidate)
		switch {
		case err == nil:
			matches = append(matches, true)
		case errors.Is(err, crypto.ErrHashMismatch):
			matches = append(matches, false)
		default:
			return nil, PasswordCheck{}, domain.ErrInternal(err).WithMessage("failed to compare with a kept password")
		}
	}
	return matches, check, nil
}
