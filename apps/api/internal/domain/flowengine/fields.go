package flowengine

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/maputil"
)

// resolveInputs resolves the step's fields and prefills any values the
// user already supplied on earlier steps.
func (r *FlowStateMachineRuntime) resolveInputs(pc *processCtx) (domain.FlowResolvedFields, error) {
	resolved, err := r.resolveStepFields(pc.ctx, pc.state, pc.currentStep)
	if err != nil {
		return domain.FlowResolvedFields{}, err
	}
	if err := r.prefillStep(pc.ctx, pc.state, pc.currentStep, &resolved); err != nil {
		return domain.FlowResolvedFields{}, err
	}
	return resolved, nil
}

// prefillStep fills the step's empty fields with values the user already
// supplied. A step that creates the user from an SSO identity takes the
// provider's claims first, so the collected data fills only what the provider
// left out. Without a parked identity that step renders empty: its submit
// cannot succeed. A field showing a verified unique claim is read-only, since
// the submit refuses a changed value.
func (r *FlowStateMachineRuntime) prefillStep(ctx context.Context, state *domain.FlowState, step *domain.FlowDefinitionStep, resolved *domain.FlowResolvedFields) error {
	if step.OnSuccess != nil && *step.OnSuccess == domain.FlowOnSuccessCreateUserWithSso {
		collected, err := r.ssoIdentities.LoadCollected(ctx, domain.FlowSSOLoadInput{
			ProjectID:       state.ProjectID,
			AttemptID:       state.AuthAttemptID,
			UserSchemaURL:   state.UserSchemaURL,
			ResolvedCheckID: state.SSOResolvedCheckID,
		})
		if err != nil {
			return fmt.Errorf("flow state machine: load collected sso identity: %w", err)
		}
		if collected == nil {
			return nil
		}
		prefillFromCollected(resolved, collected.Claims)
		for i := range resolved.Fields {
			f := &resolved.Fields[i]
			// The provider verifies a top-level claim, so a nested leaf takes
			// its object's status.
			if f.Unique == domain.AttributeUniquenessUnspecified || !collected.Verified[domain.AttributeKey(f.Name).Nodes()[0]] {
				continue
			}
			// The submit refuses any value but this claim, so lock the field
			// only when the prefill put the claim in it.
			if _, fromClaim := collectedString(collected.Claims, f.Name); fromClaim {
				f.ReadOnly = true
			}
		}
	}
	prefillFromCollected(resolved, state.CollectedData.UserData)
	return nil
}

// validateAndMerge checks the submitted values and, on success, folds
// them into CollectedData. Returns a rendered halt step on validation
// failure.
//
// Every action validates the values it sent — which is why a leg that
// consumes a subset is narrowed to that subset before it gets here (see
// [identifierFieldsOnly]); field-collecting actions (see
// [collectsStepFields]) additionally require declared required fields to be
// present.
func (r *FlowStateMachineRuntime) validateAndMerge(pc *processCtx, resolved domain.FlowResolvedFields, actionKind domain.FlowActionKind) (*FlowStepResult, error) {
	var errs domain.FlowFieldValidationErrors
	if validationErr := r.fields.Validate(resolved, pc.in.Fields); validationErr != nil {
		v, ok := errors.AsType[domain.FlowFieldValidationErrors](validationErr)
		if !ok {
			return nil, fmt.Errorf("flow state machine: validate fields: %w", validationErr)
		}
		errs = append(errs, v...)
	}
	if collectsStepFields(actionKind, pc.in) {
		errs = append(errs, r.fields.MissingRequired(resolved, pc.in.Fields)...)
	}
	if len(errs) > 0 {
		domain.SortFlowFieldValidationErrors(errs)
		// The violations name fields and rules, never values.
		step, err := r.buildStep(pc.ctx, pc.state, pc.currentStep, resolved, domain.FlowStepFailed(errs.StepError(), errs), nil, nil)
		if err != nil {
			return nil, err
		}
		pc.state.IssuedAt = r.now()
		return &FlowStepResult{State: pc.state, Step: step}, nil
	}

	return nil, collectStepFields(pc.state, resolved, pc.in.Fields)
}

// collectStepFields folds a validated submission into CollectedData. A blank
// optional field with a format is an unset attribute, not a value: a user write
// refuses "" for it, possibly on a later step with no such field to correct. It
// also clears what an earlier visit to the step collected for that field.
func collectStepFields(state *domain.FlowState, resolved domain.FlowResolvedFields, values map[string]any) error {
	kept := maps.Clone(values)
	for _, field := range resolved.Fields {
		if field.Required || field.Validation == nil || field.Validation.Format == "" || values[field.Name] != "" {
			continue
		}
		delete(kept, field.Name)
		maputil.DeleteNested(state.CollectedData.UserData, domain.AttributeKey(field.Name).Nodes())
	}
	if err := mergeCollected(state, kept); err != nil {
		return fmt.Errorf("flow state machine: validate fields: %w", err)
	}
	return nil
}

func (r *FlowStateMachineRuntime) resolveStepFields(ctx context.Context, state *domain.FlowState, step *domain.FlowDefinitionStep) (domain.FlowResolvedFields, error) {
	if len(step.Fields) == 0 {
		return domain.FlowResolvedFields{}, nil
	}
	schema, err := r.schemas.Resolve(ctx, r.schemaStore, state.ProjectID, state.UserSchemaURL, nil)
	if err != nil {
		return domain.FlowResolvedFields{}, fmt.Errorf("flow state machine: load user schema on step %q: %w", step.Name, err)
	}
	resolved, err := r.fields.Resolve(schema, step.Name, step.Fields)
	if err != nil {
		return domain.FlowResolvedFields{}, fmt.Errorf("flow state machine: resolve fields on step %q: %w", step.Name, err)
	}
	if err := r.applyPasswordPolicy(ctx, state, step, resolved.Fields); err != nil {
		return domain.FlowResolvedFields{}, err
	}
	return resolved, nil
}

// applyPasswordPolicy sets the length rules of a step's password fields for
// the purpose the flow runs under, so the rendered step and the submit check
// carry the same ones. Where the user chooses a password (register,
// recovery), the field carries the project's policy bounds: the form can show
// them, and a candidate the gate would refuse is refused on this step. Where
// the user enters one they have, the field carries none: a stored password
// may predate a stricter policy, and verifying it is the only check. The
// bounds are public on purpose: a user cannot choose a valid password without
// them (ADR 066, What a step discloses).
func (r *FlowStateMachineRuntime) applyPasswordPolicy(ctx context.Context, state *domain.FlowState, step *domain.FlowDefinitionStep, fields []domain.FlowField) error {
	if !domain.ChoosesPassword(state.CurrentPurpose) {
		return nil
	}
	read := false
	var minLength, maxLength int
	for i := range fields {
		f := &fields[i]
		if f.Challenge != domain.FlowFieldChallengePassword {
			continue
		}
		if !read {
			if r.passwords == nil {
				return fmt.Errorf("%w: password policy not wired", domain.ErrFlowIntegrity())
			}
			var err error
			minLength, maxLength, err = r.passwords.PasswordLengthBounds(ctx, state.ProjectID)
			if err != nil {
				return fmt.Errorf("flow state machine: read the password policy on step %q: %w", step.Name, err)
			}
			read = true
		}
		f.Validation = withPasswordBounds(f.Validation, minLength, maxLength)
	}
	return nil
}

// withPasswordBounds sets the policy's length bounds on a password field's
// validation, keeping every other rule it carries.
func withPasswordBounds(v *domain.FlowFieldValidation, minLength, maxLength int) *domain.FlowFieldValidation {
	out := domain.FlowFieldValidation{}
	if v != nil {
		out = *v
	}
	out.MinLength, out.MaxLength = minLength, maxLength
	return &out
}

// resolveVisitedFields resolves the union of fields collected by every
// step the user has passed through (history plus current). on_success
// handlers read this to find attributes by challenge across the full
// progress, not just the current step.
func (r *FlowStateMachineRuntime) resolveVisitedFields(pc *processCtx) (domain.FlowResolvedFields, error) {
	ctx, def, state, current := pc.ctx, pc.def, pc.state, pc.currentStep
	// First-encounter order, not map order: consumers walk these fields
	// positionally (uniqueFieldValues promises field order), so the union
	// must be deterministic — visited steps in history order, fields in
	// their step order.
	seen := map[domain.Field]struct{}{}
	names := make([]domain.Field, 0, 8)
	collect := func(s *domain.FlowDefinitionStep) {
		if s == nil {
			return
		}
		for _, f := range s.Fields {
			if _, ok := seen[f]; ok {
				continue
			}
			seen[f] = struct{}{}
			names = append(names, f)
		}
	}
	for _, name := range state.History {
		if s, ok := def.FindStep(name); ok {
			collect(s)
		}
	}
	collect(current)
	if len(names) == 0 {
		return domain.FlowResolvedFields{}, nil
	}
	schema, err := r.schemas.Resolve(ctx, r.schemaStore, state.ProjectID, state.UserSchemaURL, nil)
	if err != nil {
		return domain.FlowResolvedFields{}, fmt.Errorf("flow state machine: load user schema for visited fields: %w", err)
	}
	resolved, err := r.fields.Resolve(schema, current.Name, names)
	if err != nil {
		return domain.FlowResolvedFields{}, fmt.Errorf("flow state machine: resolve visited fields: %w", err)
	}
	return resolved, nil
}

// collectsStepFields reports whether a submission commits the step's
// fields to user creation: the submit action, or the passkey-register
// issue leg (no proof yet). These enforce required-field presence; passkey
// login legs and challenge-verify legs send a subset or none.
func collectsStepFields(kind domain.FlowActionKind, in FlowSubmitInput) bool {
	if kind == domain.FlowActionKindSubmit {
		return true
	}
	return kind == domain.FlowActionKindPasskeyRegister && in.ChallengeResponse == nil
}

// prefillFromCollected sets FlowField.Value from collectedData for any field
// that doesn't already carry a pre-fill value. This carries identifiers
// (e.g. email entered in a prior step) into subsequent steps that collect the
// same field, so the user doesn't have to retype them.
func prefillFromCollected(resolved *domain.FlowResolvedFields, collected map[string]any) {
	for i := range resolved.Fields {
		if resolved.Fields[i].Value != nil {
			continue
		}
		if v, ok := collectedString(collected, resolved.Fields[i].Name); ok {
			val := v
			resolved.Fields[i].Value = &val
		}
	}
}

// collectedString returns the value collected for a dotted property path when
// one is there and non-empty. A collected-but-empty value is the same as
// nothing to the callers that re-render it: there is no prefill to make and no
// identifier to pair.
//
// [FindCollectedFieldByChallenge] deliberately does not go through here — it
// reads a value of any type and asks only whether it is present.
func collectedString(collected map[string]any, name string) (string, bool) {
	v, ok := maputil.GetNested[string](collected, domain.AttributeKey(name).Nodes())
	if !ok || v == "" {
		return "", false
	}
	return v, true
}

func mergeCollected(state *domain.FlowState, fields map[string]any) error {
	if state.CollectedData.UserData == nil {
		state.CollectedData.UserData = map[string]any{}
	}
	if len(fields) == 0 {
		return nil
	}
	for k, v := range fields {
		if strings.HasPrefix(k, domain.AuthMethodPrefix) {
			switch k {
			case domain.AuthMethodPrefix + "password":
				pwd, ok := v.(string)
				if !ok {
					return errors.New("password is not a string")
				}
				state.CollectedData.AuthMethods.Password = pwd
				continue
			}
			return fmt.Errorf("unknown auth method %s", k)
		}

		// A field name is an attribute key, so the collected document keeps
		// the shape the user schema validates and the attribute store
		// flattens back out.
		if err := maputil.SetNested(state.CollectedData.UserData, domain.AttributeKey(k).Nodes(), v); err != nil {
			return fmt.Errorf("merge collected field %q: %w", k, err)
		}
	}
	return nil
}

// FindCollectedFieldByChallenge looks up a field whose resolved Challenge
// matches target and whose name is present in collected. Returns the field
// name, the matched [domain.FlowField], and its collected value. Callers that don't
// need the FlowField discard it.
func FindCollectedFieldByChallenge(resolved []domain.FlowField, collected map[string]any, target domain.FlowFieldChallenge) (name string, field domain.FlowField, value any, ok bool) {
	for _, f := range resolved {
		if f.Challenge != target {
			continue
		}
		if v, present := maputil.GetNested[any](collected, domain.AttributeKey(f.Name).Nodes()); present {
			return f.Name, f, v, true
		}
	}
	return "", domain.FlowField{}, nil, false
}
