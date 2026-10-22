package schematest_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/schematest"
)

var schema = database.NewSchema(map[domain.SessionField]database.FieldBinding[domain.Session]{
	domain.SessionFieldID: {
		SQLName:  "s.id",
		Accessor: func(s *domain.Session) any { return s.ID },
		Coerce:   database.CoerceString,
	},
	domain.SessionFieldUserID: {
		SQLName:  "s.user_id",
		Accessor: func(s *domain.Session) any { return database.NullableValue(s.UserID) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
})

func TestColumnsStripsAlias(t *testing.T) {
	assert.Equal(t, []schematest.ColumnNullability{
		{Table: "sessions", Column: "id"},
		{Table: "sessions", Column: "user_id", Nullable: true},
	}, schematest.Columns("sessions", schema))
}

func TestJoinColumnsResolvesAlias(t *testing.T) {
	cols, err := schematest.JoinColumns(map[string]string{"s": "sessions"}, schema)
	require.NoError(t, err)
	assert.Equal(t, []schematest.ColumnNullability{
		{Table: "sessions", Column: "id"},
		{Table: "sessions", Column: "user_id", Nullable: true},
	}, cols)

	_, err = schematest.JoinColumns(map[string]string{"x": "sessions"}, schema)
	assert.ErrorContains(t, err, `no table for alias "s"`)
}
