package postgres

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	// FOR UPDATE serializes concurrent deploys to the project's targets: the
	// second waits for the first and then reads its rows as newest.
	lockProjectStmt      = `SELECT id FROM zitadel_nextgen.projects WHERE id = $1 FOR UPDATE`
	createDeploymentStmt = `INSERT INTO zitadel_nextgen.deployments` +
		` (project_id, id, deploy_id, origin, release_id, metadata, deployed_at)` +
		` VALUES ($1, $2, $3, $4, $5, $6, $7)`
	deploymentQuery = `SELECT project_id, id, deploy_id, origin, release_id, metadata, deployed_at` +
		` FROM zitadel_nextgen.deployments`
	// The newest row per origin: no row of the same target is newer.
	newestPerOrigin = `NOT EXISTS (SELECT 1 FROM zitadel_nextgen.deployments newer` +
		` WHERE newer.project_id = zitadel_nextgen.deployments.project_id` +
		` AND newer.origin = zitadel_nextgen.deployments.origin` +
		` AND (newer.deployed_at > zitadel_nextgen.deployments.deployed_at` +
		` OR (newer.deployed_at = zitadel_nextgen.deployments.deployed_at AND newer.id > zitadel_nextgen.deployments.id)))`
	createDeploymentVariableStmt = `INSERT INTO zitadel_nextgen.deployment_variables` +
		` (project_id, deployment_id, name, value, is_secret) VALUES ($1, $2, $3, $4, $5)`
	deploymentVariablesQuery = `SELECT project_id, deployment_id, name, value, is_secret` +
		` FROM zitadel_nextgen.deployment_variables WHERE project_id = $1 AND deployment_id = $2 ORDER BY name`
)

type deploymentStatements struct{ statement }

func newDeploymentStatements(client queryExecutor) deploymentStatements {
	return deploymentStatements{statement: statement{client: client}}
}

// LockProject implements [service.DeploymentStatements].
func (ds deploymentStatements) LockProject(ctx context.Context, projectID string) error {
	var locked string
	return wrapError(ds.client.QueryRow(ctx, lockProjectStmt, projectID).Scan(&locked))
}

// CreateDeployments implements [service.DeploymentStatements].
//
// One deployed_at for the whole set, read from clock_timestamp() so a deploy
// that waited on the project lock stamps after the one it waited for.
func (ds deploymentStatements) CreateDeployments(ctx context.Context, rows []*domain.Deployment) error {
	if len(rows) == 0 {
		return nil
	}
	return withTransaction(ctx, ds.client, func(ctx context.Context, tx queryExecutor) error {
		var stamp time.Time
		if err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&stamp); err != nil {
			return wrapError(err)
		}
		rsi := newResourceScopeStatements(tx)
		for _, entity := range rows {
			if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
				return err
			}
			metadata, err := deployment.MarshalMetadata(entity.Metadata)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, createDeploymentStmt,
				entity.ProjectID, entity.ID, entity.DeployID, entity.Origin, entity.ReleaseID, metadata, stamp,
			); err != nil {
				return wrapError(err)
			}
			entity.DeployedAt = stamp.UTC()
			if err := rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindDeployment, entity.ProjectID, entity.ID)); err != nil {
				return err
			}
		}
		return nil
	})
}

// GetDeploymentByID implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentByID(ctx context.Context, projectID, id string) (*domain.Deployment, error) {
	return ds.getOne(ctx, &database.ListOptions[domain.DeploymentField]{
		Filter: database.And(
			database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID),
			database.Equal(database.Col(domain.DeploymentFieldID), id),
		),
	})
}

// NewestDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) NewestDeployment(ctx context.Context, projectID, origin string) (*domain.Deployment, error) {
	return ds.getOne(ctx, deployment.NewestOf(projectID, origin, nil))
}

// NewestDeploymentOfRelease implements [service.DeploymentStatements].
func (ds deploymentStatements) NewestDeploymentOfRelease(ctx context.Context, projectID, origin, releaseID string) (*domain.Deployment, error) {
	return ds.getOne(ctx, deployment.NewestOf(projectID, origin, &releaseID))
}

func (ds deploymentStatements) getOne(ctx context.Context, opts *database.ListOptions[domain.DeploymentField]) (*domain.Deployment, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, deploymentQuery, opts, deployment.Schema); err != nil {
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

// ListLiveDeployments implements [service.DeploymentStatements].
func (ds deploymentStatements) ListLiveDeployments(ctx context.Context, projectID string) ([]*domain.Deployment, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, deploymentQuery, &database.ListOptions[domain.DeploymentField]{
		Filter: database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID),
		Pagination: database.Page[domain.DeploymentField]{
			OrderBy: database.OrderBy[domain.DeploymentField]{
				Columns:   []database.Column[domain.DeploymentField]{database.Col(domain.DeploymentFieldOrigin)},
				Direction: database.OrderAsc,
			},
		},
	}, deployment.Schema, newestPerOrigin); err != nil {
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

// CreateDeploymentVariables implements [service.DeploymentStatements].
func (ds deploymentStatements) CreateDeploymentVariables(ctx context.Context, rows []*domain.DeploymentVariable) error {
	for _, row := range rows {
		encoded, err := json.Marshal(row.Value)
		if err != nil {
			return err
		}
		if _, err := ds.client.Exec(ctx, createDeploymentVariableStmt,
			row.ProjectID, row.DeploymentID, row.Name, encoded, row.IsSecret,
		); err != nil {
			return wrapError(err)
		}
	}
	return nil
}

// GetDeploymentVariables implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentVariables(ctx context.Context, projectID, deploymentID string) ([]*domain.DeploymentVariable, error) {
	rows, err := ds.client.Query(ctx, deploymentVariablesQuery, projectID, deploymentID)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (*domain.DeploymentVariable, error) {
		var (
			item    domain.DeploymentVariable
			encoded []byte
		)
		if err := row.Scan(&item.ProjectID, &item.DeploymentID, &item.Name, &encoded, &item.IsSecret); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(encoded, &item.Value); err != nil {
			return nil, err
		}
		return &item, nil
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

func scanDeployment(row pgx.CollectableRow) (*domain.Deployment, error) {
	var scanned deployment.Row
	if err := row.Scan(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.DeployID,
		&scanned.Origin,
		&scanned.ReleaseID,
		&scanned.Metadata,
		&scanned.DeployedAt,
	); err != nil {
		return nil, err
	}
	return deployment.ToDomain(scanned)
}

var _ service.DeploymentStatements = (*deploymentStatements)(nil)
