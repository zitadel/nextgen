package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	deploymentTable      = "deployments"
	createDeploymentStmt = `INSERT INTO deployments` +
		` (project_id, id, environment_id, release_id, metadata)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5) THEN RETURN deployed_at`
	setEnvironmentCurrentDeploymentStmt = `UPDATE environments SET current_deployment_id = @p3` +
		` WHERE project_id = @p1 AND id = @p2`
	deploymentQuery = `SELECT project_id, id, environment_id, release_id, metadata, deployed_at` +
		` FROM deployments`
)

type deploymentStatements struct{ statement }

func newDeploymentStatements(db queryExecutor) deploymentStatements {
	return deploymentStatements{statement: statement{db: db}}
}

// CreateDeployment implements [service.DeploymentStatements].
//
// The read-write transaction serializes concurrent deploys to the same
// environment: the ReadRow of the pointer acquires a lock on the environment
// row, so the second deploy waits for the first and then sees its deployment
// as current.
func (ds deploymentStatements) CreateDeployment(ctx context.Context, entity *domain.Deployment, expectedCurrentDeploymentID *string) (created bool, err error) {
	if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
		return false, err
	}
	rawMetadata, err := deployment.MarshalMetadata(entity.Metadata)
	if err != nil {
		return false, err
	}
	metadata, err := encodeNullJSON(rawMetadata)
	if err != nil {
		return false, err
	}
	err = withTransaction(ctx, ds.db, func(ctx context.Context, tx queryExecutor) error {
		row, err := tx.ReadRow(ctx, "environments", spanner.Key{entity.ProjectID, entity.EnvironmentID},
			[]string{"current_deployment_id"})
		if err != nil {
			return err
		}
		var currentID spanner.NullString
		if err := row.Columns(&currentID); err != nil {
			return wrapError(err)
		}
		// The current row is read whole because both branches below need it:
		// the guard's conflict details, and the idempotent answer's record.
		var current *domain.Deployment
		if currentID.Valid {
			currentRow, err := tx.ReadRow(ctx, deploymentTable,
				spanner.Key{entity.ProjectID, currentID.StringVal}, deploymentColumns)
			if err != nil {
				return err
			}
			current, err = scanDeployment(currentRow)
			if err != nil {
				return wrapError(err)
			}
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

		insert := buildStatement(createDeploymentStmt,
			entity.ProjectID,
			entity.ID,
			entity.EnvironmentID,
			entity.ReleaseID,
			metadata,
		).statement()
		if err := tx.Write(ctx, insert, func(iter *spanner.RowIterator) error {
			_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
				if err := row.Columns(&entity.DeployedAt); err != nil {
					return struct{}{}, err
				}
				entity.DeployedAt = entity.DeployedAt.UTC()
				return struct{}{}, nil
			})
			return err
		}); err != nil {
			return err
		}

		update := buildStatement(setEnvironmentCurrentDeploymentStmt,
			entity.ProjectID, entity.EnvironmentID, entity.ID).statement()
		if _, err := tx.Update(ctx, update); err != nil {
			return err
		}

		created = true
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindDeployment, entity.ProjectID, entity.ID))
	})
	return created, err
}

// GetDeploymentByID implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentByID(ctx context.Context, projectID, id string) (*domain.Deployment, error) {
	row, err := ds.db.ReadRow(ctx, deploymentTable, spanner.Key{projectID, id}, deploymentColumns)
	if err != nil {
		return nil, err
	}
	return scanDeployment(row)
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

var deploymentColumns = []string{
	"project_id", "id", "environment_id", "release_id", "metadata", "deployed_at",
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
		&scanned.EnvironmentID,
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
