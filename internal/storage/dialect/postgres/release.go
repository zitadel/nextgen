package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/release"
)

const (
	createReleaseStmt = `INSERT INTO zitadel_nextgen.releases (project_id, id, content_hash, pointers, metadata)` +
		` VALUES ($1, $2, $3, $4, $5) RETURNING created_at`
	releaseQuery = `SELECT project_id, id, content_hash, pointers, metadata, created_at FROM zitadel_nextgen.releases`
)

type releaseStatements struct{ statement }

func newReleaseStatements(client queryExecutor) releaseStatements {
	return releaseStatements{statement: statement{client: client}}
}

// CreateRelease implements [service.ReleaseStatements].
func (rs releaseStatements) CreateRelease(ctx context.Context, entity *domain.Release) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixRelease); err != nil {
		return err
	}
	pointers, err := release.MarshalPointers(entity.Pointers)
	if err != nil {
		return err
	}
	metadata, err := release.MarshalMetadata(entity.Metadata)
	if err != nil {
		return err
	}
	return withTransaction(ctx, rs.client, func(ctx context.Context, tx queryExecutor) error {
		if err := tx.QueryRow(ctx, createReleaseStmt,
			entity.ProjectID,
			entity.ID,
			entity.ContentHash,
			pointers,
			metadata,
		).Scan(&entity.CreatedAt); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt = entity.CreatedAt.UTC()
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindRelease, entity.ProjectID, entity.ID))
	})
}

// GetReleaseByID implements [service.ReleaseStatements].
func (rs releaseStatements) GetReleaseByID(ctx context.Context, projectID, id string) (*domain.Release, error) {
	return rs.getOne(ctx, database.And(
		database.Equal(database.Col(domain.ReleaseFieldProjectID), projectID),
		database.Equal(database.Col(domain.ReleaseFieldID), id),
	))
}

// GetReleaseByContentHash implements [service.ReleaseStatements].
func (rs releaseStatements) GetReleaseByContentHash(ctx context.Context, projectID, contentHash string) (*domain.Release, error) {
	return rs.getOne(ctx, database.And(
		database.Equal(database.Col(domain.ReleaseFieldProjectID), projectID),
		database.Equal(database.Col(domain.ReleaseFieldContentHash), contentHash),
	))
}

func (rs releaseStatements) getOne(ctx context.Context, filter database.Filter[domain.ReleaseField]) (*domain.Release, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, releaseQuery, &database.ListOptions[domain.ReleaseField]{
		Filter: filter,
	}, release.Schema); err != nil {
		return nil, err
	}

	rows, err := rs.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanRelease)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

// ListReleases implements [service.ReleaseStatements].
func (rs releaseStatements) ListReleases(ctx context.Context, filter *database.ListOptions[domain.ReleaseField]) (*database.ListResult[*domain.Release], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, releaseQuery, filter, release.Schema, "zitadel_nextgen.releases", "id"); err != nil {
		return nil, err
	}

	rows, err := rs.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	items, err := pgx.CollectRows(rows, scanRelease)
	if err != nil {
		return nil, wrapError(err)
	}

	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		items,
		release.Schema,
		filter.Pagination.Limit,
	)

	return &database.ListResult[*domain.Release]{Items: items, NextCursor: nextCursor}, nil
}

func scanRelease(row pgx.CollectableRow) (*domain.Release, error) {
	var scanned release.Row
	if err := row.Scan(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.ContentHash,
		&scanned.Pointers,
		&scanned.Metadata,
		&scanned.CreatedAt,
	); err != nil {
		return nil, err
	}
	return release.ToDomain(scanned)
}

var _ service.ReleaseStatements = (*releaseStatements)(nil)
