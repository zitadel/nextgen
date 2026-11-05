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
	ReleasePointerKindIDP
	ReleasePointerKindPolicy
)

// ReleaseBrandingHandle is the handle every branding pointer carries. Branding
// is the one kind with no identifying field of its own — a project has exactly
// one — so the handle is a constant, and pinning two branding revisions in one
// release collides on it, which is the intended answer.
const ReleaseBrandingHandle = "default"

func ErrReleaseInvalid(details any, parent error) Error {
	return newError(PrefixRelease.ErrorCodePrefix("invalid"), "release: invalid", details, parent)
}

func ErrReleaseNotFound() Error {
	return newError(PrefixRelease.ErrorCodePrefix("not_found"), "release: not found", nil, nil)
}

func ErrReleaseProjectNotFound() Error {
	return newError(PrefixRelease.ErrorCodePrefix("project_not_found"), "release: project not found", nil, nil)
}

func ErrReleasePermissionDenied() Error {
	return newError(PrefixRelease.ErrorCodePrefix("permission_denied"), "release: requires an operator-grade token bound to the project (project.write or a release.* scope)", nil, nil)
}

// ErrReleaseRevisionNotFound reports a pinned revision that the project does
// not hold. The detail names the pointer, since a release pins many and the
// caller cannot tell which one failed from the code alone.
func ErrReleaseRevisionNotFound(details any) Error {
	return newError(PrefixRelease.ErrorCodePrefix("revision_not_found"), "release: pinned revision does not exist", details, nil)
}

// ErrReleaseRevisionUnpinnable reports a revision that exists but declares no
// handle, so nothing says which resource it is a revision of. A schema
// registered by URL whose document was never parsed has no objectType and is
// unpinnable until it is.
func ErrReleaseRevisionUnpinnable(details any) Error {
	return newError(PrefixRelease.ErrorCodePrefix("revision_unpinnable"), "release: pinned revision declares no handle", details, nil)
}

// ReleaseInUseOrigin is one origin whose newest deployment pins the release.
type ReleaseInUseOrigin struct {
	Origin       string `json:"origin"`
	DeploymentID string `json:"deployment_id"`
}

// ReleaseInUseDetails names every origin that still serves the release.
type ReleaseInUseDetails struct {
	Origins []ReleaseInUseOrigin `json:"origins"`
}

// ErrReleaseInUse refuses to revoke a release an origin still serves; the
// details name each such origin and the deployment that pins it.
func ErrReleaseInUse(details ReleaseInUseDetails) Error {
	return newError(PrefixRelease.ErrorCodePrefix("in_use"), "release: still served by an origin", details, nil)
}

// ErrReleaseUnresolvedReference reports a handle a revision names that the
// release does not include.
func ErrReleaseUnresolvedReference() Error {
	return newError(PrefixRelease.ErrorCodePrefix("unresolved_reference"), "release: handle is not in the release", nil, nil)
}

// ErrReleaseRevoked reports a release that was revoked and can no longer be
// served or deployed. The message is what the login surface shows when an
// in-flight attempt discovers the revocation.
func ErrReleaseRevoked() Error {
	return newError(PrefixRelease.ErrorCodePrefix("revoked"), "the release this attempt runs on was revoked", nil, nil)
}

// ErrReleaseNotDeployed reports that nothing is deployed to the target the
// request resolved to. Callers that name the origin in the message use
// WithMessage so the login surface can show it.
func ErrReleaseNotDeployed(details any) Error {
	return newError(PrefixRelease.ErrorCodePrefix("not_deployed"), "nothing is deployed to this origin", details, nil)
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
// CreatedBy and CreatedByType mirror the actor recording on events. A project
// secret names no user, so CreatedBy is nil for releases assembled from CI or
// the CLI while CreatedByType still reports a service principal.
type ReleaseMetadata struct {
	Message       *string
	GitSHA        *string
	GitDirty      bool
	CreatedBy     *string
	CreatedByType *EventActorType
}

// Release is an immutable, project-scoped snapshot pinning one revision of
// every resource it includes. It holds pointers and metadata, never content:
// the per-kind tables stay the source of truth for resource bytes. Only
// RevokedAt changes, once, on the first revoke.
type Release struct {
	ProjectID   string
	ID          string
	ContentHash string
	Pointers    []ReleasePointer
	Metadata    ReleaseMetadata
	CreatedAt   time.Time
	RevokedAt   *time.Time
}

// Revoked reports whether the release can no longer be served or deployed.
func (r *Release) Revoked() bool {
	return r != nil && r.RevokedAt != nil
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

// ReleaseContent is the revisions a release references, loaded. A release
// keeps only their pointers; [ValidateRelease] reads the content.
type ReleaseContent struct {
	Schemas         []*JSONSchema
	FlowDefinitions []*FlowDefinition
	IDPConnections  []*IDPConnection
	Policies        []*Policy
	Branding        *Branding
}

// Pointers returns one pointer per revision, under the handle it declares,
// in canonical order. It refuses a revision without a handle or id, and two
// revisions of the same resource. Build uses this for auto-pin bookkeeping
// and the pointer cap before [NewRelease] / [ValidateRelease].
func (c ReleaseContent) Pointers() ([]ReleasePointer, error) {
	return c.pointers()
}

// pointers returns one pointer per revision, under the handle it declares,
// in canonical order. It refuses a revision without a handle or id, and two
// revisions of the same resource.
func (c ReleaseContent) pointers() ([]ReleasePointer, error) {
	var pointers []ReleasePointer
	for _, schema := range c.Schemas {
		// A schema registered by URL whose document was never parsed declares
		// no objectType, so nothing says which resource it is a revision of.
		if schema.ObjectType == nil || *schema.ObjectType == "" {
			return nil, ErrReleaseRevisionUnpinnable(fmt.Sprintf("schema %q declares no objectType", schema.URL))
		}
		pointers = append(pointers, ReleasePointer{Kind: ReleasePointerKindSchema, Handle: *schema.ObjectType, RevisionID: schema.URL})
	}
	for _, flow := range c.FlowDefinitions {
		pointers = append(pointers, ReleasePointer{Kind: ReleasePointerKindFlowDefinition, Handle: flow.Name, RevisionID: flow.ID})
	}
	for _, idp := range c.IDPConnections {
		pointers = append(pointers, ReleasePointer{Kind: ReleasePointerKindIDP, Handle: idp.Slug, RevisionID: idp.RevisionID})
	}
	for _, policy := range c.Policies {
		pointers = append(pointers, ReleasePointer{Kind: ReleasePointerKindPolicy, Handle: policy.Operation, RevisionID: policy.RevisionID})
	}
	if c.Branding != nil {
		pointers = append(pointers, ReleasePointer{Kind: ReleasePointerKindBranding, Handle: ReleaseBrandingHandle, RevisionID: c.Branding.ID})
	}

	for _, pointer := range pointers {
		if strings.TrimSpace(pointer.Handle) == "" || strings.TrimSpace(pointer.RevisionID) == "" {
			return nil, ErrReleaseInvalid(fmt.Sprintf("%s %q has an empty handle or revision id", pointer.Kind, pointer.RevisionID), nil)
		}
	}

	sorted := slices.SortedFunc(slices.Values(pointers), compareReleasePointers)
	// Adjacent after sorting, so one pass finds every collision.
	for i := 1; i < len(sorted); i++ {
		if sorted[i].Kind == sorted[i-1].Kind && sorted[i].Handle == sorted[i-1].Handle {
			return nil, ErrReleaseInvalid(fmt.Sprintf("%s %q is referenced twice", sorted[i].Kind, sorted[i].Handle), nil)
		}
	}
	return sorted, nil
}

// NewRelease derives a release's pointers from its content and their content
// hash. The ID is left empty for the dialect to mint, and CreatedAt is stamped
// by the insert.
func NewRelease(projectID string, content ReleaseContent, metadata ReleaseMetadata) (*Release, error) {
	pointers, err := content.pointers()
	if err != nil {
		return nil, err
	}
	if len(pointers) == 0 {
		return nil, ErrReleaseInvalid("a release must reference at least one revision", nil)
	}
	return &Release{
		ProjectID:   projectID,
		ContentHash: releaseContentHash(pointers),
		Pointers:    pointers,
		Metadata:    metadata,
	}, nil
}

// ReleaseContentHash derives the idempotency key of a pinned set. Metadata is
// excluded, so re-submitting the same revisions under a new message resolves
// to the release that already pins them.
//
// Exported so a caller holding a set of pointers can derive the key without a
// Release: the storage round-trip tests check that what came back out of a
// dialect still hashes to what went in.
func ReleaseContentHash(pointers []ReleasePointer) string {
	return releaseContentHash(slices.SortedFunc(slices.Values(pointers), compareReleasePointers))
}

// compareReleasePointers orders a set canonically. RevisionID is the last key
// only to make the order total: NewRelease rejects a set that ties on kind and
// handle, so it never decides anything there, but ReleaseContentHash sorts
// without that check and would otherwise hash such a set differently run to
// run, since the sort is not stable.
func compareReleasePointers(a, b ReleasePointer) int {
	return cmp.Or(
		cmp.Compare(a.Kind.String(), b.Kind.String()),
		cmp.Compare(a.Handle, b.Handle),
		cmp.Compare(a.RevisionID, b.RevisionID),
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
