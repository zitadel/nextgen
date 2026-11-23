package flowengine

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"strings"

	"github.com/ianlancetaylor/jsonschema"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/maputil"
)

// errSSOClaimRejected reports a verified unique claim that fails its own
// property. The user may not change a verified value, and the account cannot
// hold this one, so nothing is created and no step is shown to collect it.
var errSSOClaimRejected = errors.New("flow state machine: the user schema rejects a verified unique claim")

// resolveSSOIdentity turns an external identity an SSO callback parked on the
// attempt into an outcome on the current step. A branch that produces the
// result always returns a step, and Render relies on that: a result without
// one goes on to render the step as usual. The bool reports that the state
// changed and the handler must re-seal it.
//
// It runs on every render, so every GET /flows/{flow_id} pays one attempt read even
// without SSO. The read is not only for SSO: LoadParked also restarts any flow
// whose attempt expired or was handed off. Do not limit it to steps that offer
// sso_providers.
//
// The outcome is raised with an empty action, so an unwired transition
// degrades to the step-error re-render, as a handler diversion does.
func (r *FlowStateMachineRuntime) resolveSSOIdentity(ctx context.Context, def *domain.FlowDefinition, state *domain.FlowState) (FlowStepResult, bool, error) {
	currentStep, ok := def.FindStep(state.CurrentStep)
	if !ok {
		return FlowStepResult{}, false, fmt.Errorf("%w: current step %q missing from definition", domain.ErrFlowIntegrity(), state.CurrentStep)
	}
	// A completed flow handed its attempt off; there is nothing to resolve.
	if currentStep.Complete != nil {
		return FlowStepResult{}, false, nil
	}
	loadInput := domain.FlowSSOLoadInput{
		ProjectID:       state.ProjectID,
		AttemptID:       state.AuthAttemptID,
		UserSchemaURL:   state.UserSchemaURL,
		ResolvedCheckID: state.SSOResolvedCheckID,
	}
	parked, err := r.ssoIdentities.LoadParked(ctx, loadInput)
	if err != nil {
		return FlowStepResult{}, false, fmt.Errorf("flow state machine: load parked sso identity: %w", err)
	}
	// An earlier request bound the attempt but its handoff failed, and the
	// parked row is gone: raise the success outcome again, which mints the
	// handoff. A state that already carries a user has nothing to retry.
	if parked != nil && parked.BoundUserID != "" {
		if state.CollectedData.UserID != "" {
			return FlowStepResult{}, false, nil
		}
		pc := &processCtx{ctx: ctx, def: def, state: state, currentStep: currentStep}
		resolvedFields, err := r.resolveInputs(pc)
		if err != nil {
			return FlowStepResult{}, false, err
		}
		// Checked here as well, so the error render leaves the cookie alone:
		// the state does not change, and a reload shows the error again.
		if _, _, ok := ssoRetryRoute(currentStep); !ok {
			result, err := r.renderStepError(pc, resolvedFields, domain.FlowStepFailed(FlowStepErrorSSOUnavailable, nil))
			return result, false, err
		}
		return r.retrySSOHandoff(pc, resolvedFields, parked.BoundUserID, false)
	}
	// A collision bound a user, but the cookie that recorded it lost the race
	// to one that recorded this row as collected: catch the state up.
	if parked != nil && parked.CollisionUserID != "" {
		// The marker counts only while the attempt still carries that user: a
		// stale submission may have overwritten the user factor since.
		if parked.AttemptUserID != parked.CollisionUserID {
			return FlowStepResult{}, false, domain.ErrFlowRestartRequired()
		}
		switch state.CollectedData.UserID {
		case parked.CollisionUserID:
			// The user alone is no proof that this cookie recorded the
			// collision: the flow may have identified that user before SSO.
			if state.SSOResolvedCheckID == parked.CheckID {
				return FlowStepResult{}, false, nil
			}
		case "":
		default:
			return FlowStepResult{}, false, domain.ErrFlowRestartRequired()
		}
		pc := &processCtx{ctx: ctx, def: def, state: state, currentStep: currentStep}
		resolvedFields, err := r.resolveInputs(pc)
		if err != nil {
			return FlowStepResult{}, false, err
		}
		// The bind may have run on another step, or under an older definition.
		if !userAlreadyExistsRoutes(currentStep) {
			result, err := r.renderStepError(pc, resolvedFields, domain.FlowStepFailed(FlowStepErrorSSOUnavailable, nil))
			return result, false, err
		}
		state.SSOResolvedCheckID = parked.CheckID
		recordResolvedUser(state, parked.CollisionUserID)
		// The marker replaced the row a collection step creates from, so that
		// step cannot be shown again. An entry step can: it starts a new ceremony.
		collection := currentStep.OnSuccess != nil && *currentStep.OnSuccess == domain.FlowOnSuccessCreateUserWithSso
		result, err := r.routeOutcome(pc, resolvedFields, domain.FlowImplicitOutcomeUserAlreadyExists, collection)
		return result, true, err
	}
	if parked == nil {
		return FlowStepResult{}, false, nil
	}

	pc := &processCtx{ctx: ctx, def: def, state: state, currentStep: currentStep}
	resolvedFields, err := r.resolveInputs(pc)
	if err != nil {
		return FlowStepResult{}, false, err
	}
	// Recorded before the branch work, so a failed branch is not retried on
	// every reload, and a row left parked for collection is not resolved twice.
	state.SSOResolvedCheckID = parked.CheckID

	// The ceremony failed at the provider or in the callback; the key is the
	// step error. The row stays parked, as under creation disabled.
	if parked.ErrorKey != "" {
		result, err := r.renderStepError(pc, resolvedFields, domain.FlowStepFailed(parked.ErrorKey, nil))
		return result, true, err
	}
	if parked.Link == nil && parked.CreationDisabled {
		// The identity has no account and will not get one. The row stays
		// parked, so a failed render or seal re-runs this branch and shows the
		// error again; the replay guard in the sealed cookie keeps later
		// reloads from repeating it. The row expires with the attempt or is
		// replaced by the next ceremony.
		result, err := r.renderStepError(pc, resolvedFields, domain.FlowStepFailed(FlowStepErrorSSOCreationDisabled, nil))
		return result, true, err
	}
	if parked.Link == nil {
		outcome, err := r.provisionSSOIdentity(ctx, state, currentStep, parked)
		if errors.Is(err, domain.ErrSSOStateInvalid()) {
			return r.resolveStaleSSOBind(pc, resolvedFields, loadInput)
		}
		if errors.Is(err, errSSOUnroutable) {
			result, err := r.renderStepError(pc, resolvedFields, domain.FlowStepFailed(FlowStepErrorSSOUnavailable, err))
			return result, true, err
		}
		if errors.Is(err, domain.ErrSSOOwnerOtherSchema) {
			return FlowStepResult{}, false, domain.ErrFlowRestartRequired().WithParent(err)
		}
		if errors.Is(err, errSSOClaimRejected) {
			// The row stays parked, as under creation disabled.
			result, err := r.renderStepError(pc, resolvedFields, domain.FlowStepFailed(FlowStepErrorSSOUserCannotBeCreated, err))
			return result, true, err
		}
		if err != nil {
			return FlowStepResult{}, false, err
		}
		// Creation bound the attempt, so a concurrent render can win the
		// handoff first, as after the linked bind. As after create_user, the
		// step that created the user offers no back.
		if outcome == domain.FlowImplicitOutcomeSSOAuthenticated {
			return r.retrySSOHandoff(pc, resolvedFields, state.CollectedData.UserID, true)
		}
		result, err := r.routeOutcome(pc, resolvedFields, outcome, false)
		return result, true, err
	}

	// The bind cannot be undone, so it runs only when the outcome can route:
	// a stored definition is validated only on write. Otherwise the step
	// shows the provider as unavailable, and the row stays parked.
	if !ssoAuthenticatedRoutes(currentStep) {
		result, err := r.renderStepError(pc, resolvedFields, domain.FlowStepFailed(FlowStepErrorSSOUnavailable, nil))
		return result, true, err
	}
	err = r.ssoIdentities.BindLinked(ctx, domain.FlowSSOBindInput{
		ProjectID:    state.ProjectID,
		AttemptID:    state.AuthAttemptID,
		CheckID:      parked.CheckID,
		UserID:       parked.Link.UserID,
		ConnectionID: parked.ConnectionID,
		LinkID:       parked.Link.LinkID,
	})
	if errors.Is(err, domain.ErrSSOStateInvalid()) {
		return r.resolveStaleSSOBind(pc, resolvedFields, loadInput)
	}
	if err != nil {
		return FlowStepResult{}, false, fmt.Errorf("flow state machine: bind sso identity: %w", err)
	}
	return r.retrySSOHandoff(pc, resolvedFields, parked.Link.UserID, false)
}

// provisionSSOIdentity settles an unlinked identity under `creation: auto`
// and returns the outcome to raise. A user owning one of the unique claims is
// bound (user_already_exists, as for a typed registration collision);
// otherwise complete, trusted claims create a linked user
// (sso_authenticated); anything else is collected (sso_user_not_found), with
// the row left parked for the prefill.
func (r *FlowStateMachineRuntime) provisionSSOIdentity(ctx context.Context, state *domain.FlowState, step *domain.FlowDefinitionStep, parked *domain.FlowSSOParkedIdentity) (string, error) {
	schema, err := r.schemas.Resolve(ctx, r.schemaStore, state.ProjectID, state.UserSchemaURL, nil)
	if err != nil {
		return "", fmt.Errorf("flow state machine: load user schema for sso identity: %w", err)
	}
	// A connection can map a superset of properties for several schemas; this
	// schema consumes only the top-level properties it defines.
	claims := ssoSchemaClaims(schema, parked.Claims)
	probeClaims, uniqueClaims := ssoUniqueClaims(schema, claims)
	identifier := domain.NewSchemaReader(schema).String(domain.SchemaAnnotationIdentifier)
	if bound, err := r.bindSSOCollision(ctx, state, step, parked, probeClaims, claims, identifier); err != nil || bound {
		return domain.FlowImplicitOutcomeUserAlreadyExists, err
	}
	// Neither linked to nor colliding with the user the flow or its attempt
	// carries (a signed-in session included): no new user can register on
	// that attempt, and it is not collected either. The bind helper stays the
	// backstop.
	if ssoBoundUser(state, parked) != "" {
		return "", domain.ErrFlowRestartRequired()
	}
	if ssoVerifiedClaimRejected(schema, parked.Verified, claims) {
		return "", errSSOClaimRejected
	}
	if !ssoClaimsComplete(schema, parked, claims, uniqueClaims) {
		return domain.FlowImplicitOutcomeSSOUserNotFound, nil
	}
	// The user and the link cannot be undone, so creation waits until
	// sso_authenticated can route, as the linked bind does.
	if !ssoAuthenticatedRoutes(step) {
		return "", errSSOUnroutable
	}

	attributes := map[string]any{}
	for name, value := range claims {
		if err := maputil.SetNested(attributes, domain.AttributeKey(name).Nodes(), value); err != nil {
			return "", fmt.Errorf("flow state machine: sso claim %q: %w", name, err)
		}
	}
	userID, err := r.ssoIdentities.CreateLinked(ctx, domain.FlowSSOCreateInput{
		ProjectID:     state.ProjectID,
		AttemptID:     state.AuthAttemptID,
		CheckID:       parked.CheckID,
		UserSchemaURL: state.UserSchemaURL,
		ConnectionID:  parked.ConnectionID,
		Subject:       parked.Subject,
		Attributes:    attributes,
	})
	if errors.Is(err, domain.ErrUserAlreadyExists()) {
		// Another flow took a unique value since the probe (a request on this
		// attempt loses on the parked row instead): whoever took a probed
		// attribute is bound, and anything else falls back to collection.
		if bound, err := r.bindSSOCollision(ctx, state, step, parked, probeClaims, claims, identifier); err != nil || bound {
			return domain.FlowImplicitOutcomeUserAlreadyExists, err
		}
		return domain.FlowImplicitOutcomeSSOUserNotFound, nil
	}
	if domain.IsUserInvalid(err) {
		// A claim the user may edit fails the schema (too long, bad format):
		// collect it so the user can fix it.
		return domain.FlowImplicitOutcomeSSOUserNotFound, nil
	}
	if err != nil {
		return "", fmt.Errorf("flow state machine: create sso user: %w", err)
	}
	recordResolvedUser(state, userID)
	return domain.FlowImplicitOutcomeSSOAuthenticated, nil
}

// ssoBoundUser is the user the flow already carries: the one its state
// recorded, or else the one its attempt carries, which a flow started on a
// signed-in session gets from that session without the state recording it.
func ssoBoundUser(state *domain.FlowState, parked *domain.FlowSSOParkedIdentity) string {
	if state.CollectedData.UserID != "" {
		return state.CollectedData.UserID
	}
	return parked.AttemptUserID
}

// ssoHiddenClaim returns the part of a claim at path that the step does not
// show and that satisfies its own property, whatever its type. The user cannot
// see a hidden value to fix it, so an invalid one is left out. A shown field
// keeps the typed value. An object is checked key by key, and keys the schema
// does not define are left out. An object with no shown field below it must
// also satisfy its own property, so an optional object the provider sent
// incomplete is left out instead of blocking the creation.
func ssoHiddenClaim(prop domain.SchemaReader, path domain.AttributeKey, value any, fields []domain.FlowField) (any, bool) {
	var shown, below bool
	for _, f := range fields {
		shown = shown || f.Name == string(path)
		below = below || strings.HasPrefix(f.Name, string(path)+".")
	}
	if shown {
		return nil, false
	}
	object, ok := value.(map[string]any)
	if !ok || !prop.HasProperties() {
		// A shown field below a value that is no object: the claim does not
		// have the shape the step collects.
		if below || prop.Schema.ValidateWithOpts(value, domain.AttributeValidation) != nil {
			return nil, false
		}
		return value, true
	}
	kept := map[string]any{}
	for key, v := range object {
		sub, ok := prop.Property(key)
		if !ok {
			continue
		}
		if v, ok := ssoHiddenClaim(sub, path.AppendNode(key), v, fields); ok {
			kept[key] = v
		}
	}
	if len(kept) == 0 || (!below && prop.Schema.ValidateWithOpts(kept, domain.AttributeValidation) != nil) {
		return nil, false
	}
	return kept, true
}

// mergeSSOClaim merges the kept part of a claim over the value collected for
// it, so the typed leaves of an object stay beside the hidden ones. It copies
// every map it changes: the collected value is the flow state's.
func mergeSSOClaim(collected, kept any) any {
	keptObject, ok := kept.(map[string]any)
	collectedObject, isObject := collected.(map[string]any)
	if !ok || !isObject {
		return kept
	}
	out := maps.Clone(collectedObject)
	for key, value := range keptObject {
		out[key] = mergeSSOClaim(collectedObject[key], value)
	}
	return out
}

// ssoVerifiedClaimRejected reports whether a unique leaf of a verified claim
// fails its own property. A leaf is unique by its own x-unique, as the
// unique claims read it ([domain.CreateAttributes]). Keys the schema does not define are
// skipped: the collection step leaves them out.
func ssoVerifiedClaimRejected(schema *jsonschema.Schema, verified map[string]bool, claims map[string]any) bool {
	var rejected func(prop domain.SchemaReader, value any) bool
	rejected = func(prop domain.SchemaReader, value any) bool {
		object, ok := value.(map[string]any)
		if !ok {
			return domain.DeriveUnique(prop) != domain.AttributeUniquenessUnspecified && prop.Schema.ValidateWithOpts(value, domain.AttributeValidation) != nil
		}
		for key, v := range object {
			if sub, ok := prop.Property(key); ok && rejected(sub, v) {
				return true
			}
		}
		return false
	}
	root := domain.NewSchemaReader(schema)
	for name, value := range claims {
		if prop, ok := root.Property(name); ok && verified[name] && rejected(prop, value) {
			return true
		}
	}
	return false
}

// ssoSchemaClaims keeps the claims whose name is a top-level property of the
// schema and drops the rest.
func ssoSchemaClaims(schema *jsonschema.Schema, claims map[string]any) map[string]any {
	root := domain.NewSchemaReader(schema)
	out := make(map[string]any, len(claims))
	for name, value := range claims {
		if _, ok := root.Property(name); ok {
			out[name] = value
		}
	}
	return out
}

// ssoUniqueClaims returns the claim names whose top-level schema property
// carries an x-unique scope (unique), and the dotted path of each unique leaf
// the collision check probes (probe), both sorted so the probe order is
// stable. The annotation is read directly, so a claim whose property no flow
// step could render (a type union) is no error; a claim the schema does not
// know is skipped.
func ssoUniqueClaims(schema *jsonschema.Schema, claims map[string]any) (probe, unique []string) {
	root := domain.NewSchemaReader(schema)
	for name := range claims {
		if prop, ok := root.Property(name); ok && domain.DeriveUnique(prop) != domain.AttributeUniquenessUnspecified {
			unique = append(unique, name)
		}
	}
	probe = ssoUniqueLeaves(root, "", claims)
	slices.Sort(probe)
	slices.Sort(unique)
	return probe, unique
}

// ssoUniqueLeaves returns the path of each value the creation would record as
// a unique claim, walked as [domain.CreateAttributes] flattens a user: an object
// descends, and any other value is a leaf, an array included. The new user
// has no team, so each of its unique claims has team scope "", whatever the
// leaf's x-unique scope, and collides with any row of the same scope.
func ssoUniqueLeaves(parent domain.SchemaReader, prefix domain.AttributeKey, values map[string]any) []string {
	var out []string
	for name, value := range values {
		prop, ok := parent.Property(name)
		if !ok {
			continue
		}
		path := prefix.AppendNode(name)
		if nested, ok := value.(map[string]any); ok {
			out = append(out, ssoUniqueLeaves(prop, path, nested)...)
			continue
		}
		if domain.DeriveUnique(prop) != domain.AttributeUniquenessUnspecified {
			out = append(out, string(path))
		}
	}
	return out
}

// errSSOUnroutable reports a collision or a creation on a step that cannot
// route its outcome. Nothing is written: the engine shows the provider as
// unavailable, as for a linked identity.
var errSSOUnroutable = errors.New("flow state machine: sso outcome cannot route on this step")

// bindSSOCollision looks up the value at each unique leaf path in values,
// verified or not, until one names an existing user, then binds that user by
// id. Like a typed identifier it only binds the user: no link, no sso factor.
// The bind checks the exact parked row first and replaces it by a marker of
// that user, so a row another request replaced binds nothing
// (ErrSSOStateInvalid) and a retry after a lost cookie catches up from the
// marker. It returns errSSOUnroutable, before binding, when step cannot route
// user_already_exists. identifier is the property the schema designates as
// the identifier, for [recordSSOConflict].
func (r *FlowStateMachineRuntime) bindSSOCollision(ctx context.Context, state *domain.FlowState, step *domain.FlowDefinitionStep, parked *domain.FlowSSOParkedIdentity, probeClaims []string, values map[string]any, identifier string) (bool, error) {
	for _, name := range probeClaims {
		value, ok := maputil.GetNested[any](values, domain.AttributeKey(name).Nodes())
		if !ok || value == nil || value == "" {
			continue
		}
		// A read-only lookup: an identifier submission that misses records a
		// failed check on the attempt, and a miss here is no sign-in attempt.
		owner, err := r.ssoIdentities.FindUniqueOwner(ctx, state.ProjectID, state.UserSchemaURL, name, value)
		if err != nil {
			return false, fmt.Errorf("flow state machine: look up sso claim %q: %w", name, err)
		}
		if owner == "" {
			continue
		}
		// The bind refuses another bound user too; this makes the invariant
		// explicit in the engine.
		if bound := ssoBoundUser(state, parked); bound != "" && bound != owner {
			return false, domain.ErrFlowRestartRequired()
		}
		// The bind cannot be undone, and the validator does not require
		// user_already_exists on a step with sso_providers, so the bind waits
		// until the outcome can route. A declared purpose can: it starts that
		// purpose fresh, as it does for a typed collision.
		if !userAlreadyExistsRoutes(step) {
			return false, errSSOUnroutable
		}
		if err := r.ssoIdentities.BindCollision(ctx, domain.FlowSSOBindInput{
			ProjectID: state.ProjectID,
			AttemptID: state.AuthAttemptID,
			CheckID:   parked.CheckID,
			UserID:    owner,
		}); err != nil {
			return false, fmt.Errorf("flow state machine: bind sso collision: %w", err)
		}
		recordResolvedUser(state, owner)
		recordSSOConflict(state, parked, values, identifier)
		return true, nil
	}
	return false, nil
}

// recordSSOConflict notes what the steps after a collision show the bound
// user: the connection whose sign-in collided, which they leave out, and the
// account's identifier, which [pairedIdentifier] hands the step.
//
// The step names the account only by a value the visitor brought: one the
// provider verified, so the visitor proved they hold it, or one they typed on
// this flow. Either way the step adds nothing to what the conflict itself
// confirms, that an account with this value exists
// (docs/design/idp/3-social-login-flow.md, Enumeration Note). An identifier
// claim the provider did not verify names nothing unless the visitor submitted
// that same value on this flow, and a value typed earlier that is not the
// colliding one is dropped, so the step never names another account.
func recordSSOConflict(state *domain.FlowState, parked *domain.FlowSSOParkedIdentity, values map[string]any, identifier string) {
	state.CollectedData.SSOConflictConnectionID = parked.ConnectionID
	if identifier == "" {
		return
	}
	path := domain.AttributeKey(identifier).Nodes()
	value, ok := maputil.GetNested[string](values, path)
	if !ok || value == "" {
		// The provider sent no identifier: what the visitor typed, if
		// anything, stays, as after a typed collision.
		return
	}
	claim, claimed := maputil.GetNested[string](parked.Claims, path)
	switch {
	case claimed && claim == value && parked.Verified[path[0]]:
		_ = maputil.SetNested(state.CollectedData.UserData, path, value)
	case claimed && claim == value:
		// Unverified. An empty value reads as absent to every reader.
		if typed, ok := collectedString(state.CollectedData.UserData, identifier); ok && typed != value {
			_ = maputil.SetNested(state.CollectedData.UserData, path, "")
		}
	}
	// Otherwise the value is the visitor's own typing on a collection step,
	// already in UserData.
}

// ssoClaimsComplete reports whether the claims can create a user unattended:
// every required property has a claim, and every required unique one arrived
// verified, so an unverified address cannot claim an account. Claims are
// top-level, so a required nested object never completes.
func ssoClaimsComplete(schema *jsonschema.Schema, parked *domain.FlowSSOParkedIdentity, claims map[string]any, uniqueClaims []string) bool {
	// RequiredPaths reads `required` and `properties` only. Requiredness a
	// composition or a reference adds, at any depth, is not evaluated, so such
	// a schema never creates a user unattended: the verified-unique rule must
	// not be bypassable.
	if domain.NewSchemaReader(schema).ComposesRequiredness() {
		return false
	}
	for name := range claims {
		// Attribute keys use the dot as a path separator, so a top-level property
		// whose name has one would be stored as a nested object.
		if strings.Contains(name, ".") {
			return false
		}
	}
	materialized := make(map[string]struct{}, len(claims))
	for name := range claims {
		materialized[name] = struct{}{}
	}
	for path := range domain.NewSchemaReader(schema).RequiredPaths(materialized) {
		if claims[path] == nil {
			return false
		}
		if slices.Contains(uniqueClaims, path) && !parked.Verified[path] {
			return false
		}
	}
	return true
}

// resolveStaleSSOBind handles a bind that found its parked row gone: a
// concurrent request settled it, or a new ceremony replaced it. One more read
// tells which.
func (r *FlowStateMachineRuntime) resolveStaleSSOBind(pc *processCtx, resolvedFields domain.FlowResolvedFields, loadInput domain.FlowSSOLoadInput) (FlowStepResult, bool, error) {
	reread, err := r.ssoIdentities.LoadParked(pc.ctx, loadInput)
	if err != nil {
		// Handed off or expired: restart, so this response cannot reseal a
		// cookie over the winner's. Any other read failure is returned as is.
		return FlowStepResult{}, false, fmt.Errorf("flow state machine: reload parked sso identity: %w", err)
	}
	if reread == nil || reread.BoundUserID == "" {
		// Replaced, or settled by a collision whose marker the next render
		// reconciles: render the step.
		return FlowStepResult{}, false, nil
	}
	return r.retrySSOHandoff(pc, resolvedFields, reread.BoundUserID, false)
}

// retrySSOHandoff routes a user bound on the attempt through [ssoRetryRoute],
// which mints the handoff. The bind is this request's or an earlier one whose
// request did not deliver the handoff; either way a concurrent render can win
// the handoff first. irreversible clears the back stack. A retry cannot tell
// a created user from a linked one, so it passes false; the route can still
// make it irreversible.
func (r *FlowStateMachineRuntime) retrySSOHandoff(pc *processCtx, resolvedFields domain.FlowResolvedFields, userID string, irreversible bool) (FlowStepResult, bool, error) {
	// An earlier bind may have run on another step, or under an older
	// definition. Checked before the user is recorded: a purpose would drop
	// that user and move the flow to a fresh attempt.
	outcome, routeIrreversible, ok := ssoRetryRoute(pc.currentStep)
	if !ok {
		result, err := r.renderStepError(pc, resolvedFields, domain.FlowStepFailed(FlowStepErrorSSOUnavailable, nil))
		return result, true, err
	}
	recordResolvedUser(pc.state, userID)
	result, err := r.routeOutcome(pc, resolvedFields, outcome, irreversible || routeIrreversible)
	if errors.Is(err, domain.ErrAuthAttemptAlreadyHandedOff()) {
		// A concurrent retry won the handoff. A handed-off attempt restarts
		// the flow on every later render too, so this one does the same.
		return FlowStepResult{}, false, domain.ErrFlowRestartRequired().WithParent(err)
	}
	return result, true, err
}

// ssoRetryRoute picks the outcome that retries the handoff on step, keeping
// the bound user: sso_authenticated, or on the step that creates the user from
// the identity, the transition of its only submit action, which the create
// follows. That route is irreversible, as after the create. ok is false when
// neither keeps the user, or the step has several submit actions and the
// retry cannot tell which one the create ran on.
func ssoRetryRoute(step *domain.FlowDefinitionStep) (outcome string, irreversible, ok bool) {
	if ssoAuthenticatedRoutes(step) {
		return domain.FlowImplicitOutcomeSSOAuthenticated, false, true
	}
	if step.OnSuccess == nil || *step.OnSuccess != domain.FlowOnSuccessCreateUserWithSso {
		return "", false, false
	}
	for _, a := range step.Actions {
		if a.Kind != domain.FlowActionKindSubmit {
			continue
		}
		if outcome != "" {
			return "", false, false
		}
		outcome = a.Name
	}
	t, routes := step.Transitions[outcome]
	if outcome == "" || !routes || t.Action != nil || t.Purpose != nil {
		return "", false, false
	}
	return outcome, true, true
}

// ssoAuthenticatedRoutes reports whether step routes sso_authenticated within
// this flow, keeping the bound user.
func ssoAuthenticatedRoutes(step *domain.FlowDefinitionStep) bool {
	t, ok := step.Transitions[domain.FlowImplicitOutcomeSSOAuthenticated]
	return ok && t.Action == nil && t.Purpose == nil
}

// userAlreadyExistsRoutes reports whether step routes user_already_exists
// within this flow. A purpose counts: it starts that purpose fresh.
func userAlreadyExistsRoutes(step *domain.FlowDefinitionStep) bool {
	t, ok := step.Transitions[domain.FlowImplicitOutcomeUserAlreadyExists]
	return ok && t.Action == nil
}

// processSSO starts an external sign-in with a provider the step offers
// and emits the redirect step. The flow state is left as it is: the user
// is still on this step until the resolution after the callback routes it.
// IssuedAt is refreshed like on every submit, so the flow cookie's
// window restarts at this submission.
func (r *FlowStateMachineRuntime) processSSO(pc *processCtx) (FlowStepResult, error) {
	in := pc.in
	if in.Action != domain.FlowActionSSO || in.SSOProvider == nil {
		return FlowStepResult{}, fmt.Errorf("%w: %q with sso provider on step %q", domain.ErrFlowInvalidAction(), in.Action, pc.currentStep.Name)
	}
	if !slices.Contains(pc.currentStep.SSOProviders, in.SSOProvider.ID) {
		return FlowStepResult{}, fmt.Errorf("%w: sso provider %q is not offered on step %q", domain.ErrFlowInvalidAction(), in.SSOProvider.ID, pc.currentStep.Name)
	}
	if in.SSOReturn == nil {
		return FlowStepResult{}, fmt.Errorf("%w: sso return params missing", domain.ErrFlowIntegrity())
	}
	// Leaving for the provider abandons any pending ceremony; without this
	// the stale challenge re-attaches on the next render (the mismatch
	// cleanup in [takeInputs] never runs on this path).
	pc.state.ClearPendingChallenge()
	out, err := r.ssoRedirects.Issue(pc.ctx, domain.FlowIssueSSORedirectInput{
		ProjectID:     pc.state.ProjectID,
		AttemptID:     pc.state.AuthAttemptID,
		ProviderSlug:  in.SSOProvider.ID,
		FlowSSOReturn: *in.SSOReturn,
	})
	switch {
	case errors.Is(err, domain.ErrIDPConnectionNotFound()):
		// The render dropped the slug, so the client never offered it.
		return FlowStepResult{}, fmt.Errorf("%w: sso provider %q on step %q has no connection", domain.ErrFlowInvalidAction(), in.SSOProvider.ID, pc.currentStep.Name)
	case errors.Is(err, domain.ErrFlowSSOUnavailable(nil)):
		resolved, resolveErr := r.resolveInputs(pc)
		if resolveErr != nil {
			return FlowStepResult{}, resolveErr
		}
		return r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorSSOUnavailable, err))
	case err != nil:
		return FlowStepResult{}, err
	}
	pc.state.IssuedAt = r.now()
	return FlowStepResult{
		State: pc.state,
		Step: &FlowStep{
			Name:        FlowStepNameSSORedirect,
			Texts:       FlowStepTexts{TitleKey: flowSSORedirectTitleKey},
			Purpose:     pc.state.CurrentPurpose,
			RedirectURL: &out.RedirectURL,
		},
		SSOBindingNonce: out.BindingNonce,
	}, nil
}

// processSSOCollection creates the user from the identity the engine resolved
// into this step, with the values the step collected. A unique value another
// user holds binds that user instead, as on the render.
func (r *FlowStateMachineRuntime) processSSOCollection(pc *processCtx, resolved domain.FlowResolvedFields) (FlowStepResult, error) {
	step, state := pc.currentStep, pc.state
	// The user and the link cannot be undone, so the submitted action must
	// route before anything is written, and keep the user it creates.
	if stepActionKind(step, pc.in.Action) != domain.FlowActionKindSubmit {
		return FlowStepResult{}, fmt.Errorf("%w: %q on step %q", domain.ErrFlowInvalidAction(), pc.in.Action, step.Name)
	}
	transition, ok := step.Transitions[pc.in.Action]
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: %q on step %q", domain.ErrFlowInvalidAction(), pc.in.Action, step.Name)
	}
	if transition.Action != nil || transition.Purpose != nil {
		return r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorSSOUnavailable, nil))
	}
	if state.SSOResolvedCheckID == "" {
		return FlowStepResult{}, fmt.Errorf("%w: step %q creates a user from sso, but the flow resolved no sso identity", domain.ErrFlowIntegrity(), step.Name)
	}
	// The service refuses a bind or a creation on an attempt carrying another
	// user too; this makes the invariant explicit in the engine.
	if state.CollectedData.UserID != "" {
		return FlowStepResult{}, domain.ErrFlowRestartRequired()
	}
	loadInput := domain.FlowSSOLoadInput{
		ProjectID:       state.ProjectID,
		AttemptID:       state.AuthAttemptID,
		UserSchemaURL:   state.UserSchemaURL,
		ResolvedCheckID: state.SSOResolvedCheckID,
	}
	collected, err := r.ssoIdentities.LoadCollected(pc.ctx, loadInput)
	if err != nil {
		return FlowStepResult{}, fmt.Errorf("flow state machine: load collected sso identity: %w", err)
	}
	if collected == nil {
		return r.resolveStaleSSOSubmit(pc, resolved, loadInput)
	}
	schema, err := r.schemas.Resolve(pc.ctx, r.schemaStore, state.ProjectID, state.UserSchemaURL, nil)
	if err != nil {
		return FlowStepResult{}, fmt.Errorf("flow state machine: load user schema for sso identity: %w", err)
	}
	claims := ssoSchemaClaims(schema, collected.Claims)
	// What the steps collected, this submit's values merged in, and the claims
	// the step does not show. A claim replaces what an earlier step collected,
	// so a typed identifier cannot override the provider.
	attributes := maps.Clone(state.CollectedData.UserData)
	if attributes == nil {
		attributes = map[string]any{}
	}
	root := domain.NewSchemaReader(schema)
	for name, value := range claims {
		prop, _ := root.Property(name)
		if kept, ok := ssoHiddenClaim(prop, domain.AttributeKey(name), value, resolved.Fields); ok {
			attributes[name] = mergeSSOClaim(attributes[name], kept)
		}
	}

	// The callback refuses such a claim before the step; the schema may have
	// changed since.
	if ssoVerifiedClaimRejected(schema, collected.Verified, claims) {
		return r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorSSOUserCannotBeCreated, nil))
	}
	// A shown unique leaf of a verified claim must keep the claimed value. The
	// step prefills only strings, so any value typed for a number claim is
	// refused.
	for _, f := range resolved.Fields {
		path := domain.AttributeKey(f.Name).Nodes()
		claim, ok := maputil.GetNested[any](claims, path)
		if !ok || !collected.Verified[path[0]] {
			continue
		}
		prop, defined := root, true
		for _, node := range path {
			if prop, defined = prop.Property(node); !defined {
				break
			}
		}
		if !defined || domain.DeriveUnique(prop) == domain.AttributeUniquenessUnspecified {
			continue
		}
		if value, ok := maputil.GetNested[any](attributes, path); ok && !reflect.DeepEqual(value, claim) {
			return r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorSSOVerifiedUniqueValueChanged, nil))
		}
	}
	probe, _ := ssoUniqueClaims(schema, attributes)
	identifier := root.String(domain.SchemaAnnotationIdentifier)
	bound, err := r.bindSSOCollision(pc.ctx, state, step, collected, probe, attributes, identifier)
	if result, handled, err := r.ssoCollectionBindResult(pc, resolved, loadInput, bound, err); handled {
		return result, err
	}
	// The submit already required the step's own fields, so a required
	// property still missing is one no edit on the step can supply: the
	// definition does not collect it on this path. Checked after the probe,
	// which binds an existing user without creating one.
	present := map[string]struct{}{}
	var walk func(prefix domain.AttributeKey, m map[string]any)
	walk = func(prefix domain.AttributeKey, m map[string]any) {
		for name, value := range m {
			path := prefix.AppendNode(name)
			present[string(path)] = struct{}{}
			if nested, ok := value.(map[string]any); ok {
				walk(path, nested)
			}
		}
	}
	walk("", attributes)
	for path := range domain.NewSchemaReader(schema).RequiredPaths(present) {
		if _, ok := present[path]; !ok {
			return r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorSSOUserCannotBeCreated, nil))
		}
	}
	userID, err := r.ssoIdentities.CreateLinked(pc.ctx, domain.FlowSSOCreateInput{
		ProjectID:     state.ProjectID,
		AttemptID:     state.AuthAttemptID,
		CheckID:       collected.CheckID,
		UserSchemaURL: state.UserSchemaURL,
		ConnectionID:  collected.ConnectionID,
		Subject:       collected.Subject,
		Attributes:    attributes,
		Password:      state.CollectedData.AuthMethods.Password,
	})
	switch {
	case errors.Is(err, domain.ErrUserAlreadyExists()):
		// Another flow took a unique value since the probe: whoever took it
		// is bound.
		bound, err := r.bindSSOCollision(pc.ctx, state, step, collected, probe, attributes, identifier)
		if result, handled, err := r.ssoCollectionBindResult(pc, resolved, loadInput, bound, err); handled {
			return result, err
		}
		return r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorUserAlreadyExists, err))
	case errors.Is(err, domain.ErrSSOStateInvalid()):
		return r.resolveStaleSSOSubmit(pc, resolved, loadInput)
	case errors.Is(err, domain.ErrUserPasswordPolicyViolation(nil)):
		// The password the user chose breaks the policy: show it on the
		// password field, as registration does, so they can pick another.
		if derr, ok := errors.AsType[domain.Error](err); ok {
			if details, ok := derr.Details.(domain.PasswordPolicyViolations); ok {
				return r.renderStepError(pc, resolved, domain.FlowStepFailed(domain.PasswordPolicyStepError(details.Violations), err))
			}
		}
		return FlowStepResult{}, fmt.Errorf("flow state machine: create sso user: %w", err)
	case domain.IsUserInvalid(err):
		// RequiredPaths does not see a property that allOf or a reference
		// requires. The schema library locates it by keyword, as in
		// properties/account allOf/0 required/id. It reports a property a then
		// requires the same way, without the condition, so that one is treated
		// as required too. anyOf and oneOf report no location, so their
		// failures stay sso_user_invalid.
		for _, ve := range domain.ValidationFailures(err) {
			if ve.Loc == nil || len(*ve.Loc) == 0 || !strings.HasPrefix((*ve.Loc)[len(*ve.Loc)-1], "required/") {
				continue
			}
			path, complete := domain.ValidationErrAttributeKey(ve, attributes)
			if !complete {
				continue
			}
			if !slices.ContainsFunc(resolved.Fields, func(f domain.FlowField) bool { return f.Name == string(path) }) {
				return r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorSSOUserCannotBeCreated, err))
			}
		}
		// Each field passed on its own, so the values fail only together.
		return r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorSSOUserInvalid, err))
	case err != nil:
		return FlowStepResult{}, fmt.Errorf("flow state machine: create sso user: %w", err)
	}
	recordResolvedUser(state, userID)
	result, err := r.routeOutcome(pc, resolved, pc.in.Action, true)
	if errors.Is(err, domain.ErrAuthAttemptAlreadyHandedOff()) {
		// A render that retried the handoff from the bind won it.
		return FlowStepResult{}, domain.ErrFlowRestartRequired().WithParent(err)
	}
	return result, err
}

// ssoCollectionBindResult turns the collision probe on the collection step
// into a result. handled is false when no user holds a probed value, and the
// caller goes on.
func (r *FlowStateMachineRuntime) ssoCollectionBindResult(pc *processCtx, resolved domain.FlowResolvedFields, loadInput domain.FlowSSOLoadInput, bound bool, err error) (FlowStepResult, bool, error) {
	switch {
	case errors.Is(err, domain.ErrSSOStateInvalid()):
		result, err := r.resolveStaleSSOSubmit(pc, resolved, loadInput)
		return result, true, err
	case errors.Is(err, errSSOUnroutable):
		result, err := r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorSSOUnavailable, err))
		return result, true, err
	case errors.Is(err, domain.ErrSSOOwnerOtherSchema):
		// The user typed the value and can change it, so it shows taken, as
		// for any other taken value. Only the log names the other schema.
		result, err := r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorUserAlreadyExists, err))
		return result, true, err
	case err != nil:
		return FlowStepResult{}, true, err
	case bound:
		// The bind replaced the row this step creates from, so back to it
		// could not create a user.
		result, err := r.routeOutcome(pc, resolved, domain.FlowImplicitOutcomeUserAlreadyExists, true)
		return result, true, err
	}
	return FlowStepResult{}, false, nil
}

// resolveStaleSSOSubmit handles a collection submit whose row is gone or was
// claimed: a bound user signs in through the retry, and anything else shows
// the step again with the typed values.
func (r *FlowStateMachineRuntime) resolveStaleSSOSubmit(pc *processCtx, resolved domain.FlowResolvedFields, loadInput domain.FlowSSOLoadInput) (FlowStepResult, error) {
	result, _, err := r.resolveStaleSSOBind(pc, resolved, loadInput)
	if err != nil || result.Step != nil {
		return result, err
	}
	return r.renderStepError(pc, resolved, nil)
}

// resolveSSOProviders renders the step's connection slugs through the
// resolver.
func (r *FlowStateMachineRuntime) resolveSSOProviders(ctx context.Context, state *domain.FlowState, step *domain.FlowDefinitionStep) ([]domain.FlowSSOProvider, error) {
	if len(step.SSOProviders) == 0 {
		return nil, nil
	}
	if r.ssoProviders == nil {
		return nil, fmt.Errorf("%w: sso provider resolver not wired", domain.ErrFlowIntegrity())
	}
	providers, err := r.ssoProviders.Resolve(ctx, state.ProjectID, step.SSOProviders)
	if err != nil {
		return nil, fmt.Errorf("flow state machine: resolve sso providers on step %q: %w", step.Name, err)
	}
	return providers, nil
}
