// Package settings holds the dialect-independent row shape, query options and
// domain mapping for the settings table.
//
// A settings row is one [domain.SettingLeaf]: a value written at one owner
// level for one path. The hierarchy is encoded positionally, not as a level
// column — an owner id that is unset is stored as the empty string, so a
// project-level leaf carries project_id and leaves team_id, application_id and
// user_id empty. Resolution across those leaves is the domain's job
// ([domain.Setting.Resolve]); storage only narrows the rows a requester is
// allowed to see.
package settings

import (
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// SettingStorage is the flat row shape. It deliberately does not mirror
// [domain.Setting], which groups many leaves under one path; the grouping
// happens in [ToDomain] after the scan.
type SettingStorage struct {
	ProjectID     string
	TeamID        string
	ApplicationID string
	UserID        string
	IsFinal       bool
	Path          string
	Value         any
	CreatedAt     time.Time
	ModifiedAt    time.Time
}

// Schema binds settings filter/order fields. Every owner column is NOT NULL
// with an empty-string default, so none of the keyset null handling applies.
var Schema = database.NewSchema(map[SettingStorageField]database.FieldBinding[SettingStorage]{
	SettingStorageFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(s *SettingStorage) any { return s.ProjectID },
		Coerce:   database.CoerceString,
	},
	SettingStorageFieldTeamID: {
		SQLName:  "team_id",
		Accessor: func(s *SettingStorage) any { return s.TeamID },
		Coerce:   database.CoerceString,
	},
	SettingStorageFieldApplicationID: {
		SQLName:  "application_id",
		Accessor: func(s *SettingStorage) any { return s.ApplicationID },
		Coerce:   database.CoerceString,
	},
	SettingStorageFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(s *SettingStorage) any { return s.UserID },
		Coerce:   database.CoerceString,
	},
	SettingStorageFieldIsFinal: {
		SQLName:  "is_final",
		Accessor: func(s *SettingStorage) any { return s.IsFinal },
		Coerce:   database.CoerceBool,
	},
	SettingStorageFieldValue: {
		SQLName:  "value",
		Accessor: func(s *SettingStorage) any { return s.Value },
		Coerce:   database.CoerceJSON[any],
	},
	SettingStorageFieldPath: {
		SQLName:  "path",
		Accessor: func(s *SettingStorage) any { return s.Path },
		Coerce:   database.CoerceString,
	},
	SettingStorageFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(s *SettingStorage) any { return s.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	SettingStorageFieldModifiedAt: {
		SQLName:  "modified_at",
		Accessor: func(s *SettingStorage) any { return s.ModifiedAt },
		Coerce:   database.CoerceTime,
	},
})

type SettingStorageField uint8

const (
	SettingStorageFieldProjectID SettingStorageField = iota
	SettingStorageFieldTeamID
	SettingStorageFieldApplicationID
	SettingStorageFieldUserID
	SettingStorageFieldIsFinal
	SettingStorageFieldValue
	SettingStorageFieldPath
	SettingStorageFieldCreatedAt
	SettingStorageFieldModifiedAt
)
