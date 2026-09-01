package settings

import (
	"github.com/zitadel/nextgen/internal/storage/database"
)

type SettingStorage struct {
	ProjectID     string
	TeamID        string
	ApplicationID string
	UserID        string
	IsFinal       bool
	Path          string
	Value         any
}

var schema = database.NewSchema(map[SettingStorageField]database.FieldBinding[SettingStorage]{
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
		SQLName:  "team_id",
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
		Coerce:   database.CoerceJSON,
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
)
