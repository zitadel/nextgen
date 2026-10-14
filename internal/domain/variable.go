package domain

import (
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/zitadel/nextgen/internal/crypto"
)

const PrefixVariable ResourcePrefix = "var"
const MaxVariableStringLength = 1 << 14 // 16k

// MaxVariableNameLength bounds a name. The regex alone does not: `^\w+$`
// matches any length, so without this a caller could store a name the wire
// contract (components/schemas/variable-name.yaml) declares invalid and could
// never send back. Keep the two in step.
const MaxVariableNameLength = 255

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
	Name  string
	Owner VariableOwner
	// Kind is the target the value applies to: primary or preview. A value
	// that applies to both is two variables, one per kind, and nothing falls
	// back from one kind to the other (ADR 069). The zero value is primary,
	// which is what the constructors leave it at.
	Kind     TargetKind
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
	if err := validateVariableName(name); err != nil {
		return nil, err
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
	if err := validateVariableName(name); err != nil {
		return nil, err
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

func validateVariableName(name string) error {
	if !NameRegex.MatchString(name) {
		return ErrInvalidVariableName()
	}
	if len(name) > MaxVariableNameLength {
		return ErrInvalidVariableName().WithDetails(map[string]string{
			"reason": fmt.Sprintf("the name can be at most %d characters", MaxVariableNameLength),
		})
	}
	return nil
}

func validateVariableValue(value any) error {
	if s, ok := value.(string); ok && len(s) > MaxVariableStringLength {
		return ErrInvalidVariableValue().WithDetails(map[string]string{"reason": fmt.Sprintf("the value can only be %dkb", MaxVariableStringLength/1000)})
	}
	if !isVariableScalar(value) {
		return ErrInvalidVariableValue().WithDetails(map[string]string{"reason": "the value can only be a bool, number or string"})
	}
	return nil
}

// isVariableScalar reports whether value is one of the types a variable can
// hold. The list is what the JSON column stores without loss of meaning, and
// it is shared with the set hash, which relies on encoding these never failing.
func isVariableScalar(value any) bool {
	switch value.(type) {
	case bool,
		int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64,
		float32, float64,
		string:
		return true
	default:
		return false
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
}

// HasAccessTo reports whether variable belongs to owner. An owner reaches
// exactly what it entered itself: nothing is inherited from a broader owner,
// and nothing is visible from a narrower one (ADR 062 §4).
//
// The owner is an address, not a position in a ladder, which is what keeps one
// name at one owner and kind to one variable -- a read admits one owner and
// one kind, so it never has two rows to choose between and no caller needs a
// rule for picking one. A value that should hold everywhere is entered at the
// project and read from the project.
//
// Ownership says nothing about the kind: a read names the kind it wants
// beside the owner. This is the predicate
// [github.com/zitadel/nextgen/internal/storage/variable.VisibleTo] compiles
// into SQL, narrowed to one kind, and the two are proven equal there.
func (owner *VariableOwner) HasAccessTo(variable *Variable) bool {
	return variable.Owner == *owner
}

// VariableListToMap keys a read by name. The primary key is name plus owner
// and kind, and a read admits one owner and one kind, so the names in
// variables are already unique: there is no ranking to do here and no row to
// discard. It stayed a function rather than becoming an inline loop because
// the uniqueness it relies on is a property of the read, and this is where to
// look when that changes.
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
			Kind:  v.Kind,
			Value: value,
		}
	}
	return ret, nil
}
