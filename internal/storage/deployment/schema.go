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

// RowServes reports whether a deployment is live on one of its origins at the
// given time. The newest primary deployment is always live; a preview URL runs
// its latest deployment until the preview expires.
func RowServes(tables Tables, placeholder string) string {
	return `(` + primaryRowServes(tables) + ` OR ` + previewRowServes(tables, placeholder) + `)`
}

func primaryRowServes(tables Tables) string {
	newerPrimary := `EXISTS (SELECT 1 FROM ` + tables.Deployments + ` np` +
		` WHERE np.project_id = t.project_id AND np.origin_kind = 'primary'` +
		` AND (np.deployed_at > t.deployed_at OR (np.deployed_at = t.deployed_at AND np.id > t.deployment_id)))`
	// The newest primary deployment always serves callers with no origin, so it
	// stays live on every origin it names, whatever the project lists now.
	return `(t.origin_kind = 'primary' AND NOT ` + newerPrimary + `)`
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

// valueMarker holds the place of a filter value. A correlated filter needs the
// SQL around its values, so each predicate is written whole with this marker
// and cut at it. Any text works that never shows up in SQL; a NUL never does.
const valueMarker = "\x00"

// correlated binds predicate, with a valueMarker for each value its filter
// takes.
func correlated(predicate string) database.FieldBinding[domain.Deployment] {
	parts := strings.Split(predicate, valueMarker)
	return database.FieldBinding[domain.Deployment]{
		SQLName:    parts[0],
		SQLBetween: parts[1 : len(parts)-1],
		SQLSuffix:  parts[len(parts)-1],
		Computed:   true,
	}
}

// NewSchema binds deployment list/filter/order fields for one dialect's table
// names. Origin, Live and ServesOrigin are correlated predicates over the
// origin rows.
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
		domain.DeploymentFieldOrigin: correlated(`EXISTS (` + ownOrigins + ` AND t.origin = ` + valueMarker + `)`),
		domain.DeploymentFieldLive:   correlated(`EXISTS (` + ownOrigins + ` AND ` + RowServes(tables, valueMarker) + `)`),
		domain.DeploymentFieldServesOrigin: correlated(`EXISTS (` + ownOrigins +
			` AND t.origin = ` + valueMarker + ` AND ` + RowServes(tables, valueMarker) + `)`),
	})
}
