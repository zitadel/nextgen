// Package deployment holds shared helpers for the deployments and
// deployment_targets tables used by v2 dialect statements: the schema, list
// options and the encoding of the metadata JSON column.
package deployment

import (
	"encoding/json"
	"fmt"
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
	RollbackOf     *string `json:"rollback_of,omitempty"`
	DeployedBy     *string `json:"deployed_by,omitempty"`
	DeployedByType *string `json:"deployed_by_type,omitempty"`
}

// Row carries the scanned columns of one deployments row: the operation
// without its targets, which the dialect attaches afterwards.
type Row struct {
	ProjectID  string
	ID         string
	ReleaseID  string
	Metadata   []byte
	DeployedAt time.Time
}

// MarshalMetadata converts the deployment metadata into JSON for the metadata
// column. Absent fields are omitted rather than written as null, so a plain
// unannotated deploy by a machine principal stores little more than the
// reason.
func MarshalMetadata(m domain.DeploymentMetadata) ([]byte, error) {
	encoded := metadata{
		Reason:     m.Reason.String(),
		Message:    m.Message,
		RollbackOf: m.RollbackOf,
		DeployedBy: m.DeployedBy,
	}
	if m.DeployedByType != nil {
		encoded.DeployedByType = new(string(*m.DeployedByType))
	}
	return json.Marshal(encoded)
}

// ToDomain converts a scanned row into a domain.Deployment.
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

	var actorType *domain.EventActorType
	if encoded.DeployedByType != nil {
		actorType = new(domain.EventActorType(*encoded.DeployedByType))
	}

	return &domain.Deployment{
		ProjectID: row.ProjectID,
		ID:        row.ID,
		ReleaseID: row.ReleaseID,
		Metadata: domain.DeploymentMetadata{
			Reason:         reason,
			Message:        encoded.Message,
			RollbackOf:     encoded.RollbackOf,
			DeployedBy:     encoded.DeployedBy,
			DeployedByType: actorType,
		},
		// Spanner returns UTC while pgx defaults to local; normalize.
		DeployedAt: row.DeployedAt.UTC(),
	}, nil
}

// AttachTargets sets each deployment's targets from the (deployment id,
// origin) pairs a dialect scanned, keeping the pairs' order per deployment.
// A deployment no pair names keeps an empty, non-nil list.
func AttachTargets(items []*domain.Deployment, pairs []TargetRow) {
	byID := make(map[string][]domain.DeploymentTarget, len(items))
	for _, pair := range pairs {
		byID[pair.DeploymentID] = append(byID[pair.DeploymentID], domain.DeploymentTarget{Origin: pair.Origin})
	}
	for _, item := range items {
		item.Targets = byID[item.ID]
		if item.Targets == nil {
			item.Targets = []domain.DeploymentTarget{}
		}
	}
}

// TargetRow is one scanned deployment_targets row.
type TargetRow struct {
	DeploymentID string
	Origin       string
}
