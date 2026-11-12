package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
	"github.com/zitadel/nextgen/internal/storage/searchentry"
	v2user "github.com/zitadel/nextgen/internal/storage/user"
)

const (
	searchEntriesTable = "search_entries"

	// searchEntriesQuery reads one range of the primary key, its last column
	// whether the caller may see the row; see the postgres peer. The key is the
	// table's own, so the read needs no index hint.
	searchEntriesQuery = `SELECT resource_id, search_text, name_start, title, subtitle, `

	// searchEntriesBatchArm opens one range of a read across projects, which
	// carries the project and kind its rows answer for.
	searchEntriesBatchArm = `(SELECT project_id, resource_kind, resource_id, search_text, name_start, title, subtitle FROM ` + searchEntriesTable +
		` WHERE project_id = `

	deleteSearchEntryStmt = `DELETE FROM ` + searchEntriesTable +
		` WHERE project_id = @p1 AND resource_kind = @p2 AND resource_key = @p3`

	// INSERT OR UPDATE is Spanner's upsert: a write that finds the text already
	// there takes it over; see the postgres peer.
	upsertSearchEntryStmt = `INSERT OR UPDATE INTO ` + searchEntriesTable +
		` (project_id, resource_kind, search_text, resource_key, resource_id, name_start, title, subtitle) VALUES `
)

type searchEntryStatements struct{ statement }

func newSearchEntryStatements(db queryExecutor) searchEntryStatements {
	return searchEntryStatements{statement: statement{db: db}}
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
		authz.WriteListAuthzExistsPredicate(&compiler, spannerAuthzEnv(), searchEntriesTable+".resource_id", f)
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

	type row struct {
		match   domain.SearchEntryMatch
		visible bool
	}
	var read []row
	err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		read, err = collectRows(iter, func(r *spanner.Row) (row, error) {
			out := row{match: domain.SearchEntryMatch{ProjectID: projectID}}
			err := r.Columns(&out.match.ResourceID, &out.match.MatchedText, &out.match.NameStart, &out.match.Title, &out.match.Subtitle, &out.visible)
			return out, err
		})
		return err
	})
	if err != nil {
		return nil, false, err
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
// ORDER BY and LIMIT; see the postgres peer.
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
	arms := searchentry.Arms(ranges)
	read := make([]int, len(ranges))
	err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		return iter.Do(func(row *spanner.Row) error {
			var kind string
			var match domain.SearchEntryMatch
			if err := row.Columns(&match.ProjectID, &kind, &match.ResourceID, &match.MatchedText, &match.NameStart, &match.Title, &match.Subtitle); err != nil {
				return err
			}
			arm := arms[searchentry.ArmKey{ProjectID: match.ProjectID, Kind: domain.ResourceKind(kind)}]
			ranges[arm].Matches = append(ranges[arm].Matches, match)
			read[arm]++
			return nil
		})
	})
	if err != nil {
		return nil, err
	}
	return searchentry.MarkFull(ranges, read, limit), nil
}

// writeSearchEntry replaces the entry of its key with entry, inside the
// transaction that writes the resource: one delete and one upsert of all its
// texts.
func writeSearchEntry(ctx context.Context, tx queryExecutor, entry domain.SearchEntry) error {
	if err := deleteSearchEntry(ctx, tx, entry.ProjectID, entry.Kind, entry.Key); err != nil {
		return err
	}
	texts := entry.Texts()
	if len(texts) == 0 {
		return nil
	}
	var compiler statementCompiler
	compiler.WriteString(upsertSearchEntryStmt)
	for i, text := range texts {
		if i > 0 {
			compiler.WriteString(", ")
		}
		compiler.WriteString("(")
		for j, value := range []any{entry.ProjectID, entry.Kind.String(), text.Text, entry.Key, entry.ResourceID, text.NameStart, entry.Title, entry.Subtitle} {
			if j > 0 {
				compiler.WriteString(", ")
			}
			compiler.WriteArg(value)
		}
		compiler.WriteString(")")
	}
	_, err := tx.Update(ctx, compiler.statement())
	return wrapError(err)
}

// deleteSearchEntry removes the entry of a key, for a resource search no
// longer finds.
func deleteSearchEntry(ctx context.Context, tx queryExecutor, projectID string, kind domain.ResourceKind, key string) error {
	_, err := tx.Update(ctx, buildStatement(deleteSearchEntryStmt, projectID, kind.String(), key).statement())
	return wrapError(err)
}

var _ service.SearchEntryStatements = (*searchEntryStatements)(nil)
