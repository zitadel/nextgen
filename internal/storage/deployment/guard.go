package deployment

import (
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// Newest returns the newest of rows under deployed_at, then deployment_id,
// or nil for none. Given the newest row of each target, it is the newest
// deployment to any of them: the one the create guard compares against.
func Newest(rows []TargetRow) *TargetRow {
	var newest *TargetRow
	for i := range rows {
		row := &rows[i]
		if newest == nil || row.DeployedAt.After(newest.DeployedAt) ||
			(row.DeployedAt.Equal(newest.DeployedAt) && row.DeploymentID > newest.DeploymentID) {
			newest = row
		}
	}
	return newest
}

// Unchanged reports whether writing entity would change nothing, so nothing is
// written: its targets are primary origins and each one's newest row, among
// newest, already serves its release. A deployment to preview URLs is never
// unchanged, because writing it renews their previews.
func Unchanged(entity *domain.Deployment, newest []TargetRow) bool {
	return entity.TargetKind == domain.DeploymentTargetKindPrimary &&
		AllServe(newest, entity.Origins(), entity.ReleaseID)
}

// AllServe reports whether every origin's newest row, among newest, already
// serves releaseID.
func AllServe(newest []TargetRow, origins []string, releaseID string) bool {
	serving := make(map[string]string, len(newest))
	for _, row := range newest {
		serving[row.Origin] = row.ReleaseID
	}
	for _, origin := range origins {
		if release, ok := serving[origin]; !ok || release != releaseID {
			return false
		}
	}
	return true
}

// CheckExpected enforces the optimistic-concurrency guard on create. current
// is the newest deployment to any of the targets, nil when nothing was ever
// deployed there; on a mismatch the conflict error carries it, read by the
// dialect because only its transaction sees the locked state.
func CheckExpected(current *domain.Deployment, expected *string) error {
	if expected == nil || (current != nil && current.ID == *expected) {
		return nil
	}
	return domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{Deployment: current})
}

// StampFloor is the earliest deployed_at a new deployment superseding newest
// may take: one microsecond after it, the finest precision every dialect
// keeps. Stamping at least this keeps the newer deployment newer under a clock
// that stepped back, or a second server whose clock lags. Nil when nothing was
// deployed to the targets.
func StampFloor(newest *TargetRow) *time.Time {
	if newest == nil {
		return nil
	}
	return new(newest.DeployedAt.Add(time.Microsecond))
}

// Stamp is the later of now and floor, truncated to the microsecond so it
// reads back unchanged from every dialect.
func Stamp(now time.Time, floor *time.Time) time.Time {
	now = now.UTC().Truncate(time.Microsecond)
	if floor != nil && floor.After(now) {
		return floor.UTC()
	}
	return now
}

// InUseDetails names the origins in serving, each still serving a release,
// for domain.ErrReleaseInUse.
func InUseDetails(serving []TargetRow) domain.ReleaseInUseDetails {
	origins := make([]domain.ReleaseServedOrigin, len(serving))
	for i, row := range serving {
		origins[i] = domain.ReleaseServedOrigin{Origin: row.Origin, DeploymentID: row.DeploymentID}
	}
	return domain.ReleaseInUseDetails{Origins: origins}
}
