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

	vars, err := h.variableService.GetVariables(ctx, variableOwner(params.ProjectID, params.EnvironmentName))
	if err != nil {
		return nil, err
	}

	out, err := toAPIVariables(vars)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (h *Handler) GetVariable(ctx context.Context, params api.GetVariableParams) (api.GetVariableRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), variableAccess, opRead); err != nil {
		return nil, err
	}

	name := string(params.VariableName)
	owner := variableOwner(params.ProjectID, params.EnvironmentName)
	variables, err := h.variableService.GetVariables(ctx, owner, name)
	if err != nil {
		return nil, err
	}
	// At most one row: the read admits one owner and the primary key makes a
	// name unique within it, so there is nothing to choose between. Empty means
	// this owner has not entered the name -- another owner of the same project
	// may hold it, and that is still a miss here, because nothing is inherited.
	if len(variables) == 0 {
		return nil, domain.ErrVariableNotFound()
	}
	value, err := toAPIVariable(variables[0])
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func (h *Handler) UpdateVariables(ctx context.Context, req api.UpdateVariablesRequest, params api.UpdateVariablesParams) (api.UpdateVariablesRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), variableAccess, opWrite); err != nil {
		return nil, err
	}

	owner := variableOwner(params.ProjectID, params.EnvironmentName)
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

	if err := h.variableService.SetVariables(ctx, owner, writes); err != nil {
		return nil, err
	}

	vars, err := h.variableService.GetVariables(ctx, variableOwner(params.ProjectID, params.EnvironmentName))
	if err != nil {
		return nil, err
	}
	out, err := toAPIVariables(vars)
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

	owner := variableOwner(params.ProjectID, params.EnvironmentName)
	if err := h.variableService.DeleteVariable(ctx, owner, string(params.VariableName)); err != nil {
		return nil, err
	}
	return &api.DeleteVariableNoContent{}, nil
}

/* ---------------- CONVERTERS ---------------- */

func variableOwner(projectID api.ProjectID, environment api.OptEnvironmentName) domain.VariableOwner {
	return domain.VariableOwner{
		ProjectID:       string(projectID),
		EnvironmentName: string(environment.Value),
	}
}

// toAPIVariables keys a read by name. The names are already unique -- one read,
// one owner, and the primary key does the rest -- so no entry here overwrites
// another.
func toAPIVariables(variables []*domain.Variable) (api.Variables, error) {
	out := make(api.Variables, len(variables))
	for _, variable := range variables {
		value, err := toAPIVariable(variable)
		if err != nil {
			return nil, err
		}
		out[variable.Name] = value
	}
	return out, nil
}

// toAPIVariable renders one variable for the wire. A secret is
// reported as held and nothing else: the row carries ciphertext, and returning
// either that or its plaintext would settle a question ADR 061 §9 leaves open.
func toAPIVariable(variable *domain.Variable) (api.Variable, error) {
	if variable.IsSecret {
		return api.NewSecretVariableVariable(api.SecretVariable{Secret: api.SecretVariableSecretTrue}), nil
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

// fromAPIVariableInput reads one entry of an update body. A bare scalar is a
// non-secret value; the object form states the flag. Making a value secret is
// therefore always written down, never inferred.
func fromAPIVariableInput(input api.VariableInput) (value any, isSecret bool, err error) {
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
		domain.ErrSecretNotWholeValue().Code,
		domain.ErrVariableDocumentTooDeep().Code,
		domain.ErrVariableExpansionTooLarge().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	default:
		// var.decryption_failed included: a value this server encrypted and
		// cannot read back is a server fault, not a bad request.
		return internalErrorResponse(err)
	}
}
