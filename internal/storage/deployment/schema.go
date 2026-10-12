package deployment

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// NewerTargetExists holds when the origin of the deployment_targets row
// aliased t has a row with a higher seq. Its negation picks what each origin
// serves.
func NewerTargetExists(targetsTable string) string {
	return `EXISTS (SELECT 1 FROM ` + targetsTable + ` newer` +
		` WHERE newer.project_id = t.project_id AND newer.origin = t.origin AND newer.seq > t.seq)`
}

// TargetServesAt holds while the target row t of deployment d admits its
// origin: always for a primary origin, until expiry for a preview URL. The
// caller binds the time and closes with "))".
func TargetServesAt(deploymentAlias, previewsTable string) string {
	return `(` + deploymentAlias + `.target_kind = 'primary' OR EXISTS (SELECT 1 FROM ` + previewsTable + ` p` +
		` WHERE p.project_id = t.project_id AND p.origin = t.origin AND p.expires_at > `
}

// NewSchema binds deployment list/filter/order fields for one dialect's table
// names. Origin and Live are correlated predicates over the target rows.
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
		domain.DeploymentFieldOrigin: {
			SQLName:   `EXISTS (` + ownTargets + ` AND t.origin = `,
			SQLSuffix: ")",
			Computed:  true,
		},
		domain.DeploymentFieldLive: {
			SQLName: `EXISTS (` + ownTargets +
				` AND NOT ` + NewerTargetExists(targetsTable) +
				` AND ` + TargetServesAt(deploymentsTable, previewsTable),
			SQLSuffix: ")))",
			Computed:  true,
		},
	})
}
