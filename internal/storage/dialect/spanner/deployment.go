package spanner

import (
	"context"
	"encoding/json"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	deploymentTable = "deployments"
	// FOR UPDATE takes an exclusive lock on the project row, so concurrent
	// deploys to its targets serialize; a plain read would take a shared lock
	// two deploys can hold at once.
	lockProjectStmt      = `SELECT id FROM projects WHERE id = @p1 FOR UPDATE`
	createDeploymentStmt = `INSERT INTO deployments` +
		` (project_id, id, deploy_id, origin, release_id, metadata, deployed_at)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7)`
	deploymentQuery = `SELECT project_id, id, deploy_id, origin, release_id, metadata, deployed_at` +
		` FROM deployments`
	newestPerOrigin = `NOT EXISTS (SELECT 1 FROM deployments AS newer` +
		` WHERE newer.project_id = deployments.project_id` +
		` AND newer.origin = deployments.origin` +
		` AND (newer.deployed_at > deployments.deployed_at` +
		` OR (newer.deployed_at = deployments.deployed_at AND newer.id > deployments.id)))`
	createDeploymentVariableStmt = `INSERT INTO deployment_variables` +
		` (project_id, deployment_id, name, value, is_secret) VALUES (@p1, @p2, @p3, @p4, @p5)`
	deploymentVariablesQuery = `SELECT project_id, deployment_id, name, value, is_secret` +
		` FROM deployment_variables WHERE project_id = @p1 AND deployment_id = @p2 ORDER BY name`
)

type deploymentStatements struct{ statement }

func newDeploymentStatements(db queryExecutor) deploymentStatements {
	return deploymentStatements{statement: statement{db: db}}
}

// LockProject implements [service.DeploymentStatements].
func (ds deploymentStatements) LockProject(ctx context.Context, projectID string) error {
	return ds.db.Query(ctx, buildStatement(lockProjectStmt, projectID).statement(), func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(*spanner.Row) (struct{}, error) { return struct{}{}, nil })
		return err
	})
}

// CreateDeployments implements [service.DeploymentStatements].
//
// The stamp is taken in Go inside the transaction, after the lock, so every
// row of the set shares it and a deploy that waited stamps after the one it
// waited for.
func (ds deploymentStatements) CreateDeployments(ctx context.Context, rows []*domain.Deployment) error {
	if len(rows) == 0 {
		return nil
	}
	return withTransaction(ctx, ds.db, func(ctx context.Context, tx queryExecutor) error {
		stamp := time.Now().UTC()
		rsi := newResourceScopeStatements(tx)
		for _, entity := range rows {
			if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
				return err
			}
			rawMetadata, err := deployment.MarshalMetadata(entity.Metadata)
			if err != nil {
				return err
			}
			metadata, err := encodeNullJSON(rawMetadata)
			if err != nil {
				return err
			}
			insert := buildStatement(createDeploymentStmt,
				entity.ProjectID, entity.ID, entity.DeployID, entity.Origin, entity.ReleaseID, metadata, stamp,
			).statement()
			if _, err := tx.Update(ctx, insert); err != nil {
				return err
			}
			entity.DeployedAt = stamp
			if err := rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindDeployment, entity.ProjectID, entity.ID)); err != nil {
				return err
			}
		}
		return nil
	})
}

// GetDeploymentByID implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentByID(ctx context.Context, projectID, id string) (*domain.Deployment, error) {
	row, err := ds.db.ReadRow(ctx, deploymentTable, spanner.Key{projectID, id}, deploymentColumns)
	if err != nil {
		return nil, err
	}
	return scanDeployment(row)
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
	var entity *domain.Deployment
	if err := ds.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanDeployment)
		return err
	}); err != nil {
		return nil, returnQueryError(err)
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

	var items []*domain.Deployment
	if err := ds.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, scanDeployment)
		return err
	}); err != nil {
		return nil, err
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
	var items []*domain.Deployment
	if err := ds.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, scanDeployment)
		return err
	}); err != nil {
		return nil, err
	}
	return items, nil
}

// ListDeployments implements [service.DeploymentStatements].
func (ds deploymentStatements) ListDeployments(ctx context.Context, filter *database.ListOptions[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, deploymentQuery, filter, deployment.Schema, deploymentTable, "id"); err != nil {
		return nil, err
	}

	var items []*domain.Deployment
	if err := ds.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, scanDeployment)
		return err
	}); err != nil {
		return nil, err
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
		stmt := buildStatement(createDeploymentVariableStmt,
			row.ProjectID, row.DeploymentID, row.Name,
			spanner.NullJSON{Value: json.RawMessage(encoded), Valid: true}, row.IsSecret,
		).statement()
		if _, err := ds.db.Update(ctx, stmt); err != nil {
			return wrapError(err)
		}
	}
	return nil
}

// GetDeploymentVariables implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentVariables(ctx context.Context, projectID, deploymentID string) ([]*domain.DeploymentVariable, error) {
	var items []*domain.DeploymentVariable
	err := ds.db.Query(ctx, buildStatement(deploymentVariablesQuery, projectID, deploymentID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, func(row *spanner.Row) (*domain.DeploymentVariable, error) {
			var (
				item    domain.DeploymentVariable
				encoded spanner.NullJSON
			)
			if err := row.Columns(&item.ProjectID, &item.DeploymentID, &item.Name, &encoded, &item.IsSecret); err != nil {
				return nil, err
			}
			raw, err := decodeNullJSON(encoded)
			if err != nil {
				return nil, err
			}
			if len(raw) > 0 {
				if err := json.Unmarshal(raw, &item.Value); err != nil {
					return nil, err
				}
			}
			return &item, nil
		})
		return err
	})
	if err != nil {
		return nil, returnQueryError(err)
	}
	return items, nil
}

var deploymentColumns = []string{
	"project_id", "id", "deploy_id", "origin", "release_id", "metadata", "deployed_at",
}

func scanDeployment(row *spanner.Row) (*domain.Deployment, error) {
	var (
		scanned      deployment.Row
		metadataJSON spanner.NullJSON
		deployedAt   time.Time
	)
	if err := row.Columns(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.DeployID,
		&scanned.Origin,
		&scanned.ReleaseID,
		&metadataJSON,
		&deployedAt,
	); err != nil {
		return nil, err
	}
	rawMetadata, err := decodeNullJSON(metadataJSON)
	if err != nil {
		return nil, err
	}
	scanned.Metadata = rawMetadata
	scanned.DeployedAt = deployedAt
	return deployment.ToDomain(scanned)
}

var _ service.DeploymentStatements = (*deploymentStatements)(nil)
