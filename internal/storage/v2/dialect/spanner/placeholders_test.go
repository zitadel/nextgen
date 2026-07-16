package spanner

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConvertPlaceholders(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		sql  string
		want string
	}{
		{
			name: "single placeholder",
			sql:  "SELECT * FROM projects WHERE id = $1",
			want: "SELECT * FROM projects WHERE id = @p1",
		},
		{
			name: "multiple placeholders",
			sql:  "INSERT INTO projects VALUES ($1, $2, $3)",
			want: "INSERT INTO projects VALUES (@p1, @p2, @p3)",
		},
		{
			name: "literal dollar sign preserved",
			sql:  "SELECT '$100' AS price WHERE id = $1",
			want: "SELECT '$100' AS price WHERE id = @p1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, convertPlaceholders(tt.sql))
		})
	}
}

func TestBuildStatementFromPostgresSQL_BindsEachArg(t *testing.T) {
	t.Parallel()

	stmt := buildStatementFromPostgresSQL(
		"INSERT INTO t (a, b, c) VALUES ($1, $2, $3)",
		"one",
		2,
		true,
	)

	assert.Equal(t, "INSERT INTO t (a, b, c) VALUES (@p1, @p2, @p3)", stmt.SQL)
	require.Len(t, stmt.Params, 3)
	assert.Equal(t, "one", stmt.Params["p1"])
	assert.Equal(t, 2, stmt.Params["p2"])
	assert.Equal(t, true, stmt.Params["p3"])
}
