package domain

import (
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/zitadel/nextgen/internal/crypto"
)

const PrefixVariable ResourcePrefix = "var"
const MaxVariableStringLength = 1 << 14 // 16k

func ErrVariableNotFound() Error {
	return newError(PrefixVariable.ErrorCodePrefix("not_found"), "variable: not found", nil, nil)
}

// The message stays a literal: gen_error_schemas reads it straight off the AST
// and skips any error whose message it cannot, which leaves the code in the
// catalog with no schema file for the generated $ref to resolve. The pattern
// travels in the details instead.
func ErrInvalidVariableName() Error {
	return newError(PrefixVariable.ErrorCodePrefix("invalid_name"), "the name of the variable is invalid",
		map[string]string{"pattern": NameRegex.String()}, nil)
}

func ErrInvalidVariableValue() Error {
	return newError(PrefixVariable.ErrorCodePrefix("invalid_value"), "the value of the variable is invalid", nil, nil)
}

func ErrNoVariableOwnerProjectID() Error {
	return newError(PrefixVariable.ErrorCodePrefix("no_project_id"), "a variable must be owned by a project", nil, nil)
}

func ErrVariablePermissionDenied() Error {
	return newError(PrefixVariable.ErrorCodePrefix("permission_denied"), "variable: permission denied", nil, nil)
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
	case bool,
		int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64,
		float32, float64:
		return nil
	case string:
		if len(v) > MaxVariableStringLength {
			return ErrInvalidVariableValue().WithDetails(map[string]string{"reason": fmt.Sprintf("the value can only be %dkb", MaxVariableStringLength/1000)})
		}
		return nil
	default:
		return ErrInvalidVariableValue().WithDetails(map[string]string{"reason": "the value can only be a bool, number or string"})
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
	ProjectID string
	// EnvironmentName names the environment of the project the variable belongs
	// to, by name rather than by id: that is how an environment is addressed
	// everywhere else, and it is what a request serving an environment knows.
	//
	// TODO: nothing checks that the environment exists. The empty string means
	// "not scoped to an environment", so no environment row can ever match it
	// and the table cannot carry the reference the way project_id does; the
	// check belongs on the write path, against GetEnvironmentByName. Until
	// then a typo scopes a variable into invisibility rather than failing.
	EnvironmentName string
}

// HasAccessTo reports whether variable belongs to owner. An owner reaches
// exactly what it entered itself: nothing is inherited from a broader owner,
// and nothing is visible from a narrower one.
//
// The predicate used to admit a row whose level was unset, so a project value
// was readable from every environment of that project. Dropping that makes the
// owner an address rather than a position in a ladder -- one name at one owner
// is one variable, and a read never has two rows to choose between. A value
// that should hold everywhere is entered at the project and read from the
// project; an environment that wants it has to enter it.
//
// This is the predicate [github.com/zitadel/nextgen/internal/storage/variable.VisibleTo]
// compiles into SQL, and the two are proven equal there.
func (owner *VariableOwner) HasAccessTo(variable *Variable) bool {
	return variable.Owner == *owner
}

// VariableListToMap keys a read by name. The primary key is name plus owner and
// a read admits one owner, so the names in variables are already unique: there
// is no ranking to do here and no row to discard. It stayed a function rather
// than becoming an inline loop because the uniqueness it relies on is a
// property of the read, and this is where to look when that changes.
func VariableListToMap(variables []*Variable) (vars map[string]*Variable) {
	vars = make(map[string]*Variable, len(variables))
	for _, v := range variables {
		vars[v.Name] = v
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
