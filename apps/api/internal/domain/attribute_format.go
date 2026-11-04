package domain

import (
	"encoding/json"
	"fmt"
	"net/mail"
	"reflect"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/ianlancetaylor/jsonschema/format"
	"github.com/ianlancetaylor/jsonschema/types"

	"github.com/zitadel/nextgen/internal/maputil"
)

// attributeValidation validates user attributes with `format` asserted (ADR
// 009 §5). JSON Schema 2020-12 only annotates `format` by default, and the
// validator follows suit unless asked. A format name the validator does not
// know stays an annotation.
var attributeValidation = &jsonschema.ValidateOpts{ValidateFormat: true}

func init() {
	format.RegisterFormatValidator("email", assertEmailFormat)
}

// assertEmailFormat replaces the validator's `email`, which takes whatever
// net/mail parses to an address: padding and angle brackets pass, and would be
// stored as typed. It also refuses a non-ASCII domain, which a real address may
// have and the sign-up flow has always let through.
func assertEmailFormat(instance any, _ *types.ValidationState) error {
	s, ok := instance.(string)
	if !ok {
		return nil
	}
	addr, err := mail.ParseAddress(s)
	if err != nil || addr.Name != "" || addr.Address != s {
		return fmt.Errorf("%q is not a valid email address", s)
	}
	return nil
}

// AttributeFormatValid reports whether value satisfies the named format, by
// the same rules as [validateUserAttributes], so a flow step cannot accept what
// creating the user then refuses.
func AttributeFormatValid(name, value string) bool {
	document, err := json.Marshal(map[string]string{"format": name})
	if err != nil {
		return true
	}
	var schema jsonschema.Schema
	if err := json.Unmarshal(document, &schema); err != nil {
		return true
	}
	return schema.ValidateWithOpts(value, attributeValidation) == nil
}

// validateUserAttributes validates doc against schema with `format` asserted.
//
// stored is what doc replaces under this same schema, and nil when every value
// is new to it (a create, or a move to another schema). Format failures stored
// already are left alone: values written before `format` was asserted must not
// make the user impossible to patch for an unrelated attribute. A failure counts
// as stored only if stored fails there too and the failing value is unchanged.
func validateUserAttributes(schema *jsonschema.Schema, doc, stored map[string]any) error {
	err := schema.ValidateWithOpts(doc, attributeValidation)
	if err == nil || stored == nil || !jsonschema.IsValidationError(err) {
		return err
	}
	formatFailures, introduced := splitFormatFailures(schema, doc)
	storedFailures := formatFailureLocations(schema, stored)
	changed := changedAttributes(doc, stored)
	changedFailures := formatFailureLocations(schema, changed)
	for _, ve := range formatFailures {
		location := ValidationLocation(ve)
		if !storedFailures[location] {
			introduced = append(introduced, ve)
			continue
		}
		key, _ := ValidationErrAttributeKey(ve, doc)
		now, before := attributeAt(doc, key), attributeAt(stored, key)
		if reflect.DeepEqual(now, before) {
			continue
		}
		// A keyword composed over an object reports on the whole object, so a
		// change to it may be to an unrelated sibling: the changed values alone
		// tell whether they are what fails.
		if _, object := now.(map[string]any); !object || changedFailures[location] {
			introduced = append(introduced, ve)
		}
	}
	if len(introduced) == 0 {
		return nil
	}
	return &types.ValidationErrors{Errs: introduced}
}

// splitFormatFailures validates doc and separates the failures that asserting
// `format` causes from the rest, which a run without it reports the same way.
// Comparing the two runs of one document does not depend on the wording.
func splitFormatFailures(schema *jsonschema.Schema, doc map[string]any) (format, other []*types.ValidationError) {
	identity := func(ve *types.ValidationError) string {
		return ValidationLocation(ve) + "\x00" + ve.Msg
	}
	structural := make(map[string]bool)
	for _, ve := range ValidationFailures(schema.Validate(doc)) {
		structural[identity(ve)] = true
	}
	for _, ve := range ValidationFailures(schema.ValidateWithOpts(doc, attributeValidation)) {
		if structural[identity(ve)] {
			other = append(other, ve)
		} else {
			format = append(format, ve)
		}
	}
	return format, other
}

func formatFailureLocations(schema *jsonschema.Schema, doc map[string]any) map[string]bool {
	failures, _ := splitFormatFailures(schema, doc)
	locations := make(map[string]bool, len(failures))
	for _, ve := range failures {
		locations[ValidationLocation(ve)] = true
	}
	return locations
}

// changedAttributes keeps what doc changes against stored, in doc's shape.
func changedAttributes(doc, stored map[string]any) map[string]any {
	changed := make(map[string]any)
	for key, value := range doc {
		if reflect.DeepEqual(value, stored[key]) {
			continue
		}
		object, isObject := value.(map[string]any)
		before, wasObject := stored[key].(map[string]any)
		if isObject && wasObject {
			changed[key] = changedAttributes(object, before)
		} else {
			changed[key] = value
		}
	}
	return changed
}

// attributeAt reads the value at key; the empty key is the document itself.
func attributeAt(doc map[string]any, key AttributeKey) any {
	if key == "" {
		return doc
	}
	value, _ := maputil.GetNested[any](doc, key.Nodes())
	return value
}
