package deployment

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds deployment list/filter/order fields for all dialects. The
// actor pair (deployed_by, deployed_by_type) and source_environment_id are
// read straight off the row and never filtered on, so only the columns lists
// order or filter by are bound.
var Schema = database.NewSchema(map[domain.DeploymentField]database.FieldBinding[domain.Deployment]{
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
	domain.DeploymentFieldEnvironmentID: {
		SQLName:  "environment_id",
		Accessor: func(d *domain.Deployment) any { return d.EnvironmentID },
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
})
