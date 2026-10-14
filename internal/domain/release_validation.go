package domain

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ianlancetaylor/jsonschema"
)

func ErrReleaseUnresolvedReference() Error {
	return newError(PrefixRelease.ErrorCodePrefix("unresolved_reference"), "release: handle is not in the release", nil, nil)
}

// ReleaseContent is the revisions a release references, loaded for
// [ValidateRelease].
type ReleaseContent struct {
	Schemas         []*JSONSchema
	FlowDefinitions []*FlowDefinition
	IDPConnections  []*IDPConnection
	Branding        *Branding
}

// Pointers returns one pointer per revision, under the handle it declares.
func (c ReleaseContent) Pointers() []ReleasePointer {
	var pointers []ReleasePointer
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

// ValidateRelease checks the rules that hold between a release's revisions.
// Rules are called directly: the spec's error sets are inferred from static
// calls only.
func ValidateRelease(content ReleaseContent) error {
	documents := make(map[string]*jsonschema.Schema, len(content.Schemas))
	for _, schema := range content.Schemas {
		var document *jsonschema.Schema
		if err := json.Unmarshal(schema.Schema, &document); err != nil {
			return ErrInternal(err).WithMessage("failed to unmarshal user schema")
		}
		documents[*schema.ObjectType] = document
	}
	if err := validateReleaseReferencesClosed(content, documents); err != nil {
		return err
	}
	return validateReleaseFlowsFitSchemas(content, documents)
}

// validateReleaseReferencesClosed requires every handle a revision names to
// be in the release.
func validateReleaseReferencesClosed(content ReleaseContent, documents map[string]*jsonschema.Schema) error {
	type key struct {
		kind   ReleasePointerKind
		handle string
	}
	included := make(map[key]bool)
	for _, pointer := range content.Pointers() {
		included[key{pointer.Kind, pointer.Handle}] = true
	}

	for _, flow := range content.FlowDefinitions {
		if !included[key{ReleasePointerKindSchema, flow.UserSchema}] {
			return errReleaseUnresolved(ReleasePointerKindFlowDefinition, flow.Name, "user_schema", flow.UserSchema)
		}
		for _, step := range flow.Steps {
			for _, slug := range step.SSOProviders {
				if !included[key{ReleasePointerKindIDP, slug}] {
					return errReleaseUnresolved(ReleasePointerKindFlowDefinition, flow.Name, "step "+step.Name+" sso_providers", slug)
				}
			}
		}
	}
	for _, schema := range content.Schemas {
		objectType := *schema.ObjectType
		authMethods, err := newSchemaReader(documents[objectType]).AuthMethods()
		if err != nil {
			return ErrInternal(err).WithMessage("failed to read user schema auth methods")
		}
		for _, slug := range authMethods.SSOProviders() {
			if !included[key{ReleasePointerKindIDP, slug}] {
				return errReleaseUnresolved(ReleasePointerKindSchema, objectType, "x-auth-methods.sso.providers", slug)
			}
		}
	}
	return nil
}

func errReleaseUnresolved(kind ReleasePointerKind, handle, field, ref string) error {
	return ErrReleaseUnresolvedReference().WithMessage(fmt.Sprintf("%s %s: %s %s not found", kind, handle, field, ref))
}

// validateReleaseFlowsFitSchemas checks each flow against the schema revision
// in the release, as a save checks it against the newest one. Runs after
// closure, so the schema is there.
func validateReleaseFlowsFitSchemas(content ReleaseContent, documents map[string]*jsonschema.Schema) error {
	revisions := make(map[string]string, len(content.Schemas))
	for _, schema := range content.Schemas {
		revisions[*schema.ObjectType] = schema.URL
	}
	for _, flow := range content.FlowDefinitions {
		if _, err := ValidateFlowDefinition(documents[flow.UserSchema], *flow); err != nil {
			reason, ok := errors.AsType[Error](err)
			if !ok {
				return ErrInternal(err).WithMessage("failed to validate flow definition")
			}
			details := reason.Details
			if details == nil {
				details = reason.Message
			}
			return ErrReleaseInvalid(details, err).WithMessage(fmt.Sprintf("%s %s: does not fit user_schema %s revision %s",
				ReleasePointerKindFlowDefinition, flow.Name, flow.UserSchema, revisions[flow.UserSchema]))
		}
	}
	return nil
}
