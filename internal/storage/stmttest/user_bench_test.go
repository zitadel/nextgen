//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const benchUsers = 10_000

// Times the identifier lookup and a user delete in a project of benchUsers
// users, each holding a token (#2377). Evidence for the indexes, not a gate:
// the SQLite plan test in the dialect package is the regression check. On
// Postgres the lookup runs before the seeded rows are analyzed, so it starts
// from users and is slower than with statistics. A project that gains users
// quickly in an analyzed table has the same window until its project_id
// reaches the column statistics.
func BenchmarkUserStatements_10kUsers(b *testing.B) {
	for _, d := range dialects {
		b.Run(d.name, func(b *testing.B) {
			if d.name == "spanner" {
				b.Skip("seeding 10k users on the emulator is too slow")
			}
			ctx := b.Context()
			projectID, schemaURL := ensureUserTestProject(b, d.stmts)

			benchUserID := func(i int) string { return fmt.Sprintf("usr-bench-%05d", i) }
			createUser := func(b *testing.B, i int) string {
				userID := benchUserID(i)
				require.NoError(b, d.stmts.CreateUser(ctx, newTestUser(b, projectID, schemaURL, userID, userID+"@example.com", userID)))
				oidcSession := "oidc-" + userID
				require.NoError(b, d.stmts.CreateToken(ctx, &domain.Token{
					ProjectID:     projectID,
					UserID:        userID,
					Type:          domain.TokenTypeOIDCAccessToken,
					OIDCSessionID: &oidcSession,
					Scope:         []string{"openid"},
				}))
				return userID
			}
			for i := range benchUsers {
				createUser(b, i)
			}

			b.Run("lookup", func(b *testing.B) {
				// The identifier step's filter, as GetByAttributes builds it.
				loginFilter := database.And(
					database.Equal(database.Col(domain.UserFieldProjectID), projectID),
					database.Or(database.Equal(database.Col(domain.UserFieldSchemaURL), schemaURL)),
				)
				opts := service.UserQueryOptions{
					Attributes:           []domain.Attribute{{Key: "email", Value: benchUserID(benchUsers/2) + "@example.com"}},
					UniqueAttributesOnly: true,
				}
				for b.Loop() {
					_, err := d.stmts.GetUser(ctx, loginFilter, opts)
					require.NoError(b, err)
				}
			})

			b.Run("delete", func(b *testing.B) {
				for b.Loop() {
					b.StopTimer()
					userID := createUser(b, benchUsers)
					b.StartTimer()
					require.NoError(b, d.stmts.DeleteUserByID(ctx, projectID, userID))
				}
			})
		})
	}
}
