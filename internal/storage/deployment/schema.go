package deployment

import (
	"strings"

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
	return `(` + primaryRowServes(tables) + ` OR ` + previewRowServes(tables, placeholder) + `)`
}

func primaryRowServes(tables Tables) string {
	newerPrimary := `EXISTS (SELECT 1 FROM ` + tables.Deployments + ` np` +
		` WHERE np.project_id = t.project_id AND np.origin_kind = 'primary'` +
		` AND (np.deployed_at > t.deployed_at OR (np.deployed_at = t.deployed_at AND np.id > t.deployment_id)))`
	return `(t.origin_kind = 'primary' AND ` + isPrimaryOrigin(tables) + ` AND NOT ` + newerPrimary + `)`
}

func previewRowServes(tables Tables, placeholder string) string {
	previewLive := `EXISTS (SELECT 1 FROM ` + tables.Previews + ` p` +
		` WHERE p.project_id = t.project_id AND p.origin = t.origin AND p.expires_at > ` + placeholder + `)`
	return `(t.origin_kind = 'preview' AND NOT ` + NewerOriginRowExists(tables.Origins) +
		` AND NOT ` + isPrimaryOrigin(tables) + ` AND ` + previewLive + `)`
}

// isPrimaryOrigin holds while the origin of row t is a primary origin of the
// project.
func isPrimaryOrigin(tables Tables) string {
	return `EXISTS (SELECT 1 FROM ` + tables.ProjectOrigins + ` po` +
		` WHERE po.project_id = t.project_id AND po.pattern = t.origin AND po.kind = 'primary')`
}

// liveValue marks where the Live filter's value goes, so the predicate is
// written whole and cut around it.
const liveValue = "\x00"

// NewSchema binds deployment list/filter/order fields for one dialect's table
// names. Origin and Live are correlated predicates over the origin rows.
func NewSchema(tables Tables) database.Schema[domain.DeploymentField, domain.Deployment] {
	deploymentsTable := tables.Deployments
	ownOrigins := `SELECT 1 FROM ` + tables.Origins + ` t` +
		` WHERE t.project_id = ` + deploymentsTable + `.project_id AND t.deployment_id = ` + deploymentsTable + `.id`
	liveBefore, liveAfter, _ := strings.Cut(`EXISTS (`+ownOrigins+` AND `+RowServes(tables, liveValue)+`)`, liveValue)
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
			SQLName:   liveBefore,
			SQLSuffix: liveAfter,
			Computed:  true,
		},
	})
}
