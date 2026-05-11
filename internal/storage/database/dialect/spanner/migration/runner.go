package migration

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Migrate executes all registered migrations against the Spanner PGAdapter connection.
// DDL statements must be issued one at a time; they cannot be batched.
func Migrate(ctx context.Context, conn *pgx.Conn) error {
	for _, m := range Migrations {
		for _, stmt := range splitStatements(m.Up) {
			if _, err := conn.Exec(ctx, stmt); err != nil {
				return err
			}
		}
	}
	return nil
}

// splitStatements splits a DDL string on semicolons, strips comment-only lines,
// and drops empty entries.
func splitStatements(ddl string) []string {
	parts := strings.Split(ddl, ";")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		var lines []string
		for _, line := range strings.Split(p, "\n") {
			if !strings.HasPrefix(strings.TrimSpace(line), "--") {
				lines = append(lines, line)
			}
		}
		stmt := strings.TrimSpace(strings.Join(lines, "\n"))
		if stmt != "" {
			result = append(result, stmt)
		}
	}
	return result
}
