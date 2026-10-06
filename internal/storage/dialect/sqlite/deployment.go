package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	// No FOR UPDATE: SQLite has one writer, so the transaction itself
	// serializes concurrent deploys. The read still answers whether the
	// project exists.
	lockProjectStmt      = `SELECT id FROM projects WHERE id = ?`
	createDeploymentStmt = `INSERT INTO deployments` +
		` (project_id, id, deploy_id, origin, release_id, metadata, deployed_at)` +
		` VALUES (?, ?, ?, ?, ?, ?, ?)`
	deploymentQuery = `SELECT project_id, id, deploy_id, origin, release_id, metadata, deployed_at` +
		` FROM deployments`
	newestPerOrigin = `NOT EXISTS (SELECT 1 FROM deployments AS newer` +
		` WHERE newer.project_id = deployments.project_id` +
		` AND newer.origin = deployments.origin` +
		` AND (newer.deployed_at > deployments.deployed_at` +
		` OR (newer.deployed_at = deployments.deployed_at AND newer.id > deployments.id)))`
	createDeploymentVariableStmt = `INSERT INTO deployment_variables` +
		` (project_id, deployment_id, name, value, is_secret) VALUES (?, ?, ?, ?, ?)`
	deploymentVariablesQuery = `SELECT project_id, deployment_id, name, value, is_secret` +
		` FROM deployment_variables WHERE project_id = ? AND deployment_id = ? ORDER BY name`
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
// Stamped inside the transaction: _txlock=immediate takes the write lock at
// BEGIN, so a deploy that waited for another cannot stamp a time older than
// the deploy it waited for.
func (ds deploymentStatements) CreateDeployments(ctx context.Context, rows []*domain.Deployment) error {
	if len(rows) == 0 {
		return nil
	}
	return withTransaction(ctx, ds.client, func(ctx context.Context, tx queryExecutor) error {
		now := nowUnixNano()
		rsi := newResourceScopeStatements(tx)
		for _, entity := range rows {
			if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
				return err
			}
			metadata, err := deployment.MarshalMetadata(entity.Metadata)
			if err != nil {
				return err
			}
			if _, err := execAffected(ctx, tx, createDeploymentStmt,
				entity.ProjectID, entity.ID, entity.DeployID, entity.Origin, entity.ReleaseID, string(metadata), now,
			); err != nil {
				return err
			}
			entity.DeployedAt = timeFromUnixNano(now)
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
	defer rows.Close()
	item, err := collectExactlyOneRow(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	return item, nil
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
	defer rows.Close()
	items, err := collectRows(rows, scanDeployment)
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
	defer rows.Close()
	items, err := collectRows(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// ListDeployments implements [service.DeploymentStatements].
func (ds deploymentStatements) ListDeployments(ctx context.Context, filter *database.ListOptions[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, deploymentQuery, filter, deployment.Schema, "deployments", "id"); err != nil {
		return nil, err
	}

	rows, err := ds.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()

	items, err := collectRows(rows, scanDeployment)
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
		if _, err := execAffected(ctx, ds.client, createDeploymentVariableStmt,
			row.ProjectID, row.DeploymentID, row.Name, string(encoded), row.IsSecret,
		); err != nil {
			return err
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
	defer rows.Close()
	items, err := collectRows(rows, func(rows *sql.Rows) (*domain.DeploymentVariable, error) {
		var (
			item    domain.DeploymentVariable
			encoded string
		)
		if err := rows.Scan(&item.ProjectID, &item.DeploymentID, &item.Name, &encoded, &item.IsSecret); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(encoded), &item.Value); err != nil {
			return nil, err
		}
		return &item, nil
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

func scanDeployment(rows *sql.Rows) (*domain.Deployment, error) {
	var scanned deployment.Row
	var metadata string
	var deployedNano int64
	if err := rows.Scan(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.DeployID,
		&scanned.Origin,
		&scanned.ReleaseID,
		&metadata,
		&deployedNano,
	); err != nil {
		return nil, err
	}
	scanned.Metadata = []byte(metadata)
	scanned.DeployedAt = timeFromUnixNano(deployedNano)
	return deployment.ToDomain(scanned)
}

var _ service.DeploymentStatements = (*deploymentStatements)(nil)
