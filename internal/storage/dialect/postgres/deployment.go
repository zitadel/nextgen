package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	// FOR UPDATE serializes concurrent deploys to the same environment: both
	// read the pointer they are about to swap, so the second waits for the
	// first and then sees its deployment as current.
	environmentCurrentDeploymentStmt = `SELECT current_deployment_id FROM zitadel_nextgen.environments` +
		` WHERE project_id = $1 AND id = $2 FOR UPDATE`
	createDeploymentStmt = `INSERT INTO zitadel_nextgen.deployments` +
		` (project_id, id, environment_id, release_id, metadata)` +
		` VALUES ($1, $2, $3, $4, $5) RETURNING deployed_at`
	setEnvironmentCurrentDeploymentStmt = `UPDATE zitadel_nextgen.environments SET current_deployment_id = $3` +
		` WHERE project_id = $1 AND id = $2`
	deploymentQuery = `SELECT project_id, id, environment_id, release_id, metadata, deployed_at` +
		` FROM zitadel_nextgen.deployments`
)

type deploymentStatements struct{ statement }

func newDeploymentStatements(client queryExecutor) deploymentStatements {
	return deploymentStatements{statement: statement{client: client}}
}

// CreateDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) CreateDeployment(ctx context.Context, entity *domain.Deployment, expectedCurrentDeploymentID *string) (created bool, err error) {
	if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
		return false, err
	}
	metadata, err := deployment.MarshalMetadata(entity.Metadata)
	if err != nil {
		return false, err
	}
	err = withTransaction(ctx, ds.client, func(ctx context.Context, tx queryExecutor) error {
		var currentID *string
		if err := tx.QueryRow(ctx, environmentCurrentDeploymentStmt, entity.ProjectID, entity.EnvironmentID).
			Scan(&currentID); err != nil {
			return wrapError(err)
		}
		// The current row is read whole because both branches below need it:
		// the guard's conflict details, and the idempotent answer's record.
		var current *domain.Deployment
		if currentID != nil {
			row, err := ds.getInTx(ctx, tx, entity.ProjectID, *currentID)
			if err != nil {
				return err
			}
			current = row
		}
		if err := deployment.CheckExpectedCurrent(current, expectedCurrentDeploymentID); err != nil {
			return err
		}
		// Idempotent on the running release: deploying what already runs is
		// answered with the deployment that made it live, and nothing is
		// written.
		if current != nil && current.ReleaseID == entity.ReleaseID {
			*entity = *current
			return nil
		}
		if err := tx.QueryRow(ctx, createDeploymentStmt,
			entity.ProjectID,
			entity.ID,
			entity.EnvironmentID,
			entity.ReleaseID,
			metadata,
		).Scan(&entity.DeployedAt); err != nil {
			return wrapError(err)
		}
		entity.DeployedAt = entity.DeployedAt.UTC()
		if _, err := tx.Exec(ctx, setEnvironmentCurrentDeploymentStmt,
			entity.ProjectID, entity.EnvironmentID, entity.ID); err != nil {
			return wrapError(err)
		}
		created = true
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindDeployment, entity.ProjectID, entity.ID))
	})
	return created, err
}

func (ds deploymentStatements) getInTx(ctx context.Context, tx queryExecutor, projectID, id string) (*domain.Deployment, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, deploymentQuery, &database.ListOptions[domain.DeploymentField]{
		Filter: database.And(
			database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID),
			database.Equal(database.Col(domain.DeploymentFieldID), id),
		),
	}, deployment.Schema); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

// GetDeploymentByID implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentByID(ctx context.Context, projectID, id string) (*domain.Deployment, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, deploymentQuery, &database.ListOptions[domain.DeploymentField]{
		Filter: database.And(
			database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID),
			database.Equal(database.Col(domain.DeploymentFieldID), id),
		),
	}, deployment.Schema); err != nil {
		return nil, err
	}

	rows, err := ds.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

// GetDeploymentsByIDs implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentsByIDs(ctx context.Context, projectID string, ids []string) ([]*domain.Deployment, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var compiler statementCompiler
	if err := compileRead(&compiler, deploymentQuery, &database.ListOptions[domain.DeploymentField]{
		Filter: deployment.ByIDs(projectID, ids),
	}, deployment.Schema); err != nil {
		return nil, err
	}

	rows, err := ds.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// ListDeployments implements [service.DeploymentStatements].
func (ds deploymentStatements) ListDeployments(ctx context.Context, filter *database.ListOptions[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, deploymentQuery, filter, deployment.Schema, "zitadel_nextgen.deployments", "id"); err != nil {
		return nil, err
	}

	rows, err := ds.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	items, err := pgx.CollectRows(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}

	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		items,
		deployment.Schema,
		filter.Pagination.Limit,
	)

	return &database.ListResult[*domain.Deployment]{Items: items, NextCursor: nextCursor}, nil
}

func scanDeployment(row pgx.CollectableRow) (*domain.Deployment, error) {
	var scanned deployment.Row
	if err := row.Scan(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.EnvironmentID,
		&scanned.ReleaseID,
		&scanned.Metadata,
		&scanned.DeployedAt,
	); err != nil {
		return nil, err
	}
	return deployment.ToDomain(scanned)
}

var _ service.DeploymentStatements = (*deploymentStatements)(nil)
