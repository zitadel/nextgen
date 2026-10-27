//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"crypto/rand"
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
// the SQLite plan test in the dialect package is the regression check.
func BenchmarkUserStatements_10kUsers(b *testing.B) {
	for _, d := range dialects {
		b.Run(d.name, func(b *testing.B) {
			if d.name == "spanner" {
				b.Skip("seeding 10k users on the emulator is too slow")
			}
			ctx := b.Context()
			project := newTestProject("proj-bench-" + rand.Text())
			require.NoError(b, d.stmts.CreateProject(ctx, project))
			b.Cleanup(func() { _, _ = d.stmts.DeleteProjectByID(context.Background(), project.ID) })
			schemaURL := "https://example.com/schemas/bench-user"
			require.NoError(b, d.stmts.CreateJSONSchema(ctx, &domain.JSONSchema{
				ProjectID: project.ID,
				URL:       schemaURL,
				Schema:    []byte(`{"type":"object"}`),
			}))

			createUser := func(i int) string {
				userID := fmt.Sprintf("usr-bench-%05d", i)
				require.NoError(b, d.stmts.CreateUser(ctx, newTestUser(b, project.ID, schemaURL, userID, userID+"@example.com", userID)))
				oidcSession := "oidc-" + userID
				require.NoError(b, d.stmts.CreateToken(ctx, &domain.Token{
					ProjectID:     project.ID,
					UserID:        userID,
					Type:          domain.TokenTypeOIDCAccessToken,
					OIDCSessionID: &oidcSession,
					Scope:         []string{"openid"},
				}))
				return userID
			}
			for i := range benchUsers {
				createUser(i)
			}

			b.Run("lookup", func(b *testing.B) {
				projectFilter := database.Equal(database.Col(domain.UserFieldProjectID), project.ID)
				opts := service.UserQueryOptions{
					Attributes:           []domain.Attribute{{Key: "email", Value: "usr-bench-05000@example.com"}},
					UniqueAttributesOnly: true,
				}
				for b.Loop() {
					_, err := d.stmts.GetUser(ctx, projectFilter, opts)
					require.NoError(b, err)
				}
			})

			b.Run("delete", func(b *testing.B) {
				for b.Loop() {
					b.StopTimer()
					userID := createUser(benchUsers)
					b.StartTimer()
					require.NoError(b, d.stmts.DeleteUserByID(ctx, project.ID, userID))
				}
			})
		})
	}
}
