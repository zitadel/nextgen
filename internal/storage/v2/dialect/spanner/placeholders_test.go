package spanner

import (
	"testing"

	"github.com/stretchr/testify/assert"
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
