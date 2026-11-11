package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// SearchEntriesInput asks for the resources of one kind in one project that a
// text starts a name of (ADR 087 §4).
type SearchEntriesInput struct {
	Kind      domain.ResourceKind
	ProjectID string
	Query     string
	Limit     int
}

// SearchEntriesOutput holds one match per resource the caller may see, its
// best, in the order of the read. More says the read stopped at its limit, so
// more resources may match than it holds.
type SearchEntriesOutput struct {
	Items []domain.SearchEntryMatch
	More  bool
}

// searchEntryRowsPerResult is how many rows a search reads per result it may
// return: a resource is one row per text of it the text starts, and few names
// repeat a word.
const searchEntryRowsPerResult = 4

// SearchEntries reads the resources of in.Kind in in.ProjectID found by
// in.Query from their search entries: one range of one index, at most
// [domain.SearchReadLimit] rows, whatever the size of the project or the reach
// of the caller's grant. ctx carries the list gate of the kind, as for its
// list.
func SearchEntries(ctx context.Context, stmts SearchEntryStatements, in SearchEntriesInput) (_ *SearchEntriesOutput, err error) {
	ctx, end := startSpan(ctx, "Search.SearchEntries")
	defer end(&err)

	term, ok := domain.SearchText(in.Query)
	if !ok {
		return &SearchEntriesOutput{}, nil
	}
	rows := min((max(in.Limit, 1)+1)*searchEntryRowsPerResult, domain.SearchReadLimit)
	matches, full, err := stmts.SearchEntries(ctx, in.Kind, in.ProjectID, term, rows)
	if err != nil {
		return nil, mapListError(err, "failed to search the database")
	}

	// A full read may have more beyond it, whether or not the caller's grant
	// let every row of it through.
	out := &SearchEntriesOutput{More: full}
	index := make(map[string]int, len(matches))
	for _, match := range matches {
		i, seen := index[match.ResourceID]
		if !seen {
			index[match.ResourceID] = len(out.Items)
			out.Items = append(out.Items, match)
			continue
		}
		if match.Rank(term) < out.Items[i].Rank(term) {
			out.Items[i] = match
		}
	}
	return out, nil
}
