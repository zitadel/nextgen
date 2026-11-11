package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
	v2user "github.com/zitadel/nextgen/internal/storage/user"
)

const (
	searchEntriesTable = "search_entries"

	// searchEntriesQuery is one range of the primary key; see the postgres
	// peer.
	searchEntriesQuery = `SELECT resource_id, search_text, name_start, title, subtitle FROM ` + searchEntriesTable +
		` WHERE project_id = `

	deleteSearchEntryStmt = `DELETE FROM ` + searchEntriesTable +
		` WHERE project_id = ? AND resource_kind = ? AND resource_key = ?`

	insertSearchEntryStmt = `INSERT INTO ` + searchEntriesTable +
		` (project_id, resource_kind, search_text, resource_key, resource_id, name_start, title, subtitle)` +
		` VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
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
	defer rows.Close()
	matches, err := collectRows(rows, func(rows *sql.Rows) (domain.SearchEntryMatch, error) {
		match := domain.SearchEntryMatch{ProjectID: projectID}
		err := rows.Scan(&match.ResourceID, &match.MatchedText, &match.NameStart, &match.Title, &match.Subtitle)
		return match, err
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return matches, nil
}

// writeSearchEntry replaces the entry of its key with entry, inside the
// transaction that writes the resource.
func writeSearchEntry(ctx context.Context, tx queryExecutor, entry domain.SearchEntry) error {
	if err := deleteSearchEntry(ctx, tx, entry.ProjectID, entry.Kind, entry.Key); err != nil {
		return err
	}
	for _, text := range entry.Texts() {
		if _, err := tx.Exec(ctx, insertSearchEntryStmt,
			entry.ProjectID, entry.Kind.String(), text.Text, entry.Key, entry.ResourceID, text.NameStart, entry.Title, entry.Subtitle,
		); err != nil {
			return wrapError(err)
		}
	}
	return nil
}

// deleteSearchEntry removes the entry of a key, for a resource search no
// longer finds.
func deleteSearchEntry(ctx context.Context, tx queryExecutor, projectID string, kind domain.ResourceKind, key string) error {
	_, err := tx.Exec(ctx, deleteSearchEntryStmt, projectID, kind.String(), key)
	return wrapError(err)
}

var _ service.SearchEntryStatements = (*searchEntryStatements)(nil)
