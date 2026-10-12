package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	deploymentsTable = "deployments"
	targetsTable     = "deployment_targets"
	previewsTable    = "previews"

	createDeploymentStmt = `INSERT INTO deployments` +
		` (project_id, id, release_id, target_kind, metadata, deployed_at) VALUES (?, ?, ?, ?, ?, ?)`
	// Sets bind as one JSON array, read back by json_each.
	createDeploymentTargetsStmt = `INSERT INTO deployment_targets` +
		` (project_id, deployment_id, origin, release_id, deployed_at, seq)` +
		` SELECT ?, ?, json_extract(value, '$.origin'), ?, ?, json_extract(value, '$.seq') FROM json_each(?)`
	deploymentQuery = `SELECT project_id, id, release_id, target_kind, metadata, deployed_at FROM deployments`
	targetsQuery    = `SELECT origin, deployment_id, release_id, deployed_at, seq FROM deployment_targets` +
		` WHERE project_id = ? AND deployment_id IN (SELECT value FROM json_each(?))`
	newestDeploymentStmt = deploymentQuery + ` WHERE project_id = ?1 AND id = (` +
		`SELECT t.deployment_id FROM deployment_targets t` +
		` WHERE t.project_id = ?1 AND t.origin = ?2 ORDER BY t.seq DESC LIMIT 1)`
	deploymentAtStmt = deploymentQuery + ` WHERE project_id = ?1 AND id = (` +
		`SELECT t.deployment_id FROM deployment_targets t` +
		` WHERE t.project_id = ?1 AND t.origin = ?2 AND t.deployed_at <= ?3 ORDER BY t.seq DESC LIMIT 1)`
)

var (
	deploymentSchema = deployment.NewSchema(deploymentsTable, targetsTable, previewsTable)

	newestTargetsStmt = `SELECT t.origin, t.deployment_id, t.release_id, t.deployed_at, t.seq FROM deployment_targets t` +
		` WHERE t.project_id = ? AND t.origin IN (SELECT value FROM json_each(?)) AND NOT ` + deployment.NewerTargetExists(targetsTable)
	liveTargetsStmt = `SELECT t.origin, t.deployment_id, t.release_id, t.deployed_at, t.seq FROM deployment_targets t` +
		` JOIN deployments d ON d.project_id = t.project_id AND d.id = t.deployment_id` +
		` WHERE t.project_id = ? AND t.deployment_id IN (SELECT value FROM json_each(?)) AND NOT ` + deployment.NewerTargetExists(targetsTable) +
		` AND ` + deployment.TargetServesAt("d", previewsTable) + `?))`
)

type deploymentStatements struct{ statement }

func newDeploymentStatements(client queryExecutor) deploymentStatements {
	return deploymentStatements{statement: statement{client: client}}
}

func jsonArray(values []string) (string, error) {
	encoded, err := json.Marshal(values)
	return string(encoded), err
}

func targetsJSON(origins []string, seqs []int64) (string, error) {
	type target struct {
		Origin string `json:"origin"`
		Seq    int64  `json:"seq"`
	}
	targets := make([]target, len(origins))
	for i, origin := range origins {
		targets[i] = target{Origin: origin, Seq: seqs[i]}
	}
	encoded, err := json.Marshal(targets)
	return string(encoded), err
}

// NewestTargets implements [service.DeploymentStatements].
func (ds deploymentStatements) NewestTargets(ctx context.Context, projectID string, origins []string) ([]domain.TargetDeployment, error) {
	encoded, err := jsonArray(origins)
	if err != nil {
		return nil, err
	}
	return ds.collectTargets(ctx, newestTargetsStmt, projectID, encoded)
}

// InsertDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) InsertDeployment(ctx context.Context, entity *domain.Deployment, read []domain.TargetDeployment) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixDeployment); err != nil {
		return err
	}
	metadata, err := deployment.MarshalMetadata(entity.Metadata)
	if err != nil {
		return err
	}
	targets, err := targetsJSON(entity.Origins(), deployment.NextSeqs(entity.Origins(), read))
	if err != nil {
		return err
	}
	var deployedAt time.Time
	err = withTransaction(ctx, ds.client, func(ctx context.Context, tx queryExecutor) error {
		deployedAt = deployment.Stamp(time.Now())
		if _, err := tx.Exec(ctx, createDeploymentStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, entity.TargetKind.String(), string(metadata), deployedAt.UnixNano(),
		); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, createDeploymentTargetsStmt,
			entity.ProjectID, entity.ID, entity.ReleaseID, deployedAt.UnixNano(), targets,
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
	return ds.getOne(ctx, compiler.String(), compiler.args...)
}

// NewestDeployment implements [service.DeploymentStatements].
func (ds deploymentStatements) NewestDeployment(ctx context.Context, projectID, origin string) (*domain.Deployment, error) {
	return ds.getOne(ctx, newestDeploymentStmt, projectID, origin)
}

// DeploymentAt implements [service.DeploymentStatements].
func (ds deploymentStatements) DeploymentAt(ctx context.Context, projectID, origin string, at time.Time) (*domain.Deployment, error) {
	return ds.getOne(ctx, deploymentAtStmt, projectID, origin, at.UnixNano())
}

func (ds deploymentStatements) getOne(ctx context.Context, query string, args ...any) (*domain.Deployment, error) {
	rows, err := ds.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := collectExactlyOneRow(rows, scanDeployment)
	// Closed before the next query, which may share its connection.
	rows.Close()
	if err != nil {
		return nil, wrapError(err)
	}
	if err := ds.attachTargets(ctx, entity.ProjectID, []*domain.Deployment{entity}, nil); err != nil {
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
	return ds.list(ctx, filter, &now)
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
	defer rows.Close()
	items, err := collectRows(rows, scanDeployment)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

func (ds deploymentStatements) attachTargets(ctx context.Context, projectID string, items []*domain.Deployment, liveAt *time.Time) error {
	ids, err := jsonArray(deployment.DeploymentIDs(items))
	if err != nil {
		return err
	}
	var rows []domain.TargetDeployment
	if liveAt != nil {
		rows, err = ds.collectTargets(ctx, liveTargetsStmt, projectID, ids, liveAt.UnixNano())
	} else {
		rows, err = ds.collectTargets(ctx, targetsQuery, projectID, ids)
	}
	if err != nil {
		return err
	}
	deployment.AttachTargets(items, rows)
	return nil
}

func (ds deploymentStatements) collectTargets(ctx context.Context, query string, args ...any) ([]domain.TargetDeployment, error) {
	rows, err := ds.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	items, err := collectRows(rows, func(rows *sql.Rows) (domain.TargetDeployment, error) {
		var (
			scanned      domain.TargetDeployment
			deployedNano int64
		)
		if err := rows.Scan(&scanned.Origin, &scanned.DeploymentID, &scanned.ReleaseID, &deployedNano, &scanned.Seq); err != nil {
			return scanned, err
		}
		scanned.DeployedAt = timeFromUnixNano(deployedNano)
		return scanned, nil
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
		&scanned.TargetKind,
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
