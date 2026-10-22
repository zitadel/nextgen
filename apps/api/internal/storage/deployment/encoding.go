// Package deployment holds shared helpers for the deployments and
// deployment_origins tables used by v2 dialect statements.
package deployment

import (
	"cmp"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// metadata is the structure stored inside the metadata column. Reason is
// stored as its wire string so reordering the enum cannot reinterpret rows.
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
	OriginKind string
	Metadata   []byte
	DeployedAt time.Time
}

// MarshalMetadata converts the deployment metadata into JSON for the metadata
// column, omitting absent fields.
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

// ToDomain converts a scanned row into a domain.Deployment without origins;
// AttachTargets fills them.
func ToDomain(row Row) (*domain.Deployment, error) {
	var encoded metadata
	if len(row.Metadata) > 0 {
		if err := json.Unmarshal(row.Metadata, &encoded); err != nil {
			return nil, err
		}
	}

	reason := domain.DeploymentReasonDeploy
	if encoded.Reason != "" {
		parsed, err := domain.DeploymentReasonString(encoded.Reason)
		if err != nil {
			return nil, fmt.Errorf("deployment %q carries an unknown reason %q: %w", row.ID, encoded.Reason, err)
		}
		reason = parsed
	}

	kind, err := domain.DeploymentOriginKindString(row.OriginKind)
	if err != nil {
		return nil, fmt.Errorf("deployment %q carries an unknown origin kind %q: %w", row.ID, row.OriginKind, err)
	}

	var actorType *domain.EventActorType
	if encoded.DeployedByType != nil {
		actorType = new(domain.EventActorType(*encoded.DeployedByType))
	}

	return &domain.Deployment{
		ProjectID:  row.ProjectID,
		ID:         row.ID,
		ReleaseID:  row.ReleaseID,
		OriginKind: kind,
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
func AttachTargets(items []*domain.Deployment, rows []domain.OriginDeployment) {
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

// WithKind sets the origin kind of a scanned origin row.
func WithKind(target domain.OriginDeployment, kind string) (domain.OriginDeployment, error) {
	parsed, err := domain.DeploymentOriginKindString(kind)
	if err != nil {
		return target, fmt.Errorf("deployment %q carries an unknown origin kind %q: %w", target.DeploymentID, kind, err)
	}
	target.Kind = parsed
	return target, nil
}

// DeploymentIDs returns the ids of items, in order.
func DeploymentIDs(items []*domain.Deployment) []string {
	ids := make([]string, len(items))
	for i, item := range items {
		ids[i] = item.ID
	}
	return ids
}

// Stamp truncates now to the microsecond every dialect keeps.
func Stamp(now time.Time) time.Time {
	return now.UTC().Truncate(time.Microsecond)
}

// NextSeqs returns the seq each origin's new row takes: one past the
// newest read, or 1 for an origin with nothing deployed. Inserting it is the
// optimistic lock: a concurrent deploy that read the same rows takes the same
// seq, and the unique index rejects whichever commits second.
func NextSeqs(origins []string, read []domain.OriginDeployment) []int64 {
	newest := make(map[string]int64, len(read))
	for _, r := range read {
		newest[r.Origin] = r.Seq
	}
	seqs := make([]int64, len(origins))
	for i, origin := range origins {
		seqs[i] = newest[origin] + 1
	}
	return seqs
}
