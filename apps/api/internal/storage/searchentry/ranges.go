// Package searchentry holds what the dialects share about reading search
// entries across several projects (ADR 087 §7).
package searchentry

import "github.com/zitadel/nextgen/internal/domain"

// Ranges are the ranges a read across projects returns, one per pair of
// projectIDs and kinds, projects first: the order its arms are numbered in.
func Ranges(projectIDs []string, kinds []domain.ResourceKind) []domain.SearchEntryRange {
	ranges := make([]domain.SearchEntryRange, 0, len(projectIDs)*len(kinds))
	for _, projectID := range projectIDs {
		for _, kind := range kinds {
			ranges = append(ranges, domain.SearchEntryRange{ProjectID: projectID, Kind: kind})
		}
	}
	return ranges
}

// MarkFull sets Full on each range whose arm read limit rows.
func MarkFull(ranges []domain.SearchEntryRange, read []int, limit int) []domain.SearchEntryRange {
	for i := range ranges {
		ranges[i].Full = limit > 0 && read[i] == limit
	}
	return ranges
}

// ArmKey names one range of a read across projects by what its rows carry.
type ArmKey struct {
	ProjectID string
	Kind      domain.ResourceKind
}

// Arms indexes ranges by the project and kind each reads.
func Arms(ranges []domain.SearchEntryRange) map[ArmKey]int {
	arms := make(map[ArmKey]int, len(ranges))
	for i, r := range ranges {
		arms[ArmKey{ProjectID: r.ProjectID, Kind: r.Kind}] = i
	}
	return arms
}
