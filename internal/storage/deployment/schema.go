package deployment

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// OriginsSelect selects deployment_origins rows aliased t, in the column order
// the dialects scan.
func OriginsSelect(originsTable string) string {
	return `SELECT t.origin, t.deployment_id, t.release_id, t.origin_kind, t.deployed_at, t.seq FROM ` + originsTable + ` t`
}

// NewerOriginRowExists holds when the origin of row t has a row with a higher
// seq. Its negation picks what each origin serves.
func NewerOriginRowExists(originsTable string) string {
	return `EXISTS (SELECT 1 FROM ` + originsTable + ` newer` +
		` WHERE newer.project_id = t.project_id AND newer.origin = t.origin AND newer.seq > t.seq)`
}

// OriginServes holds while row t admits its origin at the time bound to
// placeholder: always for a primary origin, until expiry for a preview URL.
func OriginServes(previewsTable, placeholder string) string {
	return originServesOpen(previewsTable) + placeholder + `))`
}

func originServesOpen(previewsTable string) string {
	return `(t.origin_kind = 'primary' OR EXISTS (SELECT 1 FROM ` + previewsTable + ` p` +
		` WHERE p.project_id = t.project_id AND p.origin = t.origin AND p.expires_at > `
}

// NewSchema binds deployment list/filter/order fields for one dialect's table
// names. Origin and Live are correlated predicates over the origin rows.
func NewSchema(deploymentsTable, originsTable, previewsTable string) database.Schema[domain.DeploymentField, domain.Deployment] {
	ownOrigins := `SELECT 1 FROM ` + originsTable + ` t` +
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
			SQLName:   `EXISTS (` + ownOrigins + ` AND t.origin = `,
			SQLSuffix: ")",
			Computed:  true,
		},
		domain.DeploymentFieldLive: {
			SQLName:   `EXISTS (` + ownOrigins + ` AND NOT ` + NewerOriginRowExists(originsTable) + ` AND ` + originServesOpen(previewsTable),
			SQLSuffix: ")))",
			Computed:  true,
		},
	})
}
