package postgres

import (
	"context"
	"encoding/json"
	"slices"
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
		` (project_id, id, release_id, metadata, deployed_at) VALUES ($1, $2, $3, $4, $5)`
	createDeploymentTargetStmt = `INSERT INTO zitadel_nextgen.deployment_targets` +
		` (project_id, deployment_id, origin, release_id, deployed_at) VALUES ($1, $2, $3, $4, $5)`
	deploymentQuery = `SELECT deployments.project_id, deployments.id, deployments.release_id,` +
		` deployments.metadata, deployments.deployed_at FROM zitadel_nextgen.deployments`
	// The operation one target serves: its newest target row, joined back to
	// the operation. An optional release filter is appended before the order.
	newestForOriginQuery = deploymentQuery +
		` JOIN zitadel_nextgen.deployment_targets t ON t.project_id = deployments.project_id AND t.deployment_id = deployments.id` +
		` WHERE t.project_id = $1 AND t.origin = $2`
	newestForOriginOrder   = ` ORDER BY t.deployed_at DESC, t.deployment_id DESC LIMIT 1`
	deploymentTargetsQuery = `SELECT deployment_id, origin FROM zitadel_nextgen.deployment_targets` +
		` WHERE project_id = $1 AND deployment_id = ANY($2) ORDER BY deployment_id, origin`
	// The newest target row per origin: no row of the same origin is newer.
	liveTargetsQuery = `SELECT deployment_id, origin FROM zitadel_nextgen.deployment_targets t WHERE t.project_id = $1` +
		` AND NOT EXISTS (SELECT 1 FROM zitadel_nextgen.deployment_targets newer` +
		` WHERE newer.project_id = t.project_id AND newer.origin = t.origin` +
		` AND (newer.deployed_at > t.deployed_at` +
		` OR (newer.deployed_at = t.deployed_at AND newer.deployment_id > t.deployment_id)))` +
		` ORDER BY origin`
	createDeploymentVariableStmt = `INSERT INTO zitadel_nextgen.deployment_variables` +
		` (project_id, deployment_id, name, value, is_secret) VALUES ($1, $2, $3, $4, $5)`
	deploymentVariablesQuery = `SELECT project_id, deployment_id, name, value, is_secret` +
		` FROM zitadel_nextgen.deployment_variables WHERE project_id = $1 AND deployment_id = $2 ORDER BY name`
)

var deploymentSchema = deployment.NewSchema("zitadel_nextgen.deployment_targets")

type deploymentStatements struct{ statement }

func newDeploymentStatements(client queryExecutor) deploymentStatements {
	return deploymentStatements{statement: statement{client: client}}
}

// LockProject implements [service.DeploymentStatements].
func (ds deploymentStatements) LockProject(ctx context.Context, projectID string) error {
	var locked string
	return wrapError(ds.client.QueryRow(ctx, lockProjectStmt, projectID).Scan(&locked))
}

// CreateDeployment implements [service.DeploymentStatements].
//
// One deployed_at for the whole set, read from clock_timestamp() so a deploy
// that waited on the project lock stamps after the one it waited for.
func (ds deploymentStatements) CreateDeployment(ctx context.Context, entity *domain.Deployment) error {
	return withTransaction(ctx, ds.client, func(ctx context.Context, tx queryExecutor) error {
		var stamp time.Time
		if err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&stamp); err != nil {
			return wrapError(err)
		}
		if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
			return err
		}
		metadata, err := deployment.MarshalMetadata(entity.Metadata)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, createDeploymentStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, metadata, stamp,
		); err != nil {
			return wrapError(err)
		}
		for _, target := range entity.Targets {
			if _, err := tx.Exec(ctx, createDeploymentTargetStmt,
				entity.ProjectID, entity.ID, target.Origin, entity.ReleaseID, stamp,
			); err != nil {
				return wrapError(err)
			}
		}
		entity.DeployedAt = stamp.UTC()
		return newResourceScopeStatements(tx).UpsertResourceScope(ctx,
			domain.NewResourceScope(domain.ResourceKindDeployment, entity.ProjectID, entity.ID))
	})
}

// GetDeploymentByID implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentByID(ctx context.Context, projectID, id string) (*domain.Deployment, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, deploymentQuery, &database.ListOptions[domain.DeploymentField]{
		Filter: database.And(
			database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID),
			database.Equal(database.Col(domain.DeploymentFieldID), id),
		),
	}, deploymentSchema); err != nil {
		return nil, err
	}
	return ds.getOne(ctx, compiler.String(), compiler.args...)
}

// NewestDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) NewestDeployment(ctx context.Context, projectID, origin string) (*domain.Deployment, error) {
	return ds.getOne(ctx, newestForOriginQuery+newestForOriginOrder, projectID, origin)
}

// NewestDeploymentOfRelease implements [service.DeploymentStatements].
func (ds deploymentStatements) NewestDeploymentOfRelease(ctx context.Context, projectID, origin, releaseID string) (*domain.Deployment, error) {
	return ds.getOne(ctx, newestForOriginQuery+` AND t.release_id = $3`+newestForOriginOrder, projectID, origin, releaseID)
}

func (ds deploymentStatements) getOne(ctx context.Context, query string, args ...any) (*domain.Deployment, error) {
	rows, err := ds.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	if err := ds.loadTargets(ctx, entity.ProjectID, []*domain.Deployment{entity}); err != nil {
		return nil, err
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
	}, deploymentSchema); err != nil {
		return nil, err
	}
	items, err := ds.collect(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, err
	}
	if err := ds.loadTargets(ctx, projectID, items); err != nil {
		return nil, err
	}
	return items, nil
}

// ListLiveDeployments implements [service.DeploymentStatements].
func (ds deploymentStatements) ListLiveDeployments(ctx context.Context, projectID string) ([]*domain.Deployment, error) {
	pairs, err := ds.collectTargets(ctx, liveTargetsQuery, projectID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(pairs))
	for _, pair := range pairs {
		if !slices.Contains(ids, pair.DeploymentID) {
			ids = append(ids, pair.DeploymentID)
		}
	}
	var compiler statementCompiler
	if err := compileRead(&compiler, deploymentQuery, &database.ListOptions[domain.DeploymentField]{
		Filter:     deployment.ByIDs(projectID, ids),
		Pagination: database.Page[domain.DeploymentField]{OrderBy: deployment.NewestFirst()},
	}, deploymentSchema); err != nil {
		return nil, err
	}
	items, err := ds.collect(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, err
	}
	deployment.AttachTargets(items, pairs)
	return items, nil
}

// ListDeployments implements [service.DeploymentStatements].
func (ds deploymentStatements) ListDeployments(ctx context.Context, filter *database.ListOptions[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, deploymentQuery, filter, deploymentSchema, "zitadel_nextgen.deployments", "id"); err != nil {
		return nil, err
	}
	items, err := ds.collect(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, err
	}
	if len(items) > 0 {
		if err := ds.loadTargets(ctx, items[0].ProjectID, items); err != nil {
			return nil, err
		}
	}
	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		items,
		deploymentSchema,
		filter.Pagination.Limit,
	)
	return &database.ListResult[*domain.Deployment]{Items: items, NextCursor: nextCursor}, nil
}

func (ds deploymentStatements) collect(ctx context.Context, query string, args ...any) ([]*domain.Deployment, error) {
	rows, err := ds.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// loadTargets attaches every target row of the listed operations.
func (ds deploymentStatements) loadTargets(ctx context.Context, projectID string, items []*domain.Deployment) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, len(items))
	for i, item := range items {
		ids[i] = item.ID
	}
	pairs, err := ds.collectTargets(ctx, deploymentTargetsQuery, projectID, ids)
	if err != nil {
		return err
	}
	deployment.AttachTargets(items, pairs)
	return nil
}

func (ds deploymentStatements) collectTargets(ctx context.Context, query string, args ...any) ([]deployment.TargetRow, error) {
	rows, err := ds.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	pairs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (deployment.TargetRow, error) {
		var pair deployment.TargetRow
		err := row.Scan(&pair.DeploymentID, &pair.Origin)
		return pair, err
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return pairs, nil
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
		&scanned.ReleaseID,
		&scanned.Metadata,
		&scanned.DeployedAt,
	); err != nil {
		return nil, err
	}
	return deployment.ToDomain(scanned)
}

var _ service.DeploymentStatements = (*deploymentStatements)(nil)
