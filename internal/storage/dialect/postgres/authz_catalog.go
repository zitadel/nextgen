package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

const (
	retireActiveCatalogStmt = `
UPDATE zitadel_nextgen.authz_catalogs
SET status = 'retired'
WHERE catalog_kind = $1 AND owner_id = $2 AND status = 'active'`

	insertAuthzCatalogStmt = `
INSERT INTO zitadel_nextgen.authz_catalogs (
    id, catalog_kind, owner_id, version, status, source_hash
) VALUES ($1, $2, $3, $4, 'active', $5)`

	insertAuthzRelationStmt = `
INSERT INTO zitadel_nextgen.authz_relations (
    catalog_id, object_type, relation, kind
) VALUES ($1, $2, $3, $4)`

	insertAuthzRelationReferenceStmt = `
INSERT INTO zitadel_nextgen.authz_relation_references (
    catalog_id, object_type, relation, ref_type, ref_relation, wildcard, condition, position
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`

	insertAuthzExpressionEdgeStmt = `
INSERT INTO zitadel_nextgen.authz_expression_edges (
    catalog_id, object_type, relation, kind,
    source_object_type, source_relation,
    tupleset_object_type, tupleset_relation, position
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

	insertAuthzRelationClosureStmt = `
INSERT INTO zitadel_nextgen.authz_relation_closure (
    catalog_id, from_object_type, from_relation, to_object_type, to_relation, depth
) VALUES ($1, $2, $3, $4, $5, $6)`

	getAuthzCatalogStmt = `
SELECT id, catalog_kind, owner_id, version, status, source_hash
FROM zitadel_nextgen.authz_catalogs
WHERE id = $1`

	listAuthzRelationsByCatalogStmt = `
SELECT object_type, relation, kind
FROM zitadel_nextgen.authz_relations
WHERE catalog_id = $1
ORDER BY object_type, relation`

	listAuthzRelationReferencesByCatalogStmt = `
SELECT object_type, relation, ref_type, ref_relation, wildcard, condition, position
FROM zitadel_nextgen.authz_relation_references
WHERE catalog_id = $1
ORDER BY object_type, relation, position`

	listAuthzExpressionEdgesByCatalogStmt = `
SELECT object_type, relation, kind,
       source_object_type, source_relation,
       tupleset_object_type, tupleset_relation, position
FROM zitadel_nextgen.authz_expression_edges
WHERE catalog_id = $1
ORDER BY object_type, relation, position`

	listAuthzRelationClosureByCatalogStmt = `
SELECT from_object_type, from_relation, to_object_type, to_relation, depth
FROM zitadel_nextgen.authz_relation_closure
WHERE catalog_id = $1
ORDER BY from_object_type, from_relation, to_object_type, to_relation`
)

type authzCatalogStatements struct{ statement }

func newAuthzCatalogStatements(client queryExecutor) authzCatalogStatements {
	return authzCatalogStatements{
		statement: statement{
			client: client,
		},
	}
}

// PersistCatalogVersion implements [service.AuthzCatalogStatements].
func (s authzCatalogStatements) PersistCatalogVersion(
	ctx context.Context,
	meta domain.AuthzCatalogVersion,
	mutations compiler.CatalogMutations,
) error {
	authz.BeforePersistCatalogVersion(meta.CatalogKind)
	err := withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		return persistCatalogVersion(ctx, tx, meta, mutations)
	})
	if err != nil {
		return err
	}
	authz.AfterPersistCatalogVersion(meta.CatalogKind, meta.ID)
	return nil
}

func persistCatalogVersion(
	ctx context.Context,
	tx queryExecutor,
	meta domain.AuthzCatalogVersion,
	mutations compiler.CatalogMutations,
) error {
	rows, err := authz.BuildCatalogRows(meta.ID, mutations)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, retireActiveCatalogStmt, meta.CatalogKind.String(), meta.OwnerID); err != nil {
		return wrapError(err)
	}
	if _, err := tx.Exec(ctx, insertAuthzCatalogStmt,
		meta.ID, meta.CatalogKind.String(), meta.OwnerID, meta.Version, meta.SourceHash,
	); err != nil {
		return wrapError(err)
	}

	for _, rel := range rows.Relations {
		if _, err := tx.Exec(ctx, insertAuthzRelationStmt,
			rel.CatalogID, rel.ObjectType, rel.Relation, rel.Kind,
		); err != nil {
			return wrapError(err)
		}
	}

	for _, ref := range rows.References {
		if _, err := tx.Exec(ctx, insertAuthzRelationReferenceStmt,
			ref.CatalogID, ref.ObjectType, ref.Relation,
			ref.RefType, ref.RefRelation, ref.Wildcard, ref.Condition,
			ref.Position,
		); err != nil {
			return wrapError(err)
		}
	}

	for _, edge := range rows.Edges {
		if _, err := tx.Exec(ctx, insertAuthzExpressionEdgeStmt,
			edge.CatalogID, edge.ObjectType, edge.Relation, edge.Kind,
			edge.SourceObjectType, edge.SourceRelation,
			edge.TuplesetObjectType, edge.TuplesetRelation,
			edge.Position,
		); err != nil {
			return wrapError(err)
		}
	}

	for _, impl := range rows.Closure {
		if _, err := tx.Exec(ctx, insertAuthzRelationClosureStmt,
			impl.CatalogID,
			impl.FromObjectType, impl.FromRelation,
			impl.ToObjectType, impl.ToRelation,
			impl.Depth,
		); err != nil {
			return wrapError(err)
		}
	}
	return nil
}

// GetAuthzCatalog implements [service.AuthzCatalogStatements].
func (s authzCatalogStatements) GetAuthzCatalog(ctx context.Context, catalogID string) (*domain.AuthzCatalog, error) {
	rows, err := s.client.Query(ctx, getAuthzCatalogStmt, catalogID)
	if err != nil {
		return nil, wrapError(err)
	}
	catalog, err := pgx.CollectExactlyOneRow(rows, scanAuthzCatalogMeta)
	if err != nil {
		return nil, wrapError(err)
	}

	relRows, err := s.client.Query(ctx, listAuthzRelationsByCatalogStmt, catalogID)
	if err != nil {
		return nil, wrapError(err)
	}
	catalog.Relations, err = pgx.CollectRows(relRows, scanAuthzRelation)
	if err != nil {
		return nil, wrapError(err)
	}

	refRows, err := s.client.Query(ctx, listAuthzRelationReferencesByCatalogStmt, catalogID)
	if err != nil {
		return nil, wrapError(err)
	}
	catalog.References, err = pgx.CollectRows(refRows, scanAuthzRelationReference)
	if err != nil {
		return nil, wrapError(err)
	}

	edgeRows, err := s.client.Query(ctx, listAuthzExpressionEdgesByCatalogStmt, catalogID)
	if err != nil {
		return nil, wrapError(err)
	}
	catalog.Edges, err = pgx.CollectRows(edgeRows, scanAuthzExpressionEdge)
	if err != nil {
		return nil, wrapError(err)
	}

	closureRows, err := s.client.Query(ctx, listAuthzRelationClosureByCatalogStmt, catalogID)
	if err != nil {
		return nil, wrapError(err)
	}
	catalog.Closure, err = pgx.CollectRows(closureRows, scanAuthzRelationClosure)
	if err != nil {
		return nil, wrapError(err)
	}
	return catalog, nil
}

// LoadCatalogMutations implements [service.AuthzCatalogStatements].
func (s authzCatalogStatements) LoadCatalogMutations(ctx context.Context, catalogID string) (compiler.PersistedCatalog, error) {
	catalog, err := s.GetAuthzCatalog(ctx, catalogID)
	if err != nil {
		return compiler.PersistedCatalog{}, err
	}
	return authz.PersistedCatalogFromDomain(catalog)
}

func scanAuthzCatalogMeta(row pgx.CollectableRow) (*domain.AuthzCatalog, error) {
	c := new(domain.AuthzCatalog)
	if err := row.Scan(
		&c.ID, &c.CatalogKind, &c.OwnerID, &c.Version, &c.Status, &c.SourceHash,
	); err != nil {
		return nil, err
	}
	return c, nil
}

func scanAuthzRelation(row pgx.CollectableRow) (domain.AuthzRelation, error) {
	var r domain.AuthzRelation
	err := row.Scan(&r.ObjectType, &r.Relation, &r.Kind)
	return r, err
}

func scanAuthzRelationReference(row pgx.CollectableRow) (domain.AuthzRelationReference, error) {
	var r domain.AuthzRelationReference
	err := row.Scan(
		&r.ObjectType, &r.Relation,
		&r.RefType, &r.RefRelation, &r.Wildcard, &r.Condition, &r.Position,
	)
	return r, err
}

func scanAuthzExpressionEdge(row pgx.CollectableRow) (domain.AuthzExpressionEdge, error) {
	var e domain.AuthzExpressionEdge
	err := row.Scan(
		&e.ObjectType, &e.Relation, &e.Kind,
		&e.SourceObjectType, &e.SourceRelation,
		&e.TuplesetObjectType, &e.TuplesetRelation, &e.Position,
	)
	return e, err
}

func scanAuthzRelationClosure(row pgx.CollectableRow) (domain.AuthzRelationClosure, error) {
	var c domain.AuthzRelationClosure
	err := row.Scan(&c.FromObjectType, &c.FromRelation, &c.ToObjectType, &c.ToRelation, &c.Depth)
	return c, err
}

var _ service.AuthzCatalogStatements = (*authzCatalogStatements)(nil)
