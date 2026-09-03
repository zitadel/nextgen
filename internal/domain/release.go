package domain

import (
	"cmp"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"
	"time"
)

const (
	PrefixRelease ResourcePrefix = "rel"
)

// ReleasePointerKind is the kind of resource a release pointer pins. The wire
// value is flow_definition rather than flow: the API serves runtime flows at
// /flow and their definitions at /flow_definitions, and a release pins the
// latter (ADR 035, amended 2026-09-02).
//
//go:generate go tool enumer -type ReleasePointerKind -transform snake -trimprefix ReleasePointerKind -sql
type ReleasePointerKind uint8

const (
	ReleasePointerKindSchema ReleasePointerKind = iota
	ReleasePointerKindFlowDefinition
	ReleasePointerKindBranding
)

func ErrReleaseInvalid(details any, parent error) Error {
	return newError(PrefixRelease.ErrorCodePrefix("invalid"), "release: invalid", details, parent)
}

// ReleasePointer pins one revision of one resource. Handle names the resource
// and RevisionID the revision of it, so two revisions of the same resource
// share a handle and cannot both appear in a release.
type ReleasePointer struct {
	Kind       ReleasePointerKind
	Handle     string
	RevisionID string
}

// ReleaseMetadata records who assembled a release and from what source. Set at
// construction and never mutated.
//
// CreatedBy and CreatedByType mirror the actor recording on events: a project
// secret carries no user identity, so both are nil for releases assembled from
// CI or the CLI.
type ReleaseMetadata struct {
	Message       *string
	GitSHA        *string
	GitDirty      bool
	CreatedBy     *string
	CreatedByType *EventActorType
}

// Release is an immutable, project-scoped snapshot pinning one revision of
// every resource it includes. It holds pointers and metadata, never content:
// the per-kind tables stay the source of truth for resource bytes.
type Release struct {
	ProjectID   string
	ID          string
	ContentHash string
	Pointers    []ReleasePointer
	Metadata    ReleaseMetadata
	CreatedAt   time.Time
}

// ReleaseField enumerates the fields of Release which can be used for
// filtering and ordering in list operations. Pointers and metadata live in
// columns no query filters on, so they are not bound.
type ReleaseField uint8

const (
	ReleaseFieldUnspecified ReleaseField = iota
	ReleaseFieldProjectID
	ReleaseFieldID
	ReleaseFieldContentHash
	ReleaseFieldCreatedAt
)

// NewRelease validates the pinned set, orders it canonically and derives its
// content hash. The ID is left empty for the dialect to mint, and CreatedAt is
// stamped by the insert.
func NewRelease(projectID string, pointers []ReleasePointer, metadata ReleaseMetadata) (*Release, error) {
	if len(pointers) == 0 {
		return nil, ErrReleaseInvalid("a release must pin at least one revision", nil)
	}

	// Reported against the caller's indices, so the message points at the
	// pointer they sent rather than at wherever it lands once ordered.
	for i, pointer := range pointers {
		if !pointer.Kind.IsAReleasePointerKind() {
			return nil, ErrReleaseInvalid(fmt.Sprintf("pointer %d has an unknown kind", i), nil)
		}
		if strings.TrimSpace(pointer.Handle) == "" {
			return nil, ErrReleaseInvalid(fmt.Sprintf("pointer %d has an empty handle", i), nil)
		}
		if strings.TrimSpace(pointer.RevisionID) == "" {
			return nil, ErrReleaseInvalid(fmt.Sprintf("pointer %d has an empty revision id", i), nil)
		}
	}

	// Sorts into a new slice: the caller's argument is not ours to reorder.
	sorted := slices.SortedFunc(slices.Values(pointers), compareReleasePointers)

	// Adjacent after sorting, so one pass finds every collision. A set with a
	// duplicated handle cannot be hashed: the two entries tie under the
	// comparator, so the same set could order either way.
	//
	// Cross-resource validation — that every revision exists, and that the
	// references between them resolve — needs database reads and arrives with
	// the service.
	for i := 1; i < len(sorted); i++ {
		if sorted[i].Kind == sorted[i-1].Kind && sorted[i].Handle == sorted[i-1].Handle {
			return nil, ErrReleaseInvalid(
				fmt.Sprintf("%s %q is pinned twice", sorted[i].Kind, sorted[i].Handle), nil)
		}
	}

	return &Release{
		ProjectID:   projectID,
		ContentHash: releaseContentHash(sorted),
		Pointers:    sorted,
		Metadata:    metadata,
	}, nil
}

// ReleaseContentHash derives the idempotency key of a pinned set. Metadata is
// excluded, so re-submitting the same revisions under a new message resolves
// to the release that already pins them.
//
// Exported because the bundle constructor derives the same key from content it
// has just allocated revisions for, and the two must agree.
func ReleaseContentHash(pointers []ReleasePointer) string {
	return releaseContentHash(slices.SortedFunc(slices.Values(pointers), compareReleasePointers))
}

func compareReleasePointers(a, b ReleasePointer) int {
	return cmp.Or(
		cmp.Compare(a.Kind.String(), b.Kind.String()),
		cmp.Compare(a.Handle, b.Handle),
	)
}

// releaseContentHashVersion prefixes the hash preimage so a future change to
// the canonical form cannot silently collide with hashes written under this
// one.
const releaseContentHashVersion = "rel-v1\x00"

// releaseContentHash hashes an already-sorted set.
//
// Each field is written as "<length>:<field>" rather than joined by a
// separator, because there is no byte a separator could use: a schema's
// revision id is frequently a URL, so "/", ":" and "&" all appear in the
// values. The length says how many bytes follow, which is unambiguous whatever
// those bytes are. JSON would work too, but then the hash would depend on how
// an encoder escapes, which no contract pins down.
func releaseContentHash(sorted []ReleasePointer) string {
	digest := sha256.New()
	// Writing to a hash never fails, so the errors are not worth threading.
	field := func(value string) { fmt.Fprintf(digest, "%d:%s", len(value), value) }

	fmt.Fprint(digest, releaseContentHashVersion)
	for _, pointer := range sorted {
		field(pointer.Kind.String())
		field(pointer.Handle)
		field(pointer.RevisionID)
	}
	return hex.EncodeToString(digest.Sum(nil))
}
