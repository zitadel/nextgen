package domain

import "fmt"

// ErrReleaseUnresolvedReference reports a handle a revision in the release
// names that the release does not reference. The message names the pointer
// and the handle.
func ErrReleaseUnresolvedReference() Error {
	return newError(PrefixRelease.ErrorCodePrefix("unresolved_reference"), "release: handle is not in the release", nil, nil)
}

// ReleaseRevision is one pointer of a release with the revision it
// references, loaded, so the release rules can read its content. Exactly the
// field matching Pointer.Kind is set.
type ReleaseRevision struct {
	Pointer        ReleasePointer
	Schema         *JSONSchema
	FlowDefinition *FlowDefinition
	Branding       *Branding
}

// releaseHandleRef is a handle a revision names in field, resolved against
// the release's pointers of kind.
type releaseHandleRef struct {
	kind   ReleasePointerKind
	field  string
	handle string
}

func (r ReleaseRevision) handleRefs() []releaseHandleRef {
	switch r.Pointer.Kind {
	case ReleasePointerKindFlowDefinition:
		return []releaseHandleRef{
			{kind: ReleasePointerKindSchema, field: "user_schema", handle: r.FlowDefinition.UserSchema},
		}
	default:
		return nil
	}
}

// ValidateRelease checks the content of a release as a whole: the rules
// that hold between its revisions rather than within one. Rules run in order
// and the first failure is the answer.
//
// Each rule is called directly rather than from a slice: the error sets in
// the spec are inferred from static calls, and a call through a func value
// hides its errors.
func ValidateRelease(revisions []ReleaseRevision) error {
	if err := validateReleaseReferencesClosed(revisions); err != nil {
		return err
	}
	return nil
}

// validateReleaseReferencesClosed requires every handle a revision names to
// be referenced by the release under that kind.
func validateReleaseReferencesClosed(revisions []ReleaseRevision) error {
	type key struct {
		kind   ReleasePointerKind
		handle string
	}
	included := make(map[key]bool, len(revisions))
	for _, revision := range revisions {
		included[key{revision.Pointer.Kind, revision.Pointer.Handle}] = true
	}
	for _, revision := range revisions {
		for _, ref := range revision.handleRefs() {
			if !included[key{ref.kind, ref.handle}] {
				return ErrReleaseUnresolvedReference().WithMessage(fmt.Sprintf("%s %s: %s %s not found",
					revision.Pointer.Kind, revision.Pointer.Handle, ref.field, ref.handle))
			}
		}
	}
	return nil
}
