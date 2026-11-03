package domain

import (
	"encoding/json"
	"fmt"
	"net/mail"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/ianlancetaylor/jsonschema/format"
	"github.com/ianlancetaylor/jsonschema/types"
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
// make the user impossible to patch for an unrelated attribute. A failure is
// the same one if its location and message are, and the validator's format
// messages quote the value, so changing a bad value to another bad one is new.
func validateUserAttributes(schema *jsonschema.Schema, doc, stored map[string]any) error {
	err := schema.ValidateWithOpts(doc, attributeValidation)
	if err == nil || stored == nil || !jsonschema.IsValidationError(err) {
		return err
	}
	// Anything failing without `format` is not an old format failure.
	if schema.Validate(doc) != nil {
		return err
	}
	identity := func(ve *types.ValidationError) string {
		return ValidationLocation(ve) + "\x00" + ve.Msg
	}
	known := make(map[string]bool)
	for _, ve := range ValidationFailures(schema.ValidateWithOpts(stored, attributeValidation)) {
		known[identity(ve)] = true
	}
	var introduced []*types.ValidationError
	for _, ve := range ValidationFailures(err) {
		if !known[identity(ve)] {
			introduced = append(introduced, ve)
		}
	}
	if len(introduced) == 0 {
		return nil
	}
	return &types.ValidationErrors{Errs: introduced}
}
