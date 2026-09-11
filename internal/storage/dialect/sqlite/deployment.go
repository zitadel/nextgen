package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	// No FOR UPDATE: SQLite has one writer, so the transaction itself
	// serializes concurrent deploys to the same environment.
	environmentCurrentDeploymentStmt = `SELECT current_deployment_id FROM environments WHERE project_id = ? AND id = ?`
	createDeploymentStmt             = `INSERT INTO deployments` +
		` (project_id, id, environment_id, release_id, metadata, deployed_at)` +
		` VALUES (?, ?, ?, ?, ?, ?) RETURNING deployed_at`
	setEnvironmentCurrentDeploymentStmt = `UPDATE environments SET current_deployment_id = ? WHERE project_id = ? AND id = ?`
	deploymentQuery                     = `SELECT project_id, id, environment_id, release_id, metadata, deployed_at` +
		` FROM deployments`
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
	now := nowUnixNano()
	err = withTransaction(ctx, ds.client, func(ctx context.Context, tx queryExecutor) error {
		var currentID sql.NullString
		if err := tx.QueryRow(ctx, environmentCurrentDeploymentStmt, entity.ProjectID, entity.EnvironmentID).
			Scan(&currentID); err != nil {
			return wrapError(err)
		}
		// The current row is read whole because both branches below need it:
		// the guard's conflict details, and the idempotent answer's record.
		var current *domain.Deployment
		if currentID.Valid {
			row, err := ds.getInTx(ctx, tx, entity.ProjectID, currentID.String)
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
		var deployedNano int64
		if err := tx.QueryRow(ctx, createDeploymentStmt,
			entity.ProjectID,
			entity.ID,
			entity.EnvironmentID,
			entity.ReleaseID,
			string(metadata),
			now,
		).Scan(&deployedNano); err != nil {
			return wrapError(err)
		}
		entity.DeployedAt = timeFromUnixNano(deployedNano)
		if _, err := tx.Exec(ctx, setEnvironmentCurrentDeploymentStmt,
			entity.ID, entity.ProjectID, entity.EnvironmentID); err != nil {
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
	defer rows.Close()
	item, err := collectExactlyOneRow(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	return item, nil
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

func scanDeployment(rows *sql.Rows) (*domain.Deployment, error) {
	var scanned deployment.Row
	var metadata string
	var deployedNano int64
	if err := rows.Scan(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.EnvironmentID,
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
