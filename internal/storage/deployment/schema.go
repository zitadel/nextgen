package deployment

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds deployment list/filter/order fields for all dialects. The
// metadata document is read straight off the row and never filtered on, so
// only the columns lists order or filter by are bound.
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
	domain.DeploymentFieldDeployID: {
		SQLName:  "deploy_id",
		Accessor: func(d *domain.Deployment) any { return d.DeployID },
		Coerce:   database.CoerceString,
	},
	domain.DeploymentFieldOrigin: {
		SQLName:  "origin",
		Accessor: func(d *domain.Deployment) any { return d.Origin },
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
