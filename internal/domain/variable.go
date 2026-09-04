package domain

import (
	"encoding/json"
	"fmt"
	"regexp"
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
)

const PrefixVariable ResourcePrefix = "var"
const MaxVariableStringLength = 1 << 14 // 16k

func ErrVariableNotFound() Error {
	return newError(PrefixVariable.ErrorCodePrefix("not_found"), "variable: not found", nil, nil)
}

func ErrInvalidVariableName() Error {
	return newError(PrefixVariable.ErrorCodePrefix("invalid_name"), fmt.Sprintf("variable name is not valid (%s)", NameRegex), nil, nil)
}

func ErrInvalidVariableValue() Error {
	return newError(PrefixVariable.ErrorCodePrefix("invalid_value"), "the value of the variable is invalid", nil, nil)
}

func ErrNoVariableOwnerProjectID() Error {
	return newError(PrefixVariable.ErrorCodePrefix("no_project_id"), "a variable must be owned by a project", nil, nil)
}

func ErrFailedToDecryptVariable(parent error) Error {
	return newError(PrefixVariable.ErrorCodePrefix("decryption_failed"), "failed to decrypt variable", nil, parent)
}

var NameRegex = regexp.MustCompile(`^\w+$`)

type Variable struct {
	Name     string
	Owner    VariableOwner
	Value    any
	IsSecret bool
}

func NewVariable(name string, owner VariableOwner, value any) (*Variable, error) {
	if owner.ProjectID == "" {
		return nil, ErrNoVariableOwnerProjectID()
	}
	if err := validateVariableValue(value); err != nil {
		return nil, err
	}
	if !NameRegex.MatchString(name) {
		return nil, ErrInvalidVariableName()
	}
	return &Variable{
		Name:     name,
		Owner:    owner,
		Value:    value,
		IsSecret: false,
	}, nil
}

func NewSecretVariable(name string, owner VariableOwner, value any, encrypter crypto.Encrypter) (*Variable, error) {
	if owner.ProjectID == "" {
		return nil, ErrNoVariableOwnerProjectID()
	}
	if err := validateVariableValue(value); err != nil {
		return nil, err
	}
	if !NameRegex.MatchString(name) {
		return nil, ErrInvalidVariableName()
	}
	jsonValue, err := json.Marshal(value)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to marshal variable when encrypting")
	}
	encrypted, err := encrypter.Encrypt(string(jsonValue))
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to encrypt the variable")
	}
	return &Variable{
		Name:     name,
		Owner:    owner,
		Value:    encrypted,
		IsSecret: true,
	}, nil
}

func validateVariableValue(value any) error {
	switch v := value.(type) {
	case bool, byte,
		int, int8, int16, int32, int64,
		float32, float64,
		time.Time, *time.Time:
		return nil
	case string:
		if len(v) > MaxVariableStringLength {
			return ErrInvalidVariableValue().WithDetails(map[string]string{"reason": fmt.Sprintf("the value can only be %dkb", MaxVariableStringLength/1000)})
		}
		return nil
	default:
		return ErrInvalidVariableValue().WithDetails(map[string]string{"reason": "the value can only be a bool, byte, int, float, rune, string or timestamp"})
	}
}

func (v *Variable) GetDecryptedValue(decrypter crypto.Decrypter) (any, error) {
	if !v.IsSecret {
		return v.Value, nil
	}
	svalue, ok := v.Value.(string)
	if !ok {
		return nil, ErrInternal(nil).WithMessage("failed to decrypt variable because it is not a string")
	}
	jsonValue, err := decrypter.Decrypt(svalue)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to decrypt variable")
	}
	var value any
	if err := json.Unmarshal([]byte(jsonValue), &value); err != nil {
		return nil, ErrInternal(err).WithMessage("failed to unmarshal variable when decrypting")
	}
	return value, nil
}

type VariableOwner struct {
	ProjectID       string
	EnvironmentName string
	TeamID          string
	UserSchemaID    string
	UserID          string
}

func (owner *VariableOwner) HasAccessTo(variable *Variable) bool {
	return (variable.Owner.ProjectID == "" || variable.Owner.ProjectID == owner.ProjectID) &&
		(variable.Owner.EnvironmentName == "" || variable.Owner.EnvironmentName == owner.EnvironmentName) &&
		(variable.Owner.TeamID == "" || variable.Owner.TeamID == owner.TeamID) &&
		(variable.Owner.UserSchemaID == "" || variable.Owner.UserSchemaID == owner.UserSchemaID) &&
		(variable.Owner.UserID == "" || variable.Owner.UserID == owner.UserID)
}

// IsMoreSpecificThan reports whether owner sits closer to a requester than
// other does, which is what decides between two variables of the same name.
func (owner *VariableOwner) IsMoreSpecificThan(other VariableOwner) bool {
	return owner.specificity() > other.specificity()
}

// Owner levels, narrowest first. A level is worth more than every level below
// it combined, so summing the levels an owner sets orders owners the way a
// lexicographic comparison from the narrowest level down would: an owner naming
// a user outranks one naming a whole team, however many broader levels that one
// also names.
const (
	variableOwnerLevelProject = 1 << iota
	variableOwnerLevelEnvironment
	variableOwnerLevelTeam
	variableOwnerLevelUserSchema
	variableOwnerLevelUser
)

// specificity ranks an owner against its siblings. The levels are independent
// -- a variable can belong to a user in a team of a project without naming an
// environment or a user schema -- so the levels an owner sets are a set, not a
// depth, and the rank has to account for each of them.
//
// It runs from 0 for an owner scoped to nothing up to 31 for one naming every
// level. Only the ordering of the numbers means anything; the values themselves
// are not a level count and must not be read as one.
func (owner *VariableOwner) specificity() (rank int) {
	if owner.ProjectID != "" {
		rank += variableOwnerLevelProject
	}
	if owner.EnvironmentName != "" {
		rank += variableOwnerLevelEnvironment
	}
	if owner.TeamID != "" {
		rank += variableOwnerLevelTeam
	}
	if owner.UserSchemaID != "" {
		rank += variableOwnerLevelUserSchema
	}
	if owner.UserID != "" {
		rank += variableOwnerLevelUser
	}
	return rank
}

func VariableListToMap(variables []*Variable) (vars map[string]*Variable) {
	vars = make(map[string]*Variable)
	for _, v := range variables {
		existing, ok := vars[v.Name]
		if !ok {
			vars[v.Name] = v
			continue
		}

		if v.Owner.IsMoreSpecificThan(existing.Owner) {
			vars[v.Name] = v
		}
	}
	return vars
}

type Variables map[string]*Variable

func (vs Variables) DecryptAll(decrypter crypto.Decrypter) (Variables, error) {
	ret := make(Variables, len(vs))
	for name, v := range vs {
		value, err := v.GetDecryptedValue(decrypter)
		if err != nil {
			return nil, ErrFailedToDecryptVariable(err).WithDetails(map[string]any{"name": v.Name})
		}
		ret[name] = &Variable{
			Name:  v.Name,
			Owner: v.Owner,
			Value: value,
		}
	}
	return ret, nil
}
