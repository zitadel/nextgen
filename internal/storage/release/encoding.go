// Package release holds shared encoding helpers for the two JSON columns of
// the releases table — the pinned pointer set and the metadata — used by v2
// dialect statements.
package release

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// pointer is one entry of the structure stored inside the pointers column.
// Kind is persisted as its wire string rather than its numeric value, so
// inserting a kind ahead of an existing one in the enum cannot reinterpret
// rows already written.
type pointer struct {
	Kind       string `json:"kind"`
	Handle     string `json:"handle"`
	RevisionID string `json:"revision_id"`
}

// metadata is the structure stored inside the metadata column: who assembled
// the release, from what commit, and why.
//
// created_at is deliberately absent. It orders the list and backs the keyset
// cursor, so it earns a column of its own; everything here is written once and
// handed back verbatim.
type metadata struct {
	Message       *string `json:"message,omitempty"`
	GitSHA        *string `json:"git_sha,omitempty"`
	GitDirty      bool    `json:"git_dirty,omitzero"`
	CreatedBy     *string `json:"created_by,omitempty"`
	CreatedByType *string `json:"created_by_type,omitempty"`
}

// Row carries the scanned columns of one releases row.
type Row struct {
	ProjectID   string
	ID          string
	ContentHash string
	Pointers    []byte
	Metadata    []byte
	CreatedAt   time.Time
}

// MarshalPointers converts the pinned set into JSON for the pointers column.
// The order is the canonical one domain.NewRelease established, so a release
// read back yields the order it was hashed in.
func MarshalPointers(pointers []domain.ReleasePointer) ([]byte, error) {
	encoded := make([]pointer, len(pointers))
	for i, p := range pointers {
		encoded[i] = pointer{
			Kind:       p.Kind.String(),
			Handle:     p.Handle,
			RevisionID: p.RevisionID,
		}
	}
	return json.Marshal(encoded)
}

// MarshalMetadata converts the release metadata into JSON for the metadata
// column. Absent fields are omitted rather than written as null, so a release
// assembled by a machine principal stores {} rather than a row of nulls.
func MarshalMetadata(m domain.ReleaseMetadata) ([]byte, error) {
	encoded := metadata{
		Message:   m.Message,
		GitSHA:    m.GitSHA,
		GitDirty:  m.GitDirty,
		CreatedBy: m.CreatedBy,
	}
	if m.CreatedByType != nil {
		encoded.CreatedByType = new(string(*m.CreatedByType))
	}
	return json.Marshal(encoded)
}

// ToDomain converts a scanned row into a domain.Release.
func ToDomain(row Row) (*domain.Release, error) {
	var encodedPointers []pointer
	if len(row.Pointers) > 0 {
		if err := json.Unmarshal(row.Pointers, &encodedPointers); err != nil {
			return nil, err
		}
	}

	pointers := make([]domain.ReleasePointer, len(encodedPointers))
	for i, p := range encodedPointers {
		kind, err := domain.ReleasePointerKindString(p.Kind)
		if err != nil {
			return nil, fmt.Errorf("release %q pins an unknown kind %q: %w", row.ID, p.Kind, err)
		}
		pointers[i] = domain.ReleasePointer{
			Kind:       kind,
			Handle:     p.Handle,
			RevisionID: p.RevisionID,
		}
	}

	var encodedMetadata metadata
	if len(row.Metadata) > 0 {
		if err := json.Unmarshal(row.Metadata, &encodedMetadata); err != nil {
			return nil, err
		}
	}

	var actorType *domain.EventActorType
	if encodedMetadata.CreatedByType != nil {
		actorType = new(domain.EventActorType(*encodedMetadata.CreatedByType))
	}

	return &domain.Release{
		ProjectID:   row.ProjectID,
		ID:          row.ID,
		ContentHash: row.ContentHash,
		Pointers:    pointers,
		Metadata: domain.ReleaseMetadata{
			Message:       encodedMetadata.Message,
			GitSHA:        encodedMetadata.GitSHA,
			GitDirty:      encodedMetadata.GitDirty,
			CreatedBy:     encodedMetadata.CreatedBy,
			CreatedByType: actorType,
		},
		// Spanner returns UTC while pgx defaults to local; normalize.
		CreatedAt: row.CreatedAt.UTC(),
	}, nil
}
