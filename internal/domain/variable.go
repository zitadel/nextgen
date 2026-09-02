package domain

import (
	"encoding/json"

	"github.com/zitadel/nextgen/internal/crypto"
)

// PrefixVariable namespaces variable error codes. It is not an id-minting
// prefix: a variable is keyed by its name and owner (ADR 047 governs minted
// resource PKs), so nothing ever generates a "var_" id.
const PrefixVariable ResourcePrefix = "var"

// ErrVariableNotFound reports that the requester holds no variable under the
// requested name. Callers that have a built-in default should treat this as
// "unset" rather than as a failure.
func ErrVariableNotFound() Error {
	return newError(PrefixVariable.ErrorCodePrefix("not_found"), "variable: not found", nil, nil)
}

type VariableScope int

const (
	VariableScopeUnspecified VariableScope = iota
	VariableScopeProject
	VariableScopeTeam
	VariableScopeUserSchema
	VariableScopeUser
)

type Variable struct {
	Name     string
	Owner    VariableOwner
	Value    any
	IsSecret bool
}

func NewVariable(name string, owner VariableOwner, value any) *Variable {
	return &Variable{
		Name:     name,
		Owner:    owner,
		Value:    value,
		IsSecret: false,
	}
}

func NewSecretVariable(name string, owner VariableOwner, value any, encrypter crypto.Encrypter) (*Variable, error) {
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
	ProjectID    string
	TeamID       string
	UserSchemaID string
	UserID       string
}

func (owner *VariableOwner) HasAccessTo(variable *Variable) bool {
	return (variable.Owner.ProjectID == "" || variable.Owner.ProjectID == owner.ProjectID) &&
		(variable.Owner.TeamID == "" || variable.Owner.TeamID == owner.TeamID) &&
		(variable.Owner.UserSchemaID == "" || variable.Owner.UserSchemaID == owner.UserSchemaID) &&
		(variable.Owner.UserID == "" || variable.Owner.UserID == owner.UserID)
}
