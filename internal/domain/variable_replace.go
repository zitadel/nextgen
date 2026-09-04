package domain

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

var variablePlaceholderRegex = regexp.MustCompile(`(?P<placeholder>\$\{\{ *(?P<variableName>\w+) *}})`)

const maxExpansionBytes = 1 << 20 // 1Mb
const maxDocumentDepth = 20

func ErrVariableExpansionTooLarge() Error {
	return newError(PrefixVariable.ErrorCodePrefix("expansion_too_large"), "variable: substitution exceeds the expansion budget", nil, nil)
}

func ErrVariableDocumentTooDeep() Error {
	return newError(PrefixVariable.ErrorCodePrefix("document_too_deep"), "variable: document nests too deeply", nil, nil)
}

func ScanDocumentForVariables(doc map[string]any) (placeholders []VariablePlaceholder, err error) {
	// The document itself is a map, never a string, so the root needs no
	// container: nothing replaces the document as a whole.
	err = scanNodeForVariables(doc, nil, &placeholders, 0)
	return placeholders, err
}

func scanNodeForVariables(node any, address ReaderWriter, placeholders *[]VariablePlaceholder, depth int) error {
	if depth > maxDocumentDepth {
		return ErrVariableDocumentTooDeep()
	}

	switch typed := node.(type) {
	case map[string]any:
		nestedMap := typed
		for key, value := range nestedMap {
			err := scanNodeForVariables(value, &mapReaderWriter{storage: nestedMap, key: key}, placeholders, depth+1)
			if err != nil {
				return err
			}
		}
	case []any:
		nestedSlice := typed
		for i, value := range nestedSlice {
			err := scanNodeForVariables(value, &sliceReaderWriter{storage: nestedSlice, index: i}, placeholders, depth+1)
			if err != nil {
				return err
			}
		}
	case string:
		value := typed
		matches := variablePlaceholderRegex.FindAllStringSubmatch(value, -1)
		for _, match := range matches {
			*placeholders = append(*placeholders, VariablePlaceholder{
				VariableName: match[variablePlaceholderRegex.SubexpIndex("variableName")],
				Value:        match[variablePlaceholderRegex.SubexpIndex("placeholder")],
				Storage:      address,
			})
		}
	}

	return nil
}

func ReplaceVariables(placeholders []VariablePlaceholder, vars map[string]*Variable) error {
	budget := maxExpansionBytes

	for _, placeholder := range placeholders {
		variable, ok := vars[placeholder.VariableName]
		if !ok {
			continue
		}

		size, err := placeholder.ReplaceWith(variable, budget)
		if err != nil {
			return err
		}
		budget -= size
	}
	return nil
}

type VariablePlaceholder struct {
	// VariableName is the name of the variable with which the placeholder needs
	// to be replaced.
	VariableName string
	// Value is the complete placeholder, "${{ name }}" spacing and all, which
	// is what gets replaced inside the string holding it.
	Value string
	// Storage is the location from which the original value can be read and
	// overwritten. This is needed because it is not possible to create a
	// pointer to a value in a map.
	Storage ReaderWriter
}

func (p VariablePlaceholder) ReplaceWith(variable *Variable, maxSize int) (replacedBytes int, err error) {
	if p.Storage == nil {
		return 0, ErrInternal(nil).WithMessage("cannot replace a variable without storage")
	}
	if variable == nil {
		return 0, nil
	}

	container, ok := p.Storage.Read().(string)
	if !ok {
		return 0, ErrInternal(nil).WithMessage("cannot replace placeholder in non-string container")
	}

	// One string can hold the same placeholder more than once, and the
	// replacement below takes every occurrence at once. So the occurrences
	// are counted here, and the placeholders the earlier pass already resolved
	// find nothing left to do and cost nothing.
	occurrences := strings.Count(container, p.Value)
	if occurrences == 0 {
		return 0, nil
	}

	strValue := renderVariableValue(variable.Value)
	replacedBytes = occurrences * len(strValue)
	if replacedBytes > maxSize {
		return 0, ErrVariableExpansionTooLarge().WithDetails(map[string]any{"variableName": p.VariableName})
	}
	// if the placeholder takes up the entire value, just replace it so that type
	// is maintained. E.g. "${{ RETRY_COUNT }}" becomes 10 instead of "10"
	if p.Value == container {
		p.Storage.Write(variable.Value)
	} else {
		p.Storage.Write(strings.ReplaceAll(container, p.Value, strValue))
	}

	return replacedBytes, nil
}

func renderVariableValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%v", value)
	}
	return string(encoded)
}

type ReaderWriter interface {
	Write(v any)
	Read() any
}

type mapReaderWriter struct {
	storage map[string]any
	key     string
}

func (a *mapReaderWriter) Write(v any) {
	a.storage[a.key] = v
}
func (a *mapReaderWriter) Read() any {
	return a.storage[a.key]
}

type sliceReaderWriter struct {
	storage []any
	index   int
}

func (a *sliceReaderWriter) Write(v any) {
	a.storage[a.index] = v
}
func (a *sliceReaderWriter) Read() any {
	return a.storage[a.index]
}
