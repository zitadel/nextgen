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

// Tables names one dialect's tables the deployment predicates read.
type Tables struct {
	Deployments    string
	Origins        string
	Previews       string
	ProjectOrigins string
}

// RowServes holds while row t serves its origin at the time bound to
// placeholder. A primary row serves while its deployment is the project's
// newest primary deployment and its origin is still a primary origin; a
// preview row while it is the newest row to its URL, the URL is not a primary
// origin, and its preview is live.
func RowServes(tables Tables, placeholder string) string {
	return rowServesOpen(tables) + placeholder + `)))`
}

func rowServesOpen(tables Tables) string {
	primaryOrigin := `EXISTS (SELECT 1 FROM ` + tables.ProjectOrigins + ` po` +
		` WHERE po.project_id = t.project_id AND po.pattern = t.origin AND po.kind = 'primary')`
	newerPrimary := `EXISTS (SELECT 1 FROM ` + tables.Deployments + ` np` +
		` WHERE np.project_id = t.project_id AND np.origin_kind = 'primary'` +
		` AND (np.deployed_at > t.deployed_at OR (np.deployed_at = t.deployed_at AND np.id > t.deployment_id)))`
	return `((t.origin_kind = 'primary' AND ` + primaryOrigin + ` AND NOT ` + newerPrimary + `)` +
		` OR (t.origin_kind = 'preview' AND NOT ` + NewerOriginRowExists(tables.Origins) + ` AND NOT ` + primaryOrigin +
		` AND EXISTS (SELECT 1 FROM ` + tables.Previews + ` p` +
		` WHERE p.project_id = t.project_id AND p.origin = t.origin AND p.expires_at > `
}

// NewSchema binds deployment list/filter/order fields for one dialect's table
// names. Origin and Live are correlated predicates over the origin rows.
func NewSchema(tables Tables) database.Schema[domain.DeploymentField, domain.Deployment] {
	deploymentsTable := tables.Deployments
	ownOrigins := `SELECT 1 FROM ` + tables.Origins + ` t` +
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
		domain.DeploymentFieldOriginKind: {
			SQLName:  "origin_kind",
			Accessor: func(d *domain.Deployment) any { return d.OriginKind.String() },
			Coerce:   database.CoerceString,
		},
		domain.DeploymentFieldOrigin: {
			SQLName:   `EXISTS (` + ownOrigins + ` AND t.origin = `,
			SQLSuffix: ")",
			Computed:  true,
		},
		domain.DeploymentFieldLive: {
			SQLName:   `EXISTS (` + ownOrigins + ` AND ` + rowServesOpen(tables),
			SQLSuffix: "))))",
			Computed:  true,
		},
	})
}
