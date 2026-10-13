package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	deploymentsTable = "deployments"
	originsTable     = "deployment_origins"
	previewsTable    = "previews"

	createDeploymentStmt = `INSERT INTO deployments` +
		` (project_id, id, release_id, origin_kind, metadata, deployed_at) VALUES (?, ?, ?, ?, ?, ?)`
	// Sets bind as one JSON array, read back by json_each.
	createDeploymentOriginsStmt = `INSERT INTO deployment_origins` +
		` (project_id, deployment_id, origin, release_id, origin_kind, deployed_at, seq)` +
		` SELECT ?, ?, json_extract(value, '$.origin'), ?, ?, ?, json_extract(value, '$.seq') FROM json_each(?)`
	deploymentQuery = `SELECT project_id, id, release_id, origin_kind, metadata, deployed_at FROM deployments`
)

var (
	deploymentSchema = deployment.NewSchema(deploymentsTable, originsTable, previewsTable)

	originsQuery        = deployment.OriginsSelect(originsTable) + ` WHERE t.project_id = ? AND t.deployment_id IN (SELECT value FROM json_each(?))`
	newestPerOriginStmt = deployment.OriginsSelect(originsTable) +
		` WHERE t.project_id = ? AND t.origin IN (SELECT value FROM json_each(?)) AND NOT ` + deployment.NewerOriginRowExists(originsTable)
	liveOriginsStmt = originsQuery + ` AND NOT ` + deployment.NewerOriginRowExists(originsTable) +
		` AND ` + deployment.OriginServes(previewsTable, "?")
	liveDeploymentStmt = deploymentQuery + ` WHERE project_id = ?1 AND id = (SELECT t.deployment_id FROM ` + originsTable + ` t` +
		` WHERE t.project_id = ?1 AND t.origin = ?2 AND NOT ` + deployment.NewerOriginRowExists(originsTable) +
		` AND ` + deployment.OriginServes(previewsTable, "?3") + `)`
)

type deploymentStatements struct{ statement }

func newDeploymentStatements(client queryExecutor) deploymentStatements {
	return deploymentStatements{statement: statement{client: client}}
}

// GetNewestPerOrigin implements [service.DeploymentStatements].
func (ds deploymentStatements) GetNewestPerOrigin(ctx context.Context, projectID string, origins []string) ([]domain.OriginDeployment, error) {
	encoded, err := encodeJSON(origins)
	if err != nil {
		return nil, err
	}
	return ds.collectOrigins(ctx, newestPerOriginStmt, projectID, encoded)
}

// CreateDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) CreateDeployment(ctx context.Context, entity *domain.Deployment, read []domain.OriginDeployment) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
		return err
	}
	metadata, err := deployment.MarshalMetadata(entity.Metadata)
	if err != nil {
		return err
	}
	type target struct {
		Origin string `json:"origin"`
		Seq    int64  `json:"seq"`
	}
	origins, seqs := entity.Origins(), deployment.NextSeqs(entity.Origins(), read)
	rows := make([]target, len(origins))
	for i, origin := range origins {
		rows[i] = target{Origin: origin, Seq: seqs[i]}
	}
	targets, err := encodeJSON(rows)
	if err != nil {
		return err
	}
	var deployedAt time.Time
	err = withTransaction(ctx, ds.client, func(ctx context.Context, tx queryExecutor) error {
		deployedAt = deployment.Stamp(time.Now())
		if _, err := tx.Exec(ctx, createDeploymentStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, entity.OriginKind.String(), string(metadata), deployedAt.UnixNano(),
		); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, createDeploymentOriginsStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, entity.OriginKind.String(), deployedAt.UnixNano(), targets,
		); err != nil {
			return wrapError(err)
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindDeployment, entity.ProjectID, entity.ID))
	})
	if err != nil {
		return err
	}
	entity.DeployedAt = deployedAt
	return nil
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
	return ds.getOne(ctx, nil, compiler.String(), compiler.args...)
}

// GetLiveDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) GetLiveDeployment(ctx context.Context, projectID, origin string, now time.Time) (*domain.Deployment, error) {
	return ds.getOne(ctx, &now, liveDeploymentStmt, projectID, origin, now.UnixNano())
}

// getOne reads one deployment with its origins: all of them, or with liveAt
// only those still serving then.
func (ds deploymentStatements) getOne(ctx context.Context, liveAt *time.Time, query string, args ...any) (*domain.Deployment, error) {
	rows, err := ds.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := collectExactlyOneRow(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	if err := ds.attachTargets(ctx, entity.ProjectID, []*domain.Deployment{entity}, liveAt); err != nil {
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
	if err := ds.attachTargets(ctx, projectID, items, nil); err != nil {
		return nil, err
	}
	return items, nil
}

// ListDeployments implements [service.DeploymentStatements].
func (ds deploymentStatements) ListDeployments(ctx context.Context, filter *database.ListOptions[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
	return ds.list(ctx, filter, nil)
}

// ListLiveDeployments implements [service.DeploymentStatements].
func (ds deploymentStatements) ListLiveDeployments(ctx context.Context, now time.Time, filter *database.ListOptions[domain.DeploymentField]) (*database.ListResult[*domain.Deployment], error) {
	return ds.list(ctx, deployment.LiveAt(filter, now), &now)
}

func (ds deploymentStatements) list(ctx context.Context, filter *database.ListOptions[domain.DeploymentField], liveAt *time.Time) (*database.ListResult[*domain.Deployment], error) {
	items, nextCursor, err := pagination.Page(filter.Pagination, deploymentSchema, func(limit uint32) ([]*domain.Deployment, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileList(ctx, &compiler, deploymentQuery, filter, deploymentSchema, deploymentsTable, "id"); err != nil {
			return nil, err
		}
		return ds.collect(ctx, compiler.String(), compiler.args...)
	})
	if err != nil {
		return nil, err
	}
	if len(items) > 0 {
		if err := ds.attachTargets(ctx, items[0].ProjectID, items, liveAt); err != nil {
			return nil, err
		}
	}
	return &database.ListResult[*domain.Deployment]{Items: items, NextCursor: nextCursor}, nil
}

func (ds deploymentStatements) collect(ctx context.Context, query string, args ...any) ([]*domain.Deployment, error) {
	rows, err := ds.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := collectRows(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

func (ds deploymentStatements) attachTargets(ctx context.Context, projectID string, items []*domain.Deployment, liveAt *time.Time) error {
	ids, err := encodeJSON(deployment.DeploymentIDs(items))
	if err != nil {
		return err
	}
	query, args := originsQuery, []any{projectID, ids}
	if liveAt != nil {
		query, args = liveOriginsStmt, append(args, liveAt.UnixNano())
	}
	rows, err := ds.collectOrigins(ctx, query, args...)
	if err != nil {
		return err
	}
	deployment.AttachTargets(items, rows)
	return nil
}

func (ds deploymentStatements) collectOrigins(ctx context.Context, query string, args ...any) ([]domain.OriginDeployment, error) {
	rows, err := ds.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := collectRows(rows, func(rows *sql.Rows) (domain.OriginDeployment, error) {
		var (
			scanned      domain.OriginDeployment
			kind         string
			deployedNano int64
		)
		if err := rows.Scan(&scanned.Origin, &scanned.DeploymentID, &scanned.ReleaseID, &kind, &deployedNano, &scanned.Seq); err != nil {
			return scanned, err
		}
		scanned.DeployedAt = timeFromUnixNano(deployedNano)
		return deployment.WithKind(scanned, kind)
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

func scanDeployment(rows *sql.Rows) (*domain.Deployment, error) {
	var (
		scanned      deployment.Row
		metadata     string
		deployedNano int64
	)
	if err := rows.Scan(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.ReleaseID,
		&scanned.OriginKind,
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
