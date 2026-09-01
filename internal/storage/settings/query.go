package settings

import (
	"cmp"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// VisibleTo restricts the settings table to the leaves requester may resolve
// against, optionally narrowed to paths. It is [domain.SettingOwner.HasAccessTo]
// pushed into SQL: for each owner column a leaf qualifies when the column is
// unset (the leaf is owned further up the hierarchy) or matches the requester
// exactly (the leaf is on the requester's own branch).
//
// Filtering here rather than in the domain is what keeps a sibling team's leaf
// out of a resolution; [domain.Setting.Resolve] applies the same predicate
// again, so an unfiltered caller is safe but reads far more rows than it needs.
func VisibleTo(requester domain.SettingOwner, paths ...string) *database.ListOptions[SettingStorageField] {
	filters := []database.Filter[SettingStorageField]{
		ownerScope(SettingStorageFieldProjectID, requester.ProjectID),
		ownerScope(SettingStorageFieldTeamID, requester.TeamID),
		ownerScope(SettingStorageFieldApplicationID, requester.ApplicationID),
		ownerScope(SettingStorageFieldUserID, requester.UserID),
	}
	if len(paths) > 0 {
		filters = append(filters, anyPath(paths))
	}

	return &database.ListOptions[SettingStorageField]{
		Filter:     database.And(filters...),
		Pagination: database.Page[SettingStorageField]{OrderBy: AncestorFirst()},
	}
}

// AncestorFirst orders leaves so that every leaf precedes its descendants.
// The unset owner id is the empty string, which sorts before any minted id, so
// ordering the owner columns left to right walks the hierarchy top-down without
// needing a level column. Path leads so one scan yields contiguous groups.
func AncestorFirst() database.OrderBy[SettingStorageField] {
	return database.OrderBy[SettingStorageField]{
		Columns: []database.Column[SettingStorageField]{
			database.Col(SettingStorageFieldPath),
			database.Col(SettingStorageFieldProjectID),
			database.Col(SettingStorageFieldTeamID),
			database.Col(SettingStorageFieldApplicationID),
			database.Col(SettingStorageFieldUserID),
		},
		Direction: database.OrderAsc,
	}
}

// ownerScope matches leaves owned at or above requesterID for one column.
// A requester that is itself unset at this level can only see leaves that are
// also unset there, so the disjunction collapses to a single equality.
func ownerScope(field SettingStorageField, requesterID string) database.Filter[SettingStorageField] {
	if requesterID == "" {
		return database.Equal(database.Col(field), "")
	}
	return database.Or(
		database.Equal(database.Col(field), ""),
		database.Equal(database.Col(field), requesterID),
	)
}

// anyPath is an OR over equalities; the database package has no IN filter.
func anyPath(paths []string) database.Filter[SettingStorageField] {
	terms := make([]database.Filter[SettingStorageField], 0, len(paths))
	for _, path := range paths {
		terms = append(terms, database.Equal(database.Col(SettingStorageFieldPath), path))
	}
	return database.Or(terms...)
}

// ToDomain groups scanned rows into one [domain.Setting] per path, ordered by
// path so the result does not depend on scan order. Leaves keep the order they
// were scanned in; with [AncestorFirst] that is already ancestor-first, which
// makes the sort inside Resolve a no-op rather than a reordering.
func ToDomain(rows []*SettingStorage) []*domain.Setting {
	byPath := make(map[string]*domain.Setting, len(rows))
	for _, row := range rows {
		setting, ok := byPath[row.Path]
		if !ok {
			setting = &domain.Setting{ID: row.Path}
			byPath[row.Path] = setting
		}
		setting.Leafs = append(setting.Leafs, LeafToDomain(row))
	}

	settings := make([]*domain.Setting, 0, len(byPath))
	for _, setting := range byPath {
		settings = append(settings, setting)
	}
	slices.SortFunc(settings, func(a, b *domain.Setting) int {
		return cmp.Compare(a.ID, b.ID)
	})
	return settings
}

// LeafToDomain converts one row into the leaf the domain resolves over.
func LeafToDomain(row *SettingStorage) *domain.SettingLeaf {
	return &domain.SettingLeaf{
		Owner: domain.SettingOwner{
			ProjectID:     row.ProjectID,
			TeamID:        row.TeamID,
			ApplicationID: row.ApplicationID,
			UserID:        row.UserID,
		},
		Value:   row.Value,
		IsFinal: row.IsFinal,
	}
}
