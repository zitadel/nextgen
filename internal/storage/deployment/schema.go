package deployment

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// NewerTargetExists holds when another row of the same origin is newer than
// the deployment_targets row aliased t, under the order deployed_at, then
// deployment_id. Its negation picks the newest row per origin: what the origin
// serves.
func NewerTargetExists(targetsTable string) string {
	return `EXISTS (SELECT 1 FROM ` + targetsTable + ` newer` +
		` WHERE newer.project_id = t.project_id AND newer.origin = t.origin` +
		` AND (newer.deployed_at > t.deployed_at` +
		` OR (newer.deployed_at = t.deployed_at AND newer.deployment_id > t.deployment_id)))`
}

// TargetServesAt holds when the deployment_targets row aliased t, of the
// deployment aliased d, still admits its origin: always for a primary origin,
// and for a preview URL while its preview has not expired at the bound time.
// It ends on the open comparison, for the caller to bind the time and close.
func TargetServesAt(previewsTable string) string {
	return `(d.target_kind = 'primary' OR EXISTS (SELECT 1 FROM ` + previewsTable + ` p` +
		` WHERE p.project_id = t.project_id AND p.origin = t.origin AND p.expires_at > `
}

// NewSchema binds deployment list/filter/order fields for one dialect, whose
// table names the correlated fields reach into. The metadata document and the
// actor pair are read straight off the row and never filtered on, so they are
// not bound.
//
// Origin and Live are not columns of the operation but correlated predicates
// over its target rows. They filter, never order.
func NewSchema(deploymentsTable, targetsTable, previewsTable string) database.Schema[domain.DeploymentField, domain.Deployment] {
	ownTargets := `SELECT 1 FROM ` + targetsTable + ` t` +
		` WHERE t.project_id = ` + deploymentsTable + `.project_id AND t.deployment_id = ` + deploymentsTable + `.id`
	return database.NewSchema(map[domain.DeploymentField]database.FieldBinding[domain.Deployment]{
		domain.DeploymentFieldProjectID: {
			SQLName:  "project_id",
			Accessor: func(d *domain.Deployment) any { return d.ProjectID },
			Coerce:   database.CoerceString,
		},
		domain.DeploymentFieldID: {
			SQLName:  "id",
			Accessor: func(d *domain.Deployment) any { return d.ID },
			Coerce:   database.CoerceString,
		},
		domain.DeploymentFieldReleaseID: {
			SQLName:  "release_id",
			Accessor: func(d *domain.Deployment) any { return d.ReleaseID },
			Coerce:   database.CoerceString,
		},
		domain.DeploymentFieldDeployedAt: {
			SQLName:  "deployed_at",
			Accessor: func(d *domain.Deployment) any { return d.DeployedAt },
			Coerce:   database.CoerceTime,
		},
		// The deployments that named the bound origin.
		domain.DeploymentFieldOrigin: {
			SQLName:   `EXISTS (` + ownTargets + ` AND t.origin = `,
			SQLSuffix: ")",
			Computed:  true,
		},
		// The deployments some target still serves at the bound time: a
		// target row that is its origin's newest and whose origin is still
		// admitted.
		domain.DeploymentFieldLive: {
			SQLName: `EXISTS (` + ownTargets +
				` AND NOT ` + NewerTargetExists(targetsTable) +
				` AND ` + liveKindAt(deploymentsTable, previewsTable),
			SQLSuffix: ")))",
			Computed:  true,
		},
	})
}

// liveKindAt is TargetServesAt with the deployment read from the outer row
// rather than the alias d.
func liveKindAt(deploymentsTable, previewsTable string) string {
	return `(` + deploymentsTable + `.target_kind = 'primary' OR EXISTS (SELECT 1 FROM ` + previewsTable + ` p` +
		` WHERE p.project_id = t.project_id AND p.origin = t.origin AND p.expires_at > `
}
