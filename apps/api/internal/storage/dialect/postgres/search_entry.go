package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
	"github.com/zitadel/nextgen/internal/storage/searchentry"
	v2user "github.com/zitadel/nextgen/internal/storage/user"
)

const (
	searchEntriesTable = "zitadel_nextgen.search_entries"

	// searchEntriesQuery reads one range of the primary key: the kind's texts in
	// the project from the prefix on, in key order, so LIMIT stops it. Its last
	// column says whether the caller may see the row. It is a column, not a
	// condition, so a narrow grant drops rows from the page instead of making
	// the read walk the range for rows it may see.
	searchEntriesQuery = `SELECT resource_id, search_text, name_start, title, subtitle, `

	// searchEntriesBatchArm opens one range of a read across projects, which
	// carries the project and kind its rows answer for.
	searchEntriesBatchArm = `(SELECT project_id, resource_kind, resource_id, search_text, name_start, title, subtitle FROM ` + searchEntriesTable +
		` WHERE project_id = `

	deleteSearchEntryStmt = `DELETE FROM ` + searchEntriesTable +
		` WHERE project_id = $1 AND resource_kind = $2 AND resource_key = $3`

	// Two transactions writing a newer revision of one key at once each delete
	// what they can see and then write the same texts: the second to commit
	// takes the rows over instead of failing its create.
	upsertSearchEntryStmt = `INSERT INTO ` + searchEntriesTable +
		` (project_id, resource_kind, search_text, resource_key, resource_id, name_start, title, subtitle)` +
		` SELECT $1, $2, t.text, $3, $4, t.name_start, $5, $6 FROM unnest($7::text[], $8::boolean[]) AS t(text, name_start)` +
		` ON CONFLICT (project_id, resource_kind, search_text, resource_key) DO UPDATE SET` +
		` resource_id = EXCLUDED.resource_id, name_start = EXCLUDED.name_start,` +
		` title = EXCLUDED.title, subtitle = EXCLUDED.subtitle`
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
		authz.WriteListAuthzExistsPredicate(&compiler, postgresAuthzEnv(), searchEntriesTable+".resource_id", f)
	} else {
		compiler.WriteString("TRUE")
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
	type row struct {
		match   domain.SearchEntryMatch
		visible bool
	}
	read, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
		out := row{match: domain.SearchEntryMatch{ProjectID: projectID}}
		err := r.Scan(&out.match.ResourceID, &out.match.MatchedText, &out.match.NameStart, &out.match.Title, &out.match.Subtitle, &out.visible)
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

// SearchEntriesInProjects implements [service.SearchEntryStatements]: one
// UNION ALL of the ranges SearchEntries reads, each in parentheses with its own
// ORDER BY and LIMIT, so each is still one range of the key read to the limit.
func (s searchEntryStatements) SearchEntriesInProjects(ctx context.Context, projectIDs []string, kinds []domain.ResourceKind, prefix string, limit int) ([]domain.SearchEntryRange, error) {
	if err := authz.RequireUnfilteredBatch(ctx); err != nil {
		return nil, err
	}
	ranges := searchentry.Ranges(projectIDs, kinds)
	if len(ranges) == 0 {
		return ranges, nil
	}
	lower, upper, bounded := v2user.SearchBounds(prefix)
	var compiler statementCompiler
	for i, r := range ranges {
		if i > 0 {
			compiler.WriteString(" UNION ALL ")
		}
		compiler.WriteString(searchEntriesBatchArm)
		compiler.WriteArg(r.ProjectID)
		compiler.WriteString(" AND resource_kind = ")
		compiler.WriteArg(r.Kind.String())
		compiler.WriteString(" AND search_text >= ")
		compiler.WriteArg(lower)
		if bounded {
			compiler.WriteString(" AND search_text < ")
			compiler.WriteArg(upper)
		}
		compiler.WriteString(" ORDER BY search_text, resource_key")
		compileLimit(&compiler, uint32(limit))
		compiler.WriteString(")")
	}
	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	arms := searchentry.Arms(ranges)
	read := make([]int, len(ranges))
	for rows.Next() {
		var kind string
		var match domain.SearchEntryMatch
		if err := rows.Scan(&match.ProjectID, &kind, &match.ResourceID, &match.MatchedText, &match.NameStart, &match.Title, &match.Subtitle); err != nil {
			return nil, wrapError(err)
		}
		arm := arms[searchentry.ArmKey{ProjectID: match.ProjectID, Kind: domain.ResourceKind(kind)}]
		ranges[arm].Matches = append(ranges[arm].Matches, match)
		read[arm]++
	}
	if err := rows.Err(); err != nil {
		return nil, wrapError(err)
	}
	return searchentry.MarkFull(ranges, read, limit), nil
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
	_, err := tx.Exec(ctx, upsertSearchEntryStmt,
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
