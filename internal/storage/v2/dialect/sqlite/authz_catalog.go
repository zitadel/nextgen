package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/authz"
)

const (
	retireActiveCatalogStmt = `
UPDATE authz_catalogs
SET status = 'retired'
WHERE catalog_kind = ? AND owner_id = ? AND status = 'active'`

	insertAuthzCatalogStmt = `
INSERT INTO authz_catalogs (
    id, catalog_kind, owner_id, version, status, source_hash, created_at
) VALUES (?, ?, ?, ?, 'active', ?, ?)`

	insertAuthzRelationStmt = `
INSERT INTO authz_relations (
    catalog_id, object_type, relation, kind
) VALUES (?, ?, ?, ?)`

	insertAuthzRelationReferenceStmt = `
INSERT INTO authz_relation_references (
    catalog_id, object_type, relation, ref_type, ref_relation, wildcard, condition, position
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

	insertAuthzExpressionEdgeStmt = `
INSERT INTO authz_expression_edges (
    catalog_id, object_type, relation, kind,
    source_object_type, source_relation,
    tupleset_object_type, tupleset_relation, position
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

	insertAuthzRelationClosureStmt = `
INSERT INTO authz_relation_closure (
    catalog_id, from_object_type, from_relation, to_object_type, to_relation, depth
) VALUES (?, ?, ?, ?, ?, ?)`

	getAuthzCatalogStmt = `
SELECT id, catalog_kind, owner_id, version, status, source_hash
FROM authz_catalogs
WHERE id = ?`

	listAuthzRelationsByCatalogStmt = `
SELECT object_type, relation, kind
FROM authz_relations
WHERE catalog_id = ?
ORDER BY object_type, relation`

	listAuthzRelationReferencesByCatalogStmt = `
SELECT object_type, relation, ref_type, ref_relation, wildcard, condition, position
FROM authz_relation_references
WHERE catalog_id = ?
ORDER BY object_type, relation, position`

	listAuthzExpressionEdgesByCatalogStmt = `
SELECT object_type, relation, kind,
       source_object_type, source_relation,
       tupleset_object_type, tupleset_relation, position
FROM authz_expression_edges
WHERE catalog_id = ?
ORDER BY object_type, relation, position`

	listAuthzRelationClosureByCatalogStmt = `
SELECT from_object_type, from_relation, to_object_type, to_relation, depth
FROM authz_relation_closure
WHERE catalog_id = ?
ORDER BY from_object_type, from_relation, to_object_type, to_relation`
)

type authzCatalogStatements struct{ statement }

func newAuthzCatalogStatements(client queryExecutor) authzCatalogStatements {
	return authzCatalogStatements{statement: statement{client: client}}
}

// PersistCatalogVersion implements [service.AuthzCatalogStatements].
func (s authzCatalogStatements) PersistCatalogVersion(
	ctx context.Context,
	meta domain.AuthzCatalogVersion,
	mutations compiler.CatalogMutations,
) error {
	return withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		return persistCatalogVersion(ctx, tx, meta, mutations)
	})
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
		meta.ID, meta.CatalogKind.String(), meta.OwnerID, meta.Version, meta.SourceHash, nowUnixNano(),
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
		wildcard := 0
		if ref.Wildcard {
			wildcard = 1
		}
		if _, err := tx.Exec(ctx, insertAuthzRelationReferenceStmt,
			ref.CatalogID, ref.ObjectType, ref.Relation,
			ref.RefType, ref.RefRelation, wildcard, ref.Condition,
			ref.Position,
		); err != nil {
			return wrapError(err)
		}
	}

	for _, edge := range rows.Edges {
		if _, err := tx.Exec(ctx, insertAuthzExpressionEdgeStmt,
			edge.CatalogID, edge.ObjectType, edge.Relation, edge.Kind,
			nullableString(edge.SourceObjectType), nullableString(edge.SourceRelation),
			nullableString(edge.TuplesetObjectType), nullableString(edge.TuplesetRelation),
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
	defer rows.Close()
	catalog, err := collectExactlyOneRow(rows, scanAuthzCatalogMeta)
	if err != nil {
		return nil, wrapError(err)
	}

	relRows, err := s.client.Query(ctx, listAuthzRelationsByCatalogStmt, catalogID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer relRows.Close()
	catalog.Relations, err = collectRows(relRows, scanAuthzRelation)
	if err != nil {
		return nil, wrapError(err)
	}

	refRows, err := s.client.Query(ctx, listAuthzRelationReferencesByCatalogStmt, catalogID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer refRows.Close()
	catalog.References, err = collectRows(refRows, scanAuthzRelationReference)
	if err != nil {
		return nil, wrapError(err)
	}

	edgeRows, err := s.client.Query(ctx, listAuthzExpressionEdgesByCatalogStmt, catalogID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer edgeRows.Close()
	catalog.Edges, err = collectRows(edgeRows, scanAuthzExpressionEdge)
	if err != nil {
		return nil, wrapError(err)
	}

	closureRows, err := s.client.Query(ctx, listAuthzRelationClosureByCatalogStmt, catalogID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer closureRows.Close()
	catalog.Closure, err = collectRows(closureRows, scanAuthzRelationClosure)
	if err != nil {
		return nil, wrapError(err)
	}
	return catalog, nil
}

func scanAuthzCatalogMeta(rows *sql.Rows) (*domain.AuthzCatalog, error) {
	c := new(domain.AuthzCatalog)
	if err := rows.Scan(
		&c.ID, &c.CatalogKind, &c.OwnerID, &c.Version, &c.Status, &c.SourceHash,
	); err != nil {
		return nil, err
	}
	return c, nil
}

func scanAuthzRelation(rows *sql.Rows) (domain.AuthzRelation, error) {
	var r domain.AuthzRelation
	err := rows.Scan(&r.ObjectType, &r.Relation, &r.Kind)
	return r, err
}

func scanAuthzRelationReference(rows *sql.Rows) (domain.AuthzRelationReference, error) {
	var r domain.AuthzRelationReference
	var wildcard int
	err := rows.Scan(
		&r.ObjectType, &r.Relation,
		&r.RefType, &r.RefRelation, &wildcard, &r.Condition, &r.Position,
	)
	r.Wildcard = wildcard != 0
	return r, err
}

func scanAuthzExpressionEdge(rows *sql.Rows) (domain.AuthzExpressionEdge, error) {
	var e domain.AuthzExpressionEdge
	err := rows.Scan(
		&e.ObjectType, &e.Relation, &e.Kind,
		&e.SourceObjectType, &e.SourceRelation,
		&e.TuplesetObjectType, &e.TuplesetRelation, &e.Position,
	)
	return e, err
}

func scanAuthzRelationClosure(rows *sql.Rows) (domain.AuthzRelationClosure, error) {
	var c domain.AuthzRelationClosure
	err := rows.Scan(&c.FromObjectType, &c.FromRelation, &c.ToObjectType, &c.ToRelation, &c.Depth)
	return c, err
}

func nullableString(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

var _ service.AuthzCatalogStatements = (*authzCatalogStatements)(nil)
