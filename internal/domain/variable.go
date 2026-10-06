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

// VariableAppliesTo says which deploys a value is for: every deploy, or the
// override a preview deploy prefers where one exists. Two values per name is
// the maximum.
//
//go:generate go tool enumer -type VariableAppliesTo -transform snake -trimprefix VariableAppliesTo -sql
type VariableAppliesTo uint8

const (
	VariableAppliesToAll VariableAppliesTo = iota
	VariableAppliesToPreview
)

type Variable struct {
	Name      string
	Owner     VariableOwner
	AppliesTo VariableAppliesTo
	Value     any
	IsSecret  bool
}

func NewVariable(name string, owner VariableOwner, appliesTo VariableAppliesTo, value any) (*Variable, error) {
	if owner.ProjectID == "" {
		return nil, ErrNoVariableOwnerProjectID()
	}
	if !appliesTo.IsAVariableAppliesTo() {
		return nil, ErrInvalidVariableValue().WithDetails(map[string]string{"reason": "unknown applies_to"})
	}
	if err := validateVariableValue(value); err != nil {
		return nil, err
	}
	if err := validateVariableName(name); err != nil {
		return nil, err
	}
	return &Variable{
		Name:      name,
		Owner:     owner,
		AppliesTo: appliesTo,
		Value:     value,
		IsSecret:  false,
	}, nil
}

func NewSecretVariable(name string, owner VariableOwner, appliesTo VariableAppliesTo, value any, encrypter crypto.Encrypter) (*Variable, error) {
	if owner.ProjectID == "" {
		return nil, ErrNoVariableOwnerProjectID()
	}
	if !appliesTo.IsAVariableAppliesTo() {
		return nil, ErrInvalidVariableValue().WithDetails(map[string]string{"reason": "unknown applies_to"})
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
		Name:      name,
		Owner:     owner,
		AppliesTo: appliesTo,
		Value:     encrypted,
		IsSecret:  true,
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

// VariableOwner is the project a variable belongs to.
type VariableOwner struct {
	ProjectID string
}

// HasAccessTo reports whether variable belongs to owner.
//
// This is the predicate [github.com/zitadel/nextgen/internal/storage/variable.VisibleTo]
// compiles into SQL, and the two are proven equal there.
func (owner *VariableOwner) HasAccessTo(variable *Variable) bool {
	return variable.Owner == *owner
}

// ResolveVariablesForDeploy picks the value each name runs under: for a
// preview deploy the preview override where one exists, else the value for
// every deploy; for any other deploy the value for every deploy only. The
// result holds at most one variable per name, in the order names first
// appeared.
func ResolveVariablesForDeploy(vars []*Variable, preview bool) []*Variable {
	byName := make(map[string]*Variable, len(vars))
	var order []string
	for _, v := range vars {
		if v.AppliesTo == VariableAppliesToPreview && !preview {
			continue
		}
		current, seen := byName[v.Name]
		if !seen {
			order = append(order, v.Name)
		}
		if !seen || (v.AppliesTo == VariableAppliesToPreview && current.AppliesTo == VariableAppliesToAll) {
			byName[v.Name] = v
		}
	}
	resolved := make([]*Variable, 0, len(order))
	for _, name := range order {
		resolved = append(resolved, byName[name])
	}
	return resolved
}

// DeploymentVariable is one value frozen onto a deployment: the same
// columns as the store, written in the deployment's transaction and never
// updated, so a secret is copied as the ciphertext it already is.
type DeploymentVariable struct {
	ProjectID    string
	DeploymentID string
	Name         string
	Value        any
	IsSecret     bool
}

// FreezeVariables copies resolved variables onto a deployment.
func FreezeVariables(deploymentID string, vars []*Variable) []*DeploymentVariable {
	frozen := make([]*DeploymentVariable, 0, len(vars))
	for _, v := range vars {
		frozen = append(frozen, &DeploymentVariable{
			ProjectID:    v.Owner.ProjectID,
			DeploymentID: deploymentID,
			Name:         v.Name,
			Value:        v.Value,
			IsSecret:     v.IsSecret,
		})
	}
	return frozen
}

// Thaw turns frozen values back into variables, for the resolver that
// substitutes placeholders.
func (d *DeploymentVariable) Thaw() *Variable {
	return &Variable{
		Name:     d.Name,
		Owner:    VariableOwner{ProjectID: d.ProjectID},
		Value:    d.Value,
		IsSecret: d.IsSecret,
	}
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
			Name:      v.Name,
			Owner:     v.Owner,
			AppliesTo: v.AppliesTo,
			Value:     value,
		}
	}
	return ret, nil
}
