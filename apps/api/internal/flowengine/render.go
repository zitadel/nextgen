package flowengine

import (
	"context"
	"fmt"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
)

// Render re-emits the current step without advancing. It refreshes IssuedAt
// only when it resolves a parked SSO identity, the one render the handler
// re-seals.
func (r *FlowStateMachineRuntime) Render(ctx context.Context, def *domain.FlowDefinition, state *FlowState) (FlowStepResult, error) {
	if def == nil || state == nil {
		return FlowStepResult{}, fmt.Errorf("%w: render without definition or state", domain.ErrFlowIntegrity())
	}
	if result, reseal, err := r.resolveSSOIdentity(ctx, def, state); err != nil || result.Step != nil {
		result.Reseal = reseal
		return result, err
	}
	step, err := r.renderStep(ctx, def, state)
	if err != nil {
		return FlowStepResult{}, err
	}
	// Re-emit an in-flight ceremony so a page reload can resume it.
	attachPendingChallenge(step, state.PendingChallenge)
	return FlowStepResult{State: state, Step: step}, nil
}

// renderStepError re-renders the current step with an error key set,
// so the user stays put and sees what went wrong.
func (r *FlowStateMachineRuntime) renderStepError(pc *processCtx, resolved domain.FlowResolvedFields, failure *domain.FlowStepFailure) (FlowStepResult, error) {
	step, err := r.buildStep(pc.ctx, pc.state, pc.currentStep, resolved, failure, nil, nil)
	if err != nil {
		return FlowStepResult{}, err
	}
	pc.state.IssuedAt = r.now()
	return FlowStepResult{State: pc.state, Step: step}, nil
}

// renderStep renders the step currently pinned by state.CurrentStep.
// Callers advance state before invoking so state.CurrentStep already points
// at the step they want rendered. Back does not come through here: it
// resolves its target once and builds from that set.
func (r *FlowStateMachineRuntime) renderStep(ctx context.Context, def *domain.FlowDefinition, state *FlowState) (*FlowStep, error) {
	step, ok := def.FindStep(state.CurrentStep)
	if !ok {
		return nil, fmt.Errorf("%w: render unknown step %q", domain.ErrFlowIntegrity(), state.CurrentStep)
	}
	resolved, err := r.resolveStepFields(ctx, state, step)
	if err != nil {
		return nil, err
	}
	if err := r.prefillStep(ctx, state, step, &resolved); err != nil {
		return nil, err
	}
	// A terminal step renders as complete, so a re-render of a finished flow
	// says so (GET /flows/{flow_id} answers 410 on it).
	return r.buildStep(ctx, state, step, resolved, nil, step.Complete, nil)
}

// buildStep assembles a FlowStep from the raw pieces. The step it renders is
// always the caller's to name: Start and renderStep supply state + step
// directly, mid-pipeline callers pass pc.state + pc.currentStep, and
// the back handler passes pc.state with the back-stack step it just popped to.
func (r *FlowStateMachineRuntime) buildStep(ctx context.Context, state *FlowState, step *domain.FlowDefinitionStep, resolved domain.FlowResolvedFields, failure *domain.FlowStepFailure, complete *domain.FlowStepComplete, redirectURL *string) (*FlowStep, error) {
	providers, err := r.resolveSSOProviders(ctx, state, step)
	if err != nil {
		return nil, err
	}
	conflict := state.CollectedData.SSOConflictConnectionID
	if conflict != "" {
		// Choosing the provider whose sign-in collided would collide again.
		providers = slices.DeleteFunc(providers, func(p domain.FlowSSOProvider) bool {
			return p.ConnectionID == conflict
		})
	}
	offerPasskey, err := r.offersPasskey(ctx, state, step)
	if err != nil {
		return nil, err
	}
	// Surface only user-selectable actions declared on the step.
	// Implicit outcomes (e.g. user_not_found) live in step.Transitions
	// but are engine-emitted routing keys, not buttons for the client.
	actions := make([]FlowAction, 0, len(step.Actions)+1)
	for _, a := range step.Actions {
		if a.Kind == domain.FlowActionKindPasskey && !offerPasskey {
			continue
		}
		textKey := a.TextKey
		if textKey == "" {
			textKey = step.Name + ".action." + a.Name
		}
		actions = append(actions, FlowAction{
			Name:    a.Name,
			Kind:    a.Kind,
			TextKey: textKey,
			Primary: a.Primary,
		})
	}
	// Inject `back` when there's somewhere to return to. TextKey
	// follows the `<step>.action.<name>` convention.
	if len(state.BackStack) > 0 && step.Complete == nil {
		actions = append(actions, FlowAction{
			Name:    domain.FlowBackActionName,
			Kind:    domain.FlowActionKindBack,
			TextKey: step.Name + ".action." + domain.FlowBackActionName,
		})
	}
	applyAutocomplete(resolved.Fields, state.CurrentPurpose)
	// A step that offers providers reaches users who have no password, and the
	// text cannot depend on the user without revealing how the account signs in.
	// It gets its own key; a client without that key falls back to the plain one.
	descriptionKey := step.Name + ".description"
	if len(providers) > 0 {
		descriptionKey += ".sso"
	}
	var errorKey *string
	if failure != nil {
		errorKey = &failure.Key
	}
	return &FlowStep{
		Name:         step.Name,
		Texts:        FlowStepTexts{TitleKey: step.Name + ".title", DescriptionKey: descriptionKey},
		Purpose:      state.CurrentPurpose,
		Error:        errorKey,
		Failure:      failure,
		Complete:     complete,
		RedirectURL:  redirectURL,
		Fields:       resolved.Fields,
		Actions:      actions,
		SSOProviders: providers,
		Identifier:   pairedIdentifier(resolved, state.CollectedData.UserData),
	}, nil
}

// applyAutocomplete stamps each field's autofill token. The purpose is not
// known at resolve time — the definition validator resolves without one, and
// applyOutcomeFlip can change it mid-flow — so the token belongs to a render
// rather than to the resolved field set.
func applyAutocomplete(fields []domain.FlowField, purpose domain.FlowDefinitionPurpose) {
	for i := range fields {
		fields[i].Autocomplete = domain.AutocompleteForField(fields[i], purpose)
	}
}

// pairedIdentifier returns the identifier a password form carries beside
// the password input so a manager can store the two as one credential.
// Nil unless the step collects a password, collects no identifier of its
// own, and the schema designates one a value was collected for.
func pairedIdentifier(resolved domain.FlowResolvedFields, collected map[string]any) *FlowStepIdentifier {
	if resolved.IdentifierName == "" {
		return nil
	}
	var holdsPassword bool
	for _, f := range resolved.Fields {
		switch f.Challenge {
		case domain.FlowFieldChallengeIdentifier:
			return nil
		case domain.FlowFieldChallengePassword:
			holdsPassword = true
		}
	}
	if !holdsPassword {
		return nil
	}
	value, ok := collectedString(collected, resolved.IdentifierName)
	if !ok {
		return nil
	}
	return &FlowStepIdentifier{
		Value:        value,
		Autocomplete: domain.AutocompleteUsername,
	}
}
