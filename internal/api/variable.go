package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) GetVariables(ctx context.Context, params api.GetVariablesParams) (api.GetVariablesRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), variableAccess, opRead); err != nil {
		return nil, err
	}

	kind, err := fromAPIVariableKind(params.Kind)
	if err != nil {
		return nil, err
	}
	vars, err := h.variableService.GetVariables(ctx, variableOwner(params.ProjectID), kind)
	if err != nil {
		return nil, err
	}

	out, err := toAPIVariablesByKind(vars)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (h *Handler) GetVariable(ctx context.Context, params api.GetVariableParams) (api.GetVariableRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), variableAccess, opRead); err != nil {
		return nil, err
	}

	kind, err := fromAPIVariableKind(params.Kind)
	if err != nil {
		return nil, err
	}
	variables, err := h.variableService.GetVariables(ctx, variableOwner(params.ProjectID), kind, string(params.VariableName))
	if err != nil {
		return nil, err
	}
	// At most one row per kind: the name is unique within the project and
	// kind. No row for any kind asked for is the name not being held there,
	// a name held for the other kind alone included.
	if len(variables) == 0 {
		return nil, domain.ErrVariableNotFound()
	}
	var out api.VariableByKind
	for _, variable := range variables {
		if err := setAPIVariableByKind(&out, variable); err != nil {
			return nil, err
		}
	}
	return &out, nil
}

func (h *Handler) UpdateVariables(ctx context.Context, req api.UpdateVariablesRequest, params api.UpdateVariablesParams) (api.UpdateVariablesRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), variableAccess, opWrite); err != nil {
		return nil, err
	}

	// The spec says minProperties: 1, but ogen generates no check for it on a
	// map body -- its validator walks the entries and an empty map has none. So
	// an empty body would reach here and no-op, telling a client its update
	// succeeded when it sent nothing. Refuse it.
	if len(req) == 0 {
		return nil, domain.ErrRequestInvalid().
			WithMessage("the request body must name at least one variable")
	}

	kind, err := fromAPIVariableKind(params.Kind)
	if err != nil {
		return nil, err
	}
	owner := variableOwner(params.ProjectID)

	writes := make([]service.VariableToSet, 0, len(req))
	for name, input := range req {
		value, isSecret, err := fromAPIVariableInput(input)
		if err != nil {
			return nil, err
		}
		if !domain.NameRegex.MatchString(name) {
			return nil, domain.ErrInvalidVariableName()
		}
		writes = append(writes, service.VariableToSet{Name: name, Value: value, IsSecret: isSecret})
	}

	if err := h.variableService.SetVariables(ctx, owner, kind, writes); err != nil {
		return nil, err
	}

	// The response is the read the request's kind would get, so a caller
	// writing one kind sees that kind alone.
	vars, err := h.variableService.GetVariables(ctx, owner, kind)
	if err != nil {
		return nil, err
	}
	out, err := toAPIVariablesByKind(vars)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (h *Handler) DeleteVariable(ctx context.Context, params api.DeleteVariableParams) (api.DeleteVariableRes, error) {
	// opWrite, not opDelete: a variable is a configuration value, and a caller
	// who may overwrite it can already destroy what it held. Requiring a
	// stronger relation to remove the name than to blank it would gate the
	// tidier of the two operations more heavily than the destructive one.
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), variableAccess, opWrite); err != nil {
		return nil, err
	}

	kind, err := fromAPIVariableKind(params.Kind)
	if err != nil {
		return nil, err
	}
	if err := h.variableService.DeleteVariable(ctx, variableOwner(params.ProjectID), kind, string(params.VariableName)); err != nil {
		return nil, err
	}
	return &api.DeleteVariableNoContent{}, nil
}

/* ---------------- CONVERTERS ---------------- */

// variableOwner is the project the request addresses: variables are owned by
// the project and nothing else (ADR 068).
func variableOwner(projectID api.ProjectID) domain.VariableOwner {
	return domain.VariableOwner{ProjectID: string(projectID)}
}

// fromAPIVariableKind maps the optional kind of a request onto the service's
// selector: absent is nil, which addresses both kinds. The decoder has
// validated the enum, so a value with no mapping is a disagreement between
// the contract and this code, not a bad request.
func fromAPIVariableKind(kind api.OptVariableKind) (*domain.DeploymentOriginKind, error) {
	value, ok := kind.Get()
	if !ok {
		return nil, nil
	}
	switch value {
	case api.VariableKindPrimary:
		return new(domain.DeploymentOriginKindPrimary), nil
	case api.VariableKindPreview:
		return new(domain.DeploymentOriginKindPreview), nil
	default:
		return nil, domain.ErrInternal(nil).WithMessage("variable kind has no store mapping")
	}
}

// toAPIVariablesByKind keys a read by name, each name holding the value per
// kind the read returned. A name entered for one kind alone has the other
// slot absent: nothing falls back from one kind to the other.
func toAPIVariablesByKind(variables []*domain.Variable) (api.VariablesByKind, error) {
	out := make(api.VariablesByKind, len(variables))
	for _, variable := range variables {
		byKind := out[variable.Name]
		if err := setAPIVariableByKind(&byKind, variable); err != nil {
			return nil, err
		}
		out[variable.Name] = byKind
	}
	return out, nil
}

// setAPIVariableByKind places variable in the slot of its kind.
func setAPIVariableByKind(byKind *api.VariableByKind, variable *domain.Variable) error {
	value, err := toAPIVariable(variable)
	if err != nil {
		return err
	}
	switch variable.Kind {
	case domain.DeploymentOriginKindPrimary:
		byKind.Primary = api.NewOptVariable(value)
	case domain.DeploymentOriginKindPreview:
		byKind.Preview = api.NewOptVariable(value)
	default:
		// Only this server writes these rows, and the column CHECK admits the
		// two kinds the wire has a slot for.
		return domain.ErrInternal(nil).WithMessage("stored variable has a kind the wire does not carry")
	}
	return nil
}

// toAPIVariable renders one variable for the wire. A secret is
// reported as held and nothing else: the row carries ciphertext, and returning
// either that or its plaintext would settle a question ADR 062 §9 leaves open.
func toAPIVariable(variable *domain.Variable) (api.Variable, error) {
	if variable.IsSecret {
		return api.NewSecretVariableVariable(api.SecretVariable{Secret: true}), nil
	}
	scalar, err := toAPIVariableScalar(variable.Value)
	if err != nil {
		return api.Variable{}, err
	}
	return api.NewVariableScalarVariable(scalar), nil
}

// toAPIVariableScalar maps a stored value onto the wire's scalar union. Values
// round-trip through JSON on the way in, so a stored number is a float64 by
// the time it reaches here; the integer cases cover a value handed over
// in-process, which never met a decoder.
func toAPIVariableScalar(value any) (api.VariableScalar, error) {
	switch v := value.(type) {
	case string:
		return api.NewStringVariableScalar(v), nil
	case bool:
		return api.NewBoolVariableScalar(v), nil
	case float64:
		return api.NewFloat64VariableScalar(v), nil
	case float32:
		return api.NewFloat64VariableScalar(float64(v)), nil
	case int:
		return api.NewFloat64VariableScalar(float64(v)), nil
	case int32:
		return api.NewFloat64VariableScalar(float64(v)), nil
	case int64:
		return api.NewFloat64VariableScalar(float64(v)), nil
	default:
		// Not a client error: only this server writes these rows, so a value
		// JSON has no scalar for means a stored row disagrees with the
		// validation that let it in.
		return api.VariableScalar{}, domain.ErrInternal(nil).
			WithMessage("stored variable is not a JSON scalar")
	}
}

func fromAPIVariableInput(input api.VariableInput) (value any, isSecret bool, err error) {
	if input.IsNull() {
		return nil, false, nil
	}
	switch input.Type {
	case api.VariableScalarVariableInput:
		value, err = fromAPIVariableScalar(input.VariableScalar)
		return value, false, err
	case api.SecretVariableInputVariableInput:
		value, err = fromAPIVariableScalar(input.SecretVariableInput.Value)
		return value, input.SecretVariableInput.Secret, err
	default:
		return nil, false, domain.ErrInvalidVariableValue().
			WithDetails(map[string]string{"reason": "the value can only be a bool, number or string, or an object with a value and a secret flag"})
	}
}

func fromAPIVariableScalar(scalar api.VariableScalar) (any, error) {
	switch scalar.Type {
	case api.StringVariableScalar:
		return scalar.String, nil
	case api.BoolVariableScalar:
		return scalar.Bool, nil
	case api.Float64VariableScalar:
		return scalar.Float64, nil
	default:
		return nil, domain.ErrInvalidVariableValue().
			WithDetails(map[string]string{"reason": "the value can only be a bool, number or string"})
	}
}

// variableErrorResponse maps the variable error codes onto statuses. The
// document-shaped ones (too deep, expansion budget, a secret referenced as
// part of a larger string) belong to substitution rather than to these
// endpoints, but they share the code prefix and so are mapped here rather than
// falling through to a 500.
func variableErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrVariableNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrVariablePermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrInvalidVariableName().Code,
		domain.ErrInvalidVariableValue().Code,
		domain.ErrNoVariableOwnerProjectID().Code,
		domain.ErrVariableLimitExceeded().Code,
		domain.ErrSecretNotWholeValue().Code,
		domain.ErrVariableDocumentTooDeep().Code,
		domain.ErrVariableExpansionTooLarge().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	default:
		return internalErrorResponse(err)
	}
}

// environmentErrorResponse maps the environment error codes the deployment
// service and its access check answer onto statuses.
func environmentErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrEnvironmentNotFound().Code, domain.ErrEnvironmentProjectNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	default:
		return internalErrorResponse(err)
	}
}
