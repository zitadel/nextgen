// Package deployment holds shared helpers for the deployments and
// deployment_targets tables used by v2 dialect statements: list options, the
// create-time guard, and the encoding of the metadata JSON column.
package deployment

import (
	"cmp"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// metadata is the structure stored inside the metadata column: why the
// release went live and who made it happen.
//
// deployed_at is deliberately absent. It orders the list and backs the keyset
// cursor, so it earns a column of its own; everything here is written once
// and handed back verbatim. Reason is persisted as its wire string rather
// than its numeric value, so inserting a reason ahead of an existing one in
// the enum cannot reinterpret rows already written.
type metadata struct {
	Reason         string  `json:"reason,omitempty"`
	Message        *string `json:"message,omitempty"`
	RollbackTo     *string `json:"rollback_to,omitempty"`
	DeployedBy     *string `json:"deployed_by,omitempty"`
	DeployedByType *string `json:"deployed_by_type,omitempty"`
}

// Row carries the scanned columns of one deployments row.
type Row struct {
	ProjectID  string
	ID         string
	ReleaseID  string
	TargetKind string
	Metadata   []byte
	DeployedAt time.Time
}

// TargetRow carries the scanned columns of one deployment_targets row.
type TargetRow struct {
	DeploymentID string
	Origin       string
	ReleaseID    string
	DeployedAt   time.Time
}

// MarshalMetadata converts the deployment metadata into JSON for the metadata
// column. Absent fields are omitted rather than written as null, so a plain
// unannotated deploy by a machine principal stores little more than the
// reason.
func MarshalMetadata(m domain.DeploymentMetadata) ([]byte, error) {
	encoded := metadata{
		Reason:     m.Reason.String(),
		Message:    m.Message,
		RollbackTo: m.RollbackTo,
		DeployedBy: m.DeployedBy,
	}
	if m.DeployedByType != nil {
		encoded.DeployedByType = new(string(*m.DeployedByType))
	}
	return json.Marshal(encoded)
}

// ToDomain converts a scanned row into a domain.Deployment without targets;
// AttachTargets fills them.
func ToDomain(row Row) (*domain.Deployment, error) {
	var encoded metadata
	if len(row.Metadata) > 0 {
		if err := json.Unmarshal(row.Metadata, &encoded); err != nil {
			return nil, err
		}
	}

	// An absent reason is the zero value: a plain deploy.
	reason := domain.DeploymentReasonDeploy
	if encoded.Reason != "" {
		parsed, err := domain.DeploymentReasonString(encoded.Reason)
		if err != nil {
			return nil, fmt.Errorf("deployment %q carries an unknown reason %q: %w", row.ID, encoded.Reason, err)
		}
		reason = parsed
	}

	kind, err := domain.DeploymentTargetKindString(row.TargetKind)
	if err != nil {
		return nil, fmt.Errorf("deployment %q carries an unknown target kind %q: %w", row.ID, row.TargetKind, err)
	}

	var actorType *domain.EventActorType
	if encoded.DeployedByType != nil {
		actorType = new(domain.EventActorType(*encoded.DeployedByType))
	}

	return &domain.Deployment{
		ProjectID:  row.ProjectID,
		ID:         row.ID,
		ReleaseID:  row.ReleaseID,
		TargetKind: kind,
		Metadata: domain.DeploymentMetadata{
			Reason:         reason,
			Message:        encoded.Message,
			RollbackTo:     encoded.RollbackTo,
			DeployedBy:     encoded.DeployedBy,
			DeployedByType: actorType,
		},
		// Spanner returns UTC while pgx defaults to local; normalize.
		DeployedAt: row.DeployedAt.UTC(),
	}, nil
}

// AttachTargets sets each deployment's targets from rows, sorted by origin.
// A deployment with no row in rows gets an empty set.
func AttachTargets(items []*domain.Deployment, rows []TargetRow) {
	byID := make(map[string][]domain.DeploymentTarget, len(items))
	for _, row := range rows {
		byID[row.DeploymentID] = append(byID[row.DeploymentID], domain.DeploymentTarget{Origin: row.Origin})
	}
	for _, item := range items {
		targets := byID[item.ID]
		slices.SortFunc(targets, func(a, b domain.DeploymentTarget) int { return cmp.Compare(a.Origin, b.Origin) })
		item.Targets = targets
	}
}

// DeploymentIDs returns the ids of items, in order.
func DeploymentIDs(items []*domain.Deployment) []string {
	ids := make([]string, len(items))
	for i, item := range items {
		ids[i] = item.ID
	}
	return ids
}
