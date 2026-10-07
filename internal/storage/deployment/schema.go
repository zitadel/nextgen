package deployment

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// NewSchema binds deployment list/filter/order fields for one dialect. The
// operation's columns are referenced through the table name, so the same
// bindings read from a bare `FROM deployments` and from a join. The
// metadata document is read straight off the row and never filtered on, so
// it is not bound.
//
// Origin is not a column of the operation: it matches the operations that
// wrote a target row for the origin, as a correlated predicate over the
// targets table the dialect names. It filters, never orders.
func NewSchema(targetsTable string) database.Schema[domain.DeploymentField, domain.Deployment] {
	return database.NewSchema(map[domain.DeploymentField]database.FieldBinding[domain.Deployment]{
		domain.DeploymentFieldProjectID: {
			SQLName:  "deployments.project_id",
			Accessor: func(d *domain.Deployment) any { return d.ProjectID },
			Coerce:   database.CoerceString,
		},
		domain.DeploymentFieldID: {
			SQLName:  "deployments.id",
			Accessor: func(d *domain.Deployment) any { return d.ID },
			Coerce:   database.CoerceString,
		},
		domain.DeploymentFieldReleaseID: {
			SQLName:  "deployments.release_id",
			Accessor: func(d *domain.Deployment) any { return d.ReleaseID },
			Coerce:   database.CoerceString,
		},
		domain.DeploymentFieldDeployedAt: {
			SQLName:  "deployments.deployed_at",
			Accessor: func(d *domain.Deployment) any { return d.DeployedAt },
			Coerce:   database.CoerceTime,
		},
		domain.DeploymentFieldOrigin: {
			SQLName: `EXISTS (SELECT 1 FROM ` + targetsTable + ` t` +
				` WHERE t.project_id = deployments.project_id AND t.deployment_id = deployments.id` +
				` AND t.origin = `,
			SQLSuffix: ")",
			Computed:  true,
		},
	})
}
