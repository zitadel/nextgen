//go:build sqlite_integration

package sqlite

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// recordingExecutor keeps the users query ListUsers compiles, so the test
// explains the real statement instead of a copy of it.
type recordingExecutor struct {
	queryExecutor
	query string
	args  []any
}

func (r *recordingExecutor) Query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	if strings.HasPrefix(query, userQuery) {
		r.query, r.args = query, args
	}
	return r.queryExecutor.Query(ctx, query, args...)
}

// The unique attribute lookup must seek users by primary key from the
// registry match (#2377). A plan that walks the project's users and probes the
// registry per row is quadratic in the number of users. SQLite plans do not
// depend on statistics, so an empty database shows the production plan.
func TestListUsers_UniqueAttributeLookupPlan(t *testing.T) {
	for _, tt := range []struct {
		name         string
		uniqueTeamID *string
		registry     string
	}{
		{
			name:     "every scope",
			registry: "SEARCH ua USING COVERING INDEX idx_user_unique_attributes_lookup (project_id=? AND key=? AND value_hash=?)",
		},
		{
			name:         "project scope",
			uniqueTeamID: new(""),
			registry:     "SEARCH ua USING INDEX sqlite_autoindex_user_unique_attributes_1 (project_id=? AND team_id=? AND key=? AND value_hash=?)",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rec := &recordingExecutor{queryExecutor: db{sqlDB: testPool.sqlDB}}
			// Unrestricted, as the login lookups run.
			ctx := service.WithAuthzListUnrestricted(t.Context())
			_, err := newUserStatements(rec).ListUsers(ctx,
				&database.ListOptions[domain.UserField]{
					Filter: database.Equal(database.Col(domain.UserFieldProjectID), "proj-plan"),
				},
				service.UserQueryOptions{
					Attributes:           []domain.Attribute{{Key: "email", Value: "alice@example.com"}},
					UniqueAttributesOnly: true,
					UniqueTeamID:         tt.uniqueTeamID,
				},
			)
			require.NoError(t, err)
			require.NotEmpty(t, rec.query)

			rows, err := testPool.sqlDB.QueryContext(t.Context(), "EXPLAIN QUERY PLAN "+rec.query, rec.args...)
			require.NoError(t, err)
			defer rows.Close()
			var plan []string
			for rows.Next() {
				var id, parent, unused int
				var detail string
				require.NoError(t, rows.Scan(&id, &parent, &unused, &detail))
				plan = append(plan, detail)
			}
			require.NoError(t, rows.Err())

			assert.Contains(t, plan, "SEARCH users USING INDEX sqlite_autoindex_users_1 (project_id=? AND id=?)")
			assert.Contains(t, plan, tt.registry)
		})
	}
}
