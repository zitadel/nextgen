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
	return &SearchEntriesOutput{Items: bestEntryMatches(matches, term), More: full}, nil
}

// SearchEntriesInProjectsInput asks for the resources of several kinds in
// several projects that a text starts a name of.
type SearchEntriesInProjectsInput struct {
	ProjectIDs []string
	Kinds      []domain.ResourceKind
	Query      string
	// Limit is the most results a kind may return from all the projects.
	Limit int
}

// SearchEntriesInProjects is SearchEntries for every kind in every project of
// in, in one statement: each project's range of each kind read to the same
// number of rows as SearchEntries reads. It is for projects whose list gate
// allows the caller every row, decided before the call (ctx carries the
// one-shot skip). The output holds one match per resource per kind, its best;
// More says a project's range of that kind held as many rows as were read.
func SearchEntriesInProjects(ctx context.Context, stmts SearchEntryStatements, in SearchEntriesInProjectsInput) (_ map[domain.ResourceKind]*SearchEntriesOutput, err error) {
	ctx, end := startSpan(ctx, "Search.SearchEntriesInProjects")
	defer end(&err)

	out := make(map[domain.ResourceKind]*SearchEntriesOutput, len(in.Kinds))
	for _, kind := range in.Kinds {
		out[kind] = &SearchEntriesOutput{}
	}
	term, ok := domain.SearchText(in.Query)
	if !ok || len(in.ProjectIDs) == 0 || len(in.Kinds) == 0 {
		return out, nil
	}
	rows := min((max(in.Limit, 1)+1)*searchEntryRowsPerResult, domain.SearchReadLimit)
	ranges, err := stmts.SearchEntriesInProjects(ctx, in.ProjectIDs, in.Kinds, term, rows)
	if err != nil {
		return nil, mapListError(err, "failed to search the database")
	}
	for _, r := range ranges {
		kind := out[r.Kind]
		if kind == nil {
			continue
		}
		kind.More = kind.More || r.Full
		kind.Items = append(kind.Items, bestEntryMatches(r.Matches, term)...)
	}
	return out, nil
}

// bestEntryMatches keeps each resource's best match, in the order of the read.
func bestEntryMatches(matches []domain.SearchEntryMatch, term string) []domain.SearchEntryMatch {
	var best []domain.SearchEntryMatch
	index := make(map[string]int, len(matches))
	for _, match := range matches {
		i, seen := index[match.ResourceID]
		if !seen {
			index[match.ResourceID] = len(best)
			best = append(best, match)
			continue
		}
		if match.Rank(term) < best[i].Rank(term) {
			best[i] = match
		}
	}
	return best
}
