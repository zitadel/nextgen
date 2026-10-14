package domain

import (
	"fmt"
	"slices"
)

// ErrReleaseUnresolvedReference reports a handle a pinned revision references
// that the release does not pin. [CloseReleaseReferences] names the pointer
// and the handle in the message.
func ErrReleaseUnresolvedReference() Error {
	return newError(PrefixRelease.ErrorCodePrefix("unresolved_reference"), "release: referenced handle is not pinned", nil, nil)
}

// ReleaseReference is a handle a pinned revision names in Field, resolved
// against the release's pointers of Kind.
type ReleaseReference struct {
	Kind   ReleasePointerKind
	Field  string
	Handle string
}

// ReleaseReferrer is a pointer with the references its revision carries.
type ReleaseReferrer struct {
	Pointer    ReleasePointer
	References []ReleaseReference
}

// ReleaseReferenceLookup supplies a revision for a handle the pinned set lacks.
// It returns nil without an error when there is none.
type ReleaseReferenceLookup func(ReleaseReference) (*ReleaseReferrer, error)

// FlowDefinitionReleaseReferences returns the handles a flow definition
// references in other kinds.
func FlowDefinitionReleaseReferences(definition *FlowDefinition) []ReleaseReference {
	return []ReleaseReference{
		{Kind: ReleasePointerKindSchema, Field: "user_schema", Handle: definition.UserSchema},
	}
}

// CloseReleaseReferences checks that every reference of every referrer is
// pinned under its kind and returns the pointers to release. A missing handle
// is passed to lookup, when set, and the revision it returns is pinned too,
// its own references checked in turn; a handle neither holds is
// rel.unresolved_reference.
func CloseReleaseReferences(referrers []ReleaseReferrer, lookup ReleaseReferenceLookup) ([]ReleasePointer, error) {
	type key struct {
		kind   ReleasePointerKind
		handle string
	}
	pinned := make(map[key]bool, len(referrers))
	pointers := make([]ReleasePointer, 0, len(referrers))
	for _, referrer := range referrers {
		pinned[key{referrer.Pointer.Kind, referrer.Pointer.Handle}] = true
		pointers = append(pointers, referrer.Pointer)
	}

	// Grows while lookup adds revisions, so theirs are checked as well.
	referrers = slices.Clone(referrers)
	for i := 0; i < len(referrers); i++ {
		referrer := referrers[i]
		for _, ref := range referrer.References {
			if pinned[key{ref.Kind, ref.Handle}] {
				continue
			}
			var found *ReleaseReferrer
			if lookup != nil {
				var err error
				if found, err = lookup(ref); err != nil {
					return nil, err
				}
			}
			if found == nil {
				return nil, ErrReleaseUnresolvedReference().WithMessage(ref.unresolved(referrer.Pointer))
			}
			pinned[key{found.Pointer.Kind, found.Pointer.Handle}] = true
			pointers = append(pointers, found.Pointer)
			referrers = append(referrers, *found)
		}
	}
	return pointers, nil
}

func (ref ReleaseReference) unresolved(pointer ReleasePointer) string {
	return fmt.Sprintf("%s %s: %s %s not found", pointer.Kind, pointer.Handle, ref.Field, ref.Handle)
}
