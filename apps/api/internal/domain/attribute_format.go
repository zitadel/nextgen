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
	format.RegisterFormatValidator("idn-email", assertEmailFormat)
}

// assertEmailFormat replaces the validator's `email` and `idn-email`, which
// take whatever net/mail parses to an address: padding and angle brackets pass,
// and would be stored as typed. Its `email` also refuses a non-ASCII domain,
// which a real address may have and the sign-up flow has always let through.
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
// the same rules as a user write, so a flow step cannot accept what
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
