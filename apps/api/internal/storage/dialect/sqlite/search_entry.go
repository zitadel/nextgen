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

	// searchEntriesQuery reads one range of the primary key, its last column
	// whether the caller may see the row; see the postgres peer.
	searchEntriesQuery = `SELECT resource_id, search_text, name_start, title, subtitle, `

	deleteSearchEntryStmt = `DELETE FROM ` + searchEntriesTable +
		` WHERE project_id = ? AND resource_kind = ? AND resource_key = ?`

	// An upsert, as in the postgres peer: a write that finds the text already
	// there takes it over.
	upsertSearchEntryStmt = `INSERT INTO ` + searchEntriesTable +
		` (project_id, resource_kind, search_text, resource_key, resource_id, name_start, title, subtitle)` +
		` VALUES (?, ?, ?, ?, ?, ?, ?, ?)` +
		` ON CONFLICT (project_id, resource_kind, search_text, resource_key) DO UPDATE SET` +
		` resource_id = excluded.resource_id, name_start = excluded.name_start,` +
		` title = excluded.title, subtitle = excluded.subtitle`
)

type searchEntryStatements struct{ statement }

func newSearchEntryStatements(client queryExecutor) searchEntryStatements {
	return searchEntryStatements{statement: statement{client: client}}
}

// SearchEntries implements [service.SearchEntryStatements].
func (s searchEntryStatements) SearchEntries(ctx context.Context, kind domain.ResourceKind, projectID, prefix string, limit int) ([]domain.SearchEntryMatch, bool, error) {
	if err := authz.RequireManagementListFilter(ctx); err != nil {
		return nil, false, err
	}
	lower, upper, bounded := v2user.SearchBounds(prefix)

	var compiler statementCompiler
	compiler.WriteString(searchEntriesQuery)
	if f, ok := service.AuthzListFilterFromContext(ctx); ok {
		authz.WriteListAuthzExistsPredicate(&compiler, sqliteAuthzEnv(), searchEntriesTable+".resource_id", f)
	} else {
		compiler.WriteString("1")
	}
	compiler.WriteString(" FROM " + searchEntriesTable + " WHERE project_id = ")
	compiler.WriteArg(projectID)
	compiler.WriteString(" AND resource_kind = ")
	compiler.WriteArg(kind.String())
	compiler.WriteString(" AND search_text >= ")
	compiler.WriteArg(lower)
	if bounded {
		compiler.WriteString(" AND search_text < ")
		compiler.WriteArg(upper)
	}
	compiler.WriteString(" ORDER BY search_text, resource_key")
	compileLimit(&compiler, uint32(limit))

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, false, wrapError(err)
	}
	defer rows.Close()
	type row struct {
		match   domain.SearchEntryMatch
		visible bool
	}
	read, err := collectRows(rows, func(rows *sql.Rows) (row, error) {
		out := row{match: domain.SearchEntryMatch{ProjectID: projectID}}
		err := rows.Scan(&out.match.ResourceID, &out.match.MatchedText, &out.match.NameStart, &out.match.Title, &out.match.Subtitle, &out.visible)
		return out, err
	})
	if err != nil {
		return nil, false, wrapError(err)
	}
	matches := make([]domain.SearchEntryMatch, 0, len(read))
	for _, r := range read {
		if r.visible {
			matches = append(matches, r.match)
		}
	}
	return matches, limit > 0 && len(read) == limit, nil
}

// writeSearchEntry replaces the entry of its key with entry, inside the
// transaction that writes the resource.
func writeSearchEntry(ctx context.Context, tx queryExecutor, entry domain.SearchEntry) error {
	if err := deleteSearchEntry(ctx, tx, entry.ProjectID, entry.Kind, entry.Key); err != nil {
		return err
	}
	for _, text := range entry.Texts() {
		if _, err := tx.Exec(ctx, upsertSearchEntryStmt,
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
