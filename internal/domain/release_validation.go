package domain

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ianlancetaylor/jsonschema"
)

// ErrReleaseUnresolvedReference reports a handle a revision in the release
// names that the release does not reference. The message names the pointer
// and the handle.
func ErrReleaseUnresolvedReference() Error {
	return newError(PrefixRelease.ErrorCodePrefix("unresolved_reference"), "release: handle is not in the release", nil, nil)
}

// ReleaseContent is the revisions a release references, loaded so the
// release rules can read them. A release references any number of schemas,
// flow definitions and IDP connections, and at most one branding.
type ReleaseContent struct {
	Schemas         []*JSONSchema
	FlowDefinitions []*FlowDefinition
	IDPConnections  []*IDPConnection
	Branding        *Branding
}

// Pointers derives the release's pointers from its content: each revision
// declares its own handle and id. A schema without an objectType is not
// referenceable and has to be refused before it gets here.
func (c ReleaseContent) Pointers() []ReleasePointer {
	pointers := make([]ReleasePointer, 0, len(c.Schemas)+len(c.FlowDefinitions)+len(c.IDPConnections)+1)
	for _, schema := range c.Schemas {
		pointers = append(pointers, ReleasePointer{Kind: ReleasePointerKindSchema, Handle: *schema.ObjectType, RevisionID: schema.URL})
	}
	for _, flow := range c.FlowDefinitions {
		pointers = append(pointers, ReleasePointer{Kind: ReleasePointerKindFlowDefinition, Handle: flow.Name, RevisionID: flow.ID})
	}
	for _, idp := range c.IDPConnections {
		pointers = append(pointers, ReleasePointer{Kind: ReleasePointerKindIDP, Handle: idp.Slug, RevisionID: idp.RevisionID})
	}
	if c.Branding != nil {
		pointers = append(pointers, ReleasePointer{Kind: ReleasePointerKindBranding, Handle: ReleaseBrandingHandle, RevisionID: c.Branding.ID})
	}
	return pointers
}

// ValidateRelease checks the content of a release as a whole: the rules
// that hold between its revisions rather than within one. Rules run in order
// and the first failure is the answer.
//
// Each rule is called directly rather than from a slice: the error sets in
// the spec are inferred from static calls, and a call through a func value
// hides its errors.
func ValidateRelease(content ReleaseContent) error {
	if err := validateReleaseReferencesClosed(content); err != nil {
		return err
	}
	if err := validateReleaseFlowsFitSchemas(content); err != nil {
		return err
	}
	return nil
}

// releaseHandleRef is a handle a revision names in field, resolved against
// the release's pointers of kind.
type releaseHandleRef struct {
	kind   ReleasePointerKind
	field  string
	handle string
}

// validateReleaseReferencesClosed requires every handle a revision names to
// be referenced by the release under that kind:
//   - a flow definition's user_schema, a schema;
//   - a flow step's sso_providers, IDP connections;
//   - a schema's x-auth-methods.sso.providers, IDP connections.
func validateReleaseReferencesClosed(content ReleaseContent) error {
	pointers := content.Pointers()
	included := make(map[releaseHandleKey]bool, len(pointers))
	for _, pointer := range pointers {
		included[releaseHandleKey{pointer.Kind, pointer.Handle}] = true
	}

	for _, flow := range content.FlowDefinitions {
		refs := []releaseHandleRef{{kind: ReleasePointerKindSchema, field: "user_schema", handle: flow.UserSchema}}
		for _, step := range flow.Steps {
			for _, slug := range step.SSOProviders {
				refs = append(refs, releaseHandleRef{
					kind: ReleasePointerKindIDP, field: fmt.Sprintf("step %s sso_providers", step.Name), handle: slug,
				})
			}
		}
		if err := requireReleaseHandles(included, ReleasePointerKindFlowDefinition, flow.Name, refs); err != nil {
			return err
		}
	}
	for _, schema := range content.Schemas {
		providers, err := schemaSSOProviders(schema)
		if err != nil {
			return err
		}
		refs := make([]releaseHandleRef, 0, len(providers))
		for _, slug := range providers {
			refs = append(refs, releaseHandleRef{kind: ReleasePointerKindIDP, field: "x-auth-methods.sso.providers", handle: slug})
		}
		if err := requireReleaseHandles(included, ReleasePointerKindSchema, *schema.ObjectType, refs); err != nil {
			return err
		}
	}
	return nil
}

type releaseHandleKey struct {
	kind   ReleasePointerKind
	handle string
}

// requireReleaseHandles reports the first ref of the revision (kind, handle)
// that the release does not include.
func requireReleaseHandles(included map[releaseHandleKey]bool, kind ReleasePointerKind, handle string, refs []releaseHandleRef) error {
	for _, ref := range refs {
		if !included[releaseHandleKey{ref.kind, ref.handle}] {
			return ErrReleaseUnresolvedReference().WithMessage(
				fmt.Sprintf("%s %s: %s %s not found", kind, handle, ref.field, ref.handle))
		}
	}
	return nil
}

// schemaSSOProviders reads the IDP connection slugs a user schema offers
// under x-auth-methods.sso.providers.
func schemaSSOProviders(schema *JSONSchema) ([]string, error) {
	var document struct {
		AuthMethods struct {
			SSO struct {
				Providers []string `json:"providers"`
			} `json:"sso"`
		} `json:"x-auth-methods"`
	}
	if err := json.Unmarshal(schema.Schema, &document); err != nil {
		return nil, ErrInternal(err).WithMessage("failed to unmarshal user schema")
	}
	return document.AuthMethods.SSO.Providers, nil
}

// validateReleaseFlowsFitSchemas checks every flow against the user schema
// revision the release references under its user_schema handle, as a flow is
// checked on save. A flow saved against one revision may not fit another.
// Runs after closure, so the schema is always there.
func validateReleaseFlowsFitSchemas(content ReleaseContent) error {
	schemas := make(map[string]*JSONSchema, len(content.Schemas))
	for _, schema := range content.Schemas {
		schemas[*schema.ObjectType] = schema
	}
	for _, flow := range content.FlowDefinitions {
		schema := schemas[flow.UserSchema]

		var document *jsonschema.Schema
		if err := json.Unmarshal(schema.Schema, &document); err != nil {
			return ErrInternal(err).WithMessage("failed to unmarshal user schema")
		}
		if _, err := ValidateFlowDefinition(document, *flow); err != nil {
			reason, ok := errors.AsType[Error](err)
			if !ok {
				return ErrInternal(err).WithMessage("failed to validate flow definition")
			}
			details := reason.Details
			if details == nil {
				details = reason.Message
			}
			return ErrReleaseInvalid(details, err).WithMessage(fmt.Sprintf("%s %s: does not fit user_schema %s revision %s",
				ReleasePointerKindFlowDefinition, flow.Name, flow.UserSchema, schema.URL))
		}
	}
	return nil
}
