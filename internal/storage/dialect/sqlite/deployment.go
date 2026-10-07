package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"slices"
	"strings"

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
		` (project_id, id, release_id, metadata, deployed_at) VALUES (?, ?, ?, ?, ?)`
	createDeploymentTargetStmt = `INSERT INTO deployment_targets` +
		` (project_id, deployment_id, origin, release_id, deployed_at) VALUES (?, ?, ?, ?, ?)`
	deploymentQuery = `SELECT deployments.project_id, deployments.id, deployments.release_id,` +
		` deployments.metadata, deployments.deployed_at FROM deployments`
	newestForOriginQuery = deploymentQuery +
		` JOIN deployment_targets AS t ON t.project_id = deployments.project_id AND t.deployment_id = deployments.id` +
		` WHERE t.project_id = ? AND t.origin = ?`
	newestForOriginOrder = ` ORDER BY t.deployed_at DESC, t.deployment_id DESC LIMIT 1`
	// The id list is expanded into placeholders by loadTargets.
	deploymentTargetsQuery = `SELECT deployment_id, origin FROM deployment_targets` +
		` WHERE project_id = ? AND deployment_id IN (%s) ORDER BY deployment_id, origin`
	liveTargetsQuery = `SELECT deployment_id, origin FROM deployment_targets AS t WHERE t.project_id = ?` +
		` AND NOT EXISTS (SELECT 1 FROM deployment_targets AS newer` +
		` WHERE newer.project_id = t.project_id AND newer.origin = t.origin` +
		` AND (newer.deployed_at > t.deployed_at` +
		` OR (newer.deployed_at = t.deployed_at AND newer.deployment_id > t.deployment_id)))` +
		` ORDER BY origin`
	createDeploymentVariableStmt = `INSERT INTO deployment_variables` +
		` (project_id, deployment_id, name, value, is_secret) VALUES (?, ?, ?, ?, ?)`
	deploymentVariablesQuery = `SELECT project_id, deployment_id, name, value, is_secret` +
		` FROM deployment_variables WHERE project_id = ? AND deployment_id = ? ORDER BY name`
)

var deploymentSchema = deployment.NewSchema("deployment_targets")

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
// Stamped inside the transaction: _txlock=immediate takes the write lock at
// BEGIN, so a deploy that waited for another cannot stamp a time older than
// the deploy it waited for.
func (ds deploymentStatements) CreateDeployment(ctx context.Context, entity *domain.Deployment) error {
	return withTransaction(ctx, ds.client, func(ctx context.Context, tx queryExecutor) error {
		now := nowUnixNano()
		if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
			return err
		}
		metadata, err := deployment.MarshalMetadata(entity.Metadata)
		if err != nil {
			return err
		}
		if _, err := execAffected(ctx, tx, createDeploymentStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, string(metadata), now,
		); err != nil {
			return err
		}
		for _, target := range entity.Targets {
			if _, err := execAffected(ctx, tx, createDeploymentTargetStmt,
				entity.ProjectID, entity.ID, target.Origin, entity.ReleaseID, now,
			); err != nil {
				return err
			}
		}
		entity.DeployedAt = timeFromUnixNano(now)
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
	return ds.getOne(ctx, newestForOriginQuery+` AND t.release_id = ?`+newestForOriginOrder, projectID, origin, releaseID)
}

func (ds deploymentStatements) getOne(ctx context.Context, query string, args ...any) (*domain.Deployment, error) {
	rows, err := ds.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	entity, err := collectExactlyOneRow(rows, scanDeployment)
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
	if err := compileList(ctx, &compiler, deploymentQuery, filter, deploymentSchema, "deployments", "id"); err != nil {
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
	defer rows.Close()
	items, err := collectRows(rows, scanDeployment)
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
	args := make([]any, 0, len(items)+1)
	args = append(args, projectID)
	for _, item := range items {
		args = append(args, item.ID)
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?, ", len(items)), ", ")
	pairs, err := ds.collectTargets(ctx, strings.Replace(deploymentTargetsQuery, "%s", placeholders, 1), args...)
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
	defer rows.Close()
	pairs, err := collectRows(rows, func(rows *sql.Rows) (deployment.TargetRow, error) {
		var pair deployment.TargetRow
		err := rows.Scan(&pair.DeploymentID, &pair.Origin)
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
