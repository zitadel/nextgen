package spanner

import (
	"context"
	"encoding/json"
	"slices"
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
		` (project_id, id, release_id, metadata, deployed_at) VALUES (@p1, @p2, @p3, @p4, @p5)`
	createDeploymentTargetStmt = `INSERT INTO deployment_targets` +
		` (project_id, deployment_id, origin, release_id, deployed_at) VALUES (@p1, @p2, @p3, @p4, @p5)`
	deploymentQuery = `SELECT deployments.project_id, deployments.id, deployments.release_id,` +
		` deployments.metadata, deployments.deployed_at FROM deployments`
	newestForOriginQuery = deploymentQuery +
		` JOIN deployment_targets AS t ON t.project_id = deployments.project_id AND t.deployment_id = deployments.id` +
		` WHERE t.project_id = @p1 AND t.origin = @p2`
	newestForOriginOrder   = ` ORDER BY t.deployed_at DESC, t.deployment_id DESC LIMIT 1`
	deploymentTargetsQuery = `SELECT deployment_id, origin FROM deployment_targets` +
		` WHERE project_id = @p1 AND deployment_id IN UNNEST(@p2) ORDER BY deployment_id, origin`
	liveTargetsQuery = `SELECT deployment_id, origin FROM deployment_targets AS t WHERE t.project_id = @p1` +
		` AND NOT EXISTS (SELECT 1 FROM deployment_targets AS newer` +
		` WHERE newer.project_id = t.project_id AND newer.origin = t.origin` +
		` AND (newer.deployed_at > t.deployed_at` +
		` OR (newer.deployed_at = t.deployed_at AND newer.deployment_id > t.deployment_id)))` +
		` ORDER BY origin`
	createDeploymentVariableStmt = `INSERT INTO deployment_variables` +
		` (project_id, deployment_id, name, value, is_secret) VALUES (@p1, @p2, @p3, @p4, @p5)`
	deploymentVariablesQuery = `SELECT project_id, deployment_id, name, value, is_secret` +
		` FROM deployment_variables WHERE project_id = @p1 AND deployment_id = @p2 ORDER BY name`
)

var deploymentSchema = deployment.NewSchema("deployment_targets")

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

// CreateDeployment implements [service.DeploymentStatements].
//
// The stamp is taken in Go inside the transaction, after the lock, so every
// row of the set shares it and a deploy that waited stamps after the one it
// waited for.
func (ds deploymentStatements) CreateDeployment(ctx context.Context, entity *domain.Deployment) error {
	return withTransaction(ctx, ds.db, func(ctx context.Context, tx queryExecutor) error {
		stamp := time.Now().UTC()
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
			entity.ProjectID, entity.ID, entity.ReleaseID, metadata, stamp,
		).statement()
		if _, err := tx.Update(ctx, insert); err != nil {
			return err
		}
		for _, target := range entity.Targets {
			insert := buildStatement(createDeploymentTargetStmt,
				entity.ProjectID, entity.ID, target.Origin, entity.ReleaseID, stamp,
			).statement()
			if _, err := tx.Update(ctx, insert); err != nil {
				return err
			}
		}
		entity.DeployedAt = stamp
		return newResourceScopeStatements(tx).UpsertResourceScope(ctx,
			domain.NewResourceScope(domain.ResourceKindDeployment, entity.ProjectID, entity.ID))
	})
}

// GetDeploymentByID implements [service.DeploymentStatements].
func (ds deploymentStatements) GetDeploymentByID(ctx context.Context, projectID, id string) (*domain.Deployment, error) {
	row, err := ds.db.ReadRow(ctx, deploymentTable, spanner.Key{projectID, id}, deploymentColumns)
	if err != nil {
		return nil, err
	}
	entity, err := scanDeployment(row)
	if err != nil {
		return nil, err
	}
	if err := ds.loadTargets(ctx, projectID, []*domain.Deployment{entity}); err != nil {
		return nil, err
	}
	return entity, nil
}

// NewestDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) NewestDeployment(ctx context.Context, projectID, origin string) (*domain.Deployment, error) {
	return ds.getOne(ctx, buildStatement(newestForOriginQuery+newestForOriginOrder, projectID, origin).statement())
}

// NewestDeploymentOfRelease implements [service.DeploymentStatements].
func (ds deploymentStatements) NewestDeploymentOfRelease(ctx context.Context, projectID, origin, releaseID string) (*domain.Deployment, error) {
	return ds.getOne(ctx, buildStatement(newestForOriginQuery+` AND t.release_id = @p3`+newestForOriginOrder, projectID, origin, releaseID).statement())
}

func (ds deploymentStatements) getOne(ctx context.Context, stmt spanner.Statement) (*domain.Deployment, error) {
	var entity *domain.Deployment
	if err := ds.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanDeployment)
		return err
	}); err != nil {
		return nil, returnQueryError(err)
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
	items, err := ds.collect(ctx, compiler.statement())
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
	pairs, err := ds.collectTargets(ctx, buildStatement(liveTargetsQuery, projectID).statement())
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
	items, err := ds.collect(ctx, compiler.statement())
	if err != nil {
		return nil, err
	}
	deployment.AttachTargets(items, pairs)
	return items, nil
}

// ListDeployments implements [service.DeploymentStatements].
func (ds deploymentStatements) ListDeployments(ctx context.Context, filter *database.ListOptions[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, deploymentQuery, filter, deploymentSchema, deploymentTable, "id"); err != nil {
		return nil, err
	}
	items, err := ds.collect(ctx, compiler.statement())
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

func (ds deploymentStatements) collect(ctx context.Context, stmt spanner.Statement) ([]*domain.Deployment, error) {
	var items []*domain.Deployment
	if err := ds.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, scanDeployment)
		return err
	}); err != nil {
		return nil, err
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
	pairs, err := ds.collectTargets(ctx, buildStatement(deploymentTargetsQuery, projectID, ids).statement())
	if err != nil {
		return err
	}
	deployment.AttachTargets(items, pairs)
	return nil
}

func (ds deploymentStatements) collectTargets(ctx context.Context, stmt spanner.Statement) ([]deployment.TargetRow, error) {
	var pairs []deployment.TargetRow
	if err := ds.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		pairs, err = collectRows(iter, func(row *spanner.Row) (deployment.TargetRow, error) {
			var pair deployment.TargetRow
			err := row.Columns(&pair.DeploymentID, &pair.Origin)
			return pair, err
		})
		return err
	}); err != nil {
		return nil, err
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
	"project_id", "id", "release_id", "metadata", "deployed_at",
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
