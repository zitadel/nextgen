package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
	v2user "github.com/zitadel/nextgen/internal/storage/user"
)

const (
	searchEntriesTable = "zitadel_nextgen.search_entries"

	// searchEntriesQuery is one range of the primary key: the kind's texts in
	// the project from the prefix on, read in key order so LIMIT stops it.
	searchEntriesQuery = `SELECT resource_id, search_text, name_start, title, subtitle FROM ` + searchEntriesTable +
		` WHERE project_id = `

	deleteSearchEntryStmt = `DELETE FROM ` + searchEntriesTable +
		` WHERE project_id = $1 AND resource_kind = $2 AND resource_key = $3`

	insertSearchEntryStmt = `INSERT INTO ` + searchEntriesTable +
		` (project_id, resource_kind, search_text, resource_key, resource_id, name_start, title, subtitle)` +
		` SELECT $1, $2, t.text, $3, $4, t.name_start, $5, $6 FROM unnest($7::text[], $8::boolean[]) AS t(text, name_start)`
)

type searchEntryStatements struct{ statement }

func newSearchEntryStatements(client queryExecutor) searchEntryStatements {
	return searchEntryStatements{statement: statement{client: client}}
}

// SearchEntries implements [service.SearchEntryStatements].
func (s searchEntryStatements) SearchEntries(ctx context.Context, kind domain.ResourceKind, projectID, prefix string, limit int) ([]domain.SearchEntryMatch, error) {
	if err := authz.RequireManagementListFilter(ctx); err != nil {
		return nil, err
	}
	lower, upper, bounded := v2user.SearchBounds(prefix)

	var compiler statementCompiler
	compiler.WriteString(searchEntriesQuery)
	compiler.WriteArg(projectID)
	compiler.WriteString(" AND resource_kind = ")
	compiler.WriteArg(kind.String())
	compiler.WriteString(" AND search_text >= ")
	compiler.WriteArg(lower)
	if bounded {
		compiler.WriteString(" AND search_text < ")
		compiler.WriteArg(upper)
	}
	hasWhere := true
	maybeWriteAuthzListPredicate(ctx, &compiler, &hasWhere, searchEntriesTable, "resource_id")
	compiler.WriteString(" ORDER BY search_text, resource_key")
	compileLimit(&compiler, uint32(limit))

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	matches, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.SearchEntryMatch, error) {
		match := domain.SearchEntryMatch{ProjectID: projectID}
		err := row.Scan(&match.ResourceID, &match.MatchedText, &match.NameStart, &match.Title, &match.Subtitle)
		return match, err
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return matches, nil
}

// writeSearchEntry replaces the entry of its key with entry. It runs inside
// the transaction that writes the resource, so it is one of that statement's
// writes.
func writeSearchEntry(ctx context.Context, tx queryExecutor, entry domain.SearchEntry) error {
	if err := deleteSearchEntry(ctx, tx, entry.ProjectID, entry.Kind, entry.Key); err != nil {
		return err
	}
	texts := entry.Texts()
	if len(texts) == 0 {
		return nil
	}
	values := make([]string, len(texts))
	nameStarts := make([]bool, len(texts))
	for i, text := range texts {
		values[i], nameStarts[i] = text.Text, text.NameStart
	}
	_, err := tx.Exec(ctx, insertSearchEntryStmt,
		entry.ProjectID, entry.Kind.String(), entry.Key, entry.ResourceID, entry.Title, entry.Subtitle, values, nameStarts)
	return wrapError(err)
}

// deleteSearchEntry removes the entry of a key, for a resource search no
// longer finds.
func deleteSearchEntry(ctx context.Context, tx queryExecutor, projectID string, kind domain.ResourceKind, key string) error {
	_, err := tx.Exec(ctx, deleteSearchEntryStmt, projectID, kind.String(), key)
	return wrapError(err)
}

var _ service.SearchEntryStatements = (*searchEntryStatements)(nil)
