package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
)

// EvaluatePolicyInput is one dry run: the config to evaluate and what the
// operation's request carries and would look up, for the operation named.
type EvaluatePolicyInput struct {
	Operation string
	Config    map[string]any
	// PasswordSet is the request of an [OperationPasswordSet] dry run.
	PasswordSet *PasswordSetEvaluation
}

// PasswordSetEvaluation is a password set as a dry run states it: the
// candidate, and the facts a real set looks up instead.
type PasswordSetEvaluation struct {
	Password    string
	SelfService bool
	// HistoryMatches says whether the candidate matches each of the user's
	// kept passwords, current first, newest first.
	HistoryMatches []bool
}

// PolicyDecision is what the operation would answer: allowed, or refused
// with the live error's code and violations.
type PolicyDecision struct {
	Allowed    bool
	Code       string
	Violations map[string]any
}

// Evaluate runs an operation's policy check on a config the caller passes,
// without reading or writing anything. The config is checked as a publish
// checks it, and the check is the live operation's own code with the
// policy and the looked-up facts swapped in, so a refusal carries the code
// and violations the operation would answer.
func (s *PolicyService) Evaluate(ctx context.Context, in EvaluatePolicyInput) (_ *PolicyDecision, err error) {
	ctx, end := startSpan(ctx, "PolicyService.Evaluate")
	defer end(&err)

	raw, err := s.canonicalConfig(ctx, in.Operation, in.Config)
	if err != nil {
		return nil, err
	}
	inst, err := policyInstance(in.Operation, raw)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to decode policy config")
	}
	switch in.Operation {
	case OperationPasswordSet:
		if in.PasswordSet == nil {
			return nil, domain.ErrInternal(errors.New("no password set to evaluate"))
		}
		gate := &PasswordPolicy{
			engine:   s.engine,
			resolver: instanceResolver{inst},
			history:  statedPasswordHistory(in.PasswordSet.HistoryMatches),
		}
		_, err := gate.CheckPassword(ctx, SetPasswordInput{
			Password:    in.PasswordSet.Password,
			SelfService: in.PasswordSet.SelfService,
		})
		return passwordDecision(err)
	default:
		return nil, domain.ErrInternal(nil).WithMessage("no dry run for operation " + in.Operation)
	}
}

// passwordDecision turns CheckPassword's answer into a decision: its
// refusals are the decision. Anything else it returns is a server fault
// (the policy could not be bound or evaluated), so it stays internal, and the
// refusal codes never reach the caller as errors.
func passwordDecision(err error) (*PolicyDecision, error) {
	if err == nil {
		return &PolicyDecision{Allowed: true}, nil
	}
	if errors.Is(err, domain.ErrUserPasswordEmpty()) {
		return &PolicyDecision{Code: domain.ErrUserPasswordEmpty().Code}, nil
	}
	if errors.Is(err, domain.ErrUserPasswordPolicyViolation(nil)) {
		decision := &PolicyDecision{Code: domain.ErrUserPasswordPolicyViolation(nil).Code}
		var de domain.Error
		if errors.As(err, &de) {
			if details, ok := de.Details.(domain.PasswordPolicyViolations); ok {
				decision.Violations = details.Violations
			}
		}
		return decision, nil
	}
	return nil, domain.ErrInternal(err).WithMessage("failed to evaluate the password policy")
}

// instanceResolver resolves the one instance a dry run evaluates, whatever
// the project.
type instanceResolver struct{ inst *policy.Instance }

func (r instanceResolver) ResolvePolicy(context.Context, string, string) (*policy.Instance, error) {
	return r.inst, nil
}

// statedPasswordHistory is the history a dry run states instead of reading
// the user's kept passwords. Only the first depth entries count, as only that
// many kept passwords would be compared.
type statedPasswordHistory []bool

func (h statedPasswordHistory) matches(_ context.Context, _ SetPasswordInput, depth int64) ([]bool, string, error) {
	// Never nil: the template reads the list, and nil is not an empty one.
	return append([]bool{}, h[:min(int64(len(h)), depth)]...), "", nil
}
