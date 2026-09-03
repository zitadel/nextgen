package domain

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
)

var variablePlaceholderRegex = regexp.MustCompile(`^\$\{\{ *(?P<placeholder>\w+) *}}$`)

// maxExpansionBytes bounds the total the substituted values add to one
// document, measured as the bytes they serialize to. A variable is capped at
// [MaxVariableStringLength], but nothing caps how many addresses name it, so
// without this a small document could still render a very large response.
const maxExpansionBytes = 1 << 20 // 1Mb

// maxDocumentDepth bounds how deep the scan will walk. A document that arrived
// as JSON is far shallower; the guard is for one built in memory, where a map
// that contains itself would otherwise recurse until the stack runs out.
const maxDocumentDepth = 20

func ErrVariableExpansionTooLarge() Error {
	return newError(PrefixVariable.ErrorCodePrefix("expansion_too_large"), "variable: substitution exceeds the expansion budget", nil, nil)
}

func ErrVariableDocumentTooDeep() Error {
	return newError(PrefixVariable.ErrorCodePrefix("document_too_deep"), "variable: document nests too deeply", nil, nil)
}

func ScanDocumentForVariables(doc map[string]any) (toReplace []VariableToReplace, err error) {
	err = scanNodeForVariables(doc, nil, &toReplace)
	return toReplace, err
}

func scanNodeForVariables(node any, address []any, toReplace *[]VariableToReplace) error {
	if len(address) > maxDocumentDepth {
		return ErrVariableDocumentTooDeep()
	}

	switch typed := node.(type) {
	case map[string]any:
		nestedMap := typed
		for key, value := range nestedMap {
			if err := scanNodeForVariables(value, append(address, key), toReplace); err != nil {
				return err
			}
		}
	case []any:
		nestedSlice := typed
		for i, value := range nestedSlice {
			if err := scanNodeForVariables(value, append(address, i), toReplace); err != nil {
				return err
			}
		}
	case string:
		value := typed
		match := variablePlaceholderRegex.FindStringSubmatch(value)
		if match == nil {
			// if there is no variable with the placeholder name, we assume it is deliberate.
			return nil
		}
		*toReplace = append(*toReplace, VariableToReplace{
			Address:     slices.Clone(address),
			Placeholder: match[variablePlaceholderRegex.SubexpIndex("placeholder")],
		})
	}

	return nil
}

func ReplaceVariablesInDocument(
	doc map[string]any,
	toReplace []VariableToReplace,
	vars map[string]*Variable,
) error {
	budget := maxExpansionBytes

	type resolvedVariable struct {
		value any
		size  int
	}
	resolved := make(map[string]resolvedVariable, len(vars))

	for _, v := range toReplace {
		variable, ok := vars[v.Placeholder]
		if !ok {
			continue
		}

		current, ok := resolved[v.Placeholder]
		if !ok {
			current = resolvedVariable{value: variable.Value, size: renderedSize(variable.Value)}
			resolved[v.Placeholder] = current
		}

		if current.size > budget {
			return ErrVariableExpansionTooLarge().WithDetails(map[string]any{
				"placeholder": v.Placeholder,
				"address":     v.Address,
			})
		}
		budget -= current.size

		if err := setNestedVariable(doc, v.Address, current.value); err != nil {
			return err
		}
	}
	return nil
}

// renderedSize is what value costs when the document is serialized. Variable
// values are scalars, so this is exact and cheap; an unencodable value is
// charged the budget in full rather than being treated as free.
func renderedSize(value any) int {
	encoded, err := json.Marshal(value)
	if err != nil {
		return maxExpansionBytes + 1
	}
	return len(encoded)
}

func setNestedVariable(m map[string]any, address []any, value any) error {
	if len(address) == 0 {
		return ErrInternal(nil).WithMessage("variable address is empty")
	}

	var node any = m
	for _, step := range address[:len(address)-1] {
		child, err := nestedChild(node, step)
		if err != nil {
			return err
		}
		node = child
	}
	return assignNested(node, address[len(address)-1], value)
}

func nestedChild(node any, step any) (any, error) {
	switch key := step.(type) {
	case string:
		nestedMap, ok := node.(map[string]any)
		if !ok {
			return nil, errVariableAddressMismatch(step, "map", node)
		}
		child, ok := nestedMap[key]
		if !ok {
			return nil, ErrInternal(nil).WithMessage("variable address names a key that is no longer present").
				WithDetails(map[string]any{"key": key})
		}
		return child, nil
	case int:
		nestedSlice, ok := node.([]any)
		if !ok {
			return nil, errVariableAddressMismatch(step, "slice", node)
		}
		if key < 0 || key >= len(nestedSlice) {
			return nil, ErrInternal(nil).WithMessage("variable address indexes outside the slice").
				WithDetails(map[string]any{"index": key, "length": len(nestedSlice)})
		}
		return nestedSlice[key], nil
	default:
		return nil, errVariableAddressStep(step)
	}
}

func assignNested(node any, step any, value any) error {
	switch key := step.(type) {
	case string:
		nestedMap, ok := node.(map[string]any)
		if !ok {
			return errVariableAddressMismatch(step, "map", node)
		}
		nestedMap[key] = value
		return nil
	case int:
		nestedSlice, ok := node.([]any)
		if !ok {
			return errVariableAddressMismatch(step, "slice", node)
		}
		if key < 0 || key >= len(nestedSlice) {
			return ErrInternal(nil).WithMessage("variable address indexes outside the slice").
				WithDetails(map[string]any{"index": key, "length": len(nestedSlice)})
		}
		// The slice header is a copy, but it points at the same backing array,
		// so this reaches the document.
		nestedSlice[key] = value
		return nil
	default:
		return errVariableAddressStep(step)
	}
}

func errVariableAddressMismatch(step any, want string, got any) Error {
	return ErrInternal(nil).WithMessage("variable address does not match the document").
		WithDetails(map[string]any{"step": fmt.Sprint(step), "expected": want, "got": fmt.Sprintf("%T", got)})
}

func errVariableAddressStep(step any) Error {
	return ErrInternal(nil).WithMessage("variable address step is neither a map key nor a slice index").
		WithDetails(map[string]any{"type": fmt.Sprintf("%T", step)})
}

type VariableToReplace struct {
	// Address is the chain of field names which leads to this variable in the
	// doc. Keys can be either of type `string` for a nested key in a map or
	// `int` for the index in a list.
	Address []any
	// Placeholder is the string which needs to be replaced with the actual
	// value of the configured variable
	Placeholder string
}
