//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestCursorBattle_AdversarialTokens(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("projects_invalid_cursor", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter: database.Equal(database.Col(domain.ProjectFieldID), projectID),
				Pagination: database.Page[domain.ProjectField]{
					Limit: 2,
					OrderBy: database.OrderBy[domain.ProjectField]{
						Columns: []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
					},
					Cursor: []byte("not-a-token"),
				},
			})
			assertDatabaseErrorCode(t, err, "db.invalid_cursor")
		})

		t.Run("projects_column_mismatch", func(t *testing.T) {
			prefix := uniqueProjectID(t)
			ids := []string{prefix + "-a", prefix + "-b"}
			for _, id := range ids {
				require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(id)))
				t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), id) })
			}
			filter := database.Or(
				database.Equal(database.Col(domain.ProjectFieldID), ids[0]),
				database.Equal(database.Col(domain.ProjectFieldID), ids[1]),
			)
			orderByID := database.OrderBy[domain.ProjectField]{
				Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
				Direction: database.OrderAsc,
			}
			first, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter:     filter,
				Pagination: database.Page[domain.ProjectField]{Limit: 1, OrderBy: orderByID},
			})
			require.NoError(t, err)
			require.NotEmpty(t, first.NextCursor)

			_, err = d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter: filter,
				Pagination: database.Page[domain.ProjectField]{
					Limit: 1,
					OrderBy: database.OrderBy[domain.ProjectField]{
						Columns: []database.Column[domain.ProjectField]{
							database.Col(domain.ProjectFieldCreatedAt),
							database.Col(domain.ProjectFieldID),
						},
						Direction: database.OrderAsc,
					},
					Cursor: first.NextCursor,
				},
			})
			assertDatabaseErrorCode(t, err, "db.cursor_order_mismatch")
		})

		t.Run("projects_direction_mismatch", func(t *testing.T) {
			prefix := uniqueProjectID(t)
			ids := []string{prefix + "-a", prefix + "-b"}
			for _, id := range ids {
				require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(id)))
				t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), id) })
			}
			filter := database.Or(
				database.Equal(database.Col(domain.ProjectFieldID), ids[0]),
				database.Equal(database.Col(domain.ProjectFieldID), ids[1]),
			)
			orderAsc := database.OrderBy[domain.ProjectField]{
				Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
				Direction: database.OrderAsc,
			}
			first, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter:     filter,
				Pagination: database.Page[domain.ProjectField]{Limit: 1, OrderBy: orderAsc},
			})
			require.NoError(t, err)
			require.NotEmpty(t, first.NextCursor)

			orderDesc := orderAsc
			orderDesc.Direction = database.OrderDesc
			_, err = d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter: filter,
				Pagination: database.Page[domain.ProjectField]{
					Limit: 1, OrderBy: orderDesc, Cursor: first.NextCursor,
				},
			})
			assertDatabaseErrorCode(t, err, "db.cursor_order_mismatch")
		})

		t.Run("users_invalid_and_direction", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			for _, id := range []string{"usr-adv-a-" + uniqueSuffix(t), "usr-adv-b-" + uniqueSuffix(t)} {
				require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, id, id+"@example.com", "Adv")))
				t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, id) })
			}
			filter := database.Equal(database.Col(domain.UserFieldProjectID), projectID)
			orderAsc := database.OrderBy[domain.UserField]{
				Columns:   []database.Column[domain.UserField]{database.Col(domain.UserFieldID)},
				Direction: database.OrderAsc,
			}

			_, err := d.stmts.ListUsers(t.Context(), &database.ListOptions[domain.UserField]{
				Filter: filter,
				Pagination: database.Page[domain.UserField]{
					Limit: 1, OrderBy: orderAsc, Cursor: []byte("%%%"),
				},
			}, service.UserQueryOptions{})
			assertDatabaseErrorCode(t, err, "db.invalid_cursor")

			first, err := d.stmts.ListUsers(t.Context(), &database.ListOptions[domain.UserField]{
				Filter:     filter,
				Pagination: database.Page[domain.UserField]{Limit: 1, OrderBy: orderAsc},
			}, service.UserQueryOptions{})
			require.NoError(t, err)
			require.NotEmpty(t, first.NextCursor)

			orderDesc := orderAsc
			orderDesc.Direction = database.OrderDesc
			_, err = d.stmts.ListUsers(t.Context(), &database.ListOptions[domain.UserField]{
				Filter: filter,
				Pagination: database.Page[domain.UserField]{
					Limit: 1, OrderBy: orderDesc, Cursor: first.NextCursor,
				},
			}, service.UserQueryOptions{})
			assertDatabaseErrorCode(t, err, "db.cursor_order_mismatch")
		})
	})
}

func TestCursorBattle_DestructiveMidPage(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("projects_delete_after_page1", func(t *testing.T) {
			prefix := uniqueProjectID(t)
			ids := []string{prefix + "-a", prefix + "-b", prefix + "-c"}
			for _, id := range ids {
				require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(id)))
				t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), id) })
			}
			filter := database.Or(
				database.Equal(database.Col(domain.ProjectFieldID), ids[0]),
				database.Equal(database.Col(domain.ProjectFieldID), ids[1]),
				database.Equal(database.Col(domain.ProjectFieldID), ids[2]),
			)
			order := database.OrderBy[domain.ProjectField]{
				Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
				Direction: database.OrderAsc,
			}
			first, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter:     filter,
				Pagination: database.Page[domain.ProjectField]{Limit: 2, OrderBy: order},
			})
			require.NoError(t, err)
			require.Len(t, first.Items, 2)
			require.NotEmpty(t, first.NextCursor)
			deleted := first.Items[1].ID
			require.NoError(t, d.stmts.DeleteProjectByID(t.Context(), deleted))

			got := append(projectIDs(first.Items[:1]), pageAll(t, 2, first.NextCursor, func(cursor []byte) (*database.ListResult[*domain.Project], error) {
				return d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
					Filter: filter,
					Pagination: database.Page[domain.ProjectField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(p *domain.Project) string { return p.ID })...)
			assert.NotContains(t, got, deleted)
			assert.ElementsMatch(t, []string{ids[0], ids[2]}, uniqueStrings(got))
		})

		t.Run("projects_insert_before_cursor", func(t *testing.T) {
			prefix := uniqueProjectID(t)
			// Lexicographic IDs: mid and late first, then insert early after page 1.
			mid, late := prefix+"-m", prefix+"-z"
			for _, id := range []string{mid, late} {
				require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(id)))
				t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), id) })
			}
			filterPrefix := database.StringStartsWith(database.Col(domain.ProjectFieldID), prefix+"-")
			order := database.OrderBy[domain.ProjectField]{
				Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
				Direction: database.OrderAsc,
			}
			first, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter:     filterPrefix,
				Pagination: database.Page[domain.ProjectField]{Limit: 1, OrderBy: order},
			})
			require.NoError(t, err)
			require.Len(t, first.Items, 1)
			require.Equal(t, mid, first.Items[0].ID)

			early := prefix + "-a"
			require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(early)))
			t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), early) })

			rest := pageAll(t, 2, first.NextCursor, func(cursor []byte) (*database.ListResult[*domain.Project], error) {
				return d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
					Filter: filterPrefix,
					Pagination: database.Page[domain.ProjectField]{
						Limit: 1, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(p *domain.Project) string { return p.ID })
			assert.NotContains(t, rest, early, "rows sorting before the cursor must not appear later")
			assert.Equal(t, []string{late}, rest)
		})

		t.Run("projects_insert_after_cursor", func(t *testing.T) {
			prefix := uniqueProjectID(t)
			early, mid := prefix+"-a", prefix+"-m"
			for _, id := range []string{early, mid} {
				require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(id)))
				t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), id) })
			}
			filterPrefix := database.StringStartsWith(database.Col(domain.ProjectFieldID), prefix+"-")
			order := database.OrderBy[domain.ProjectField]{
				Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
				Direction: database.OrderAsc,
			}
			first, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter:     filterPrefix,
				Pagination: database.Page[domain.ProjectField]{Limit: 1, OrderBy: order},
			})
			require.NoError(t, err)
			require.Equal(t, early, first.Items[0].ID)

			late := prefix + "-z"
			require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(late)))
			t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), late) })

			rest := pageAll(t, 3, first.NextCursor, func(cursor []byte) (*database.ListResult[*domain.Project], error) {
				return d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
					Filter: filterPrefix,
					Pagination: database.Page[domain.ProjectField]{
						Limit: 1, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(p *domain.Project) string { return p.ID })
			assert.ElementsMatch(t, []string{mid, late}, rest)
		})

		t.Run("users_delete_after_page1", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			ids := []string{
				"usr-del-a-" + uniqueSuffix(t),
				"usr-del-b-" + uniqueSuffix(t),
				"usr-del-c-" + uniqueSuffix(t),
			}
			for _, id := range ids {
				require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, id, id+"@example.com", "Del")))
				t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, id) })
			}
			filter := database.Equal(database.Col(domain.UserFieldProjectID), projectID)
			order := database.OrderBy[domain.UserField]{
				Columns:   []database.Column[domain.UserField]{database.Col(domain.UserFieldID)},
				Direction: database.OrderAsc,
			}
			first, err := d.stmts.ListUsers(t.Context(), &database.ListOptions[domain.UserField]{
				Filter:     filter,
				Pagination: database.Page[domain.UserField]{Limit: 2, OrderBy: order},
			}, service.UserQueryOptions{})
			require.NoError(t, err)
			require.Len(t, first.Items, 2)
			deleted := first.Items[1].ID
			require.NoError(t, d.stmts.DeleteUserByID(t.Context(), projectID, deleted))

			rest := pageAll(t, 2, first.NextCursor, func(cursor []byte) (*database.ListResult[*domain.User], error) {
				return d.stmts.ListUsers(t.Context(), &database.ListOptions[domain.UserField]{
					Filter: filter,
					Pagination: database.Page[domain.UserField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				}, service.UserQueryOptions{})
			}, func(u *domain.User) string { return u.ID })
			got := append([]string{first.Items[0].ID}, rest...)
			assert.NotContains(t, got, deleted)
			assert.Equal(t, 2, len(uniqueStrings(got)))
		})

		t.Run("sessions_delete_after_page1", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			sessions := []*domain.Session{
				createAnonymousSession(t, d.stmts, projectID),
				createAnonymousSession(t, d.stmts, projectID),
				createAnonymousSession(t, d.stmts, projectID),
			}
			filter := database.Equal(database.Col(domain.SessionFieldProjectID), projectID)
			order := database.OrderBy[domain.SessionField]{
				Columns:   []database.Column[domain.SessionField]{database.Col(domain.SessionFieldID)},
				Direction: database.OrderAsc,
			}
			first, err := d.stmts.ListSessions(t.Context(), &database.ListOptions[domain.SessionField]{
				Filter:     filter,
				Pagination: database.Page[domain.SessionField]{Limit: 2, OrderBy: order},
			})
			require.NoError(t, err)
			require.Len(t, first.Items, 2)
			deleted := first.Items[1].ID
			require.NoError(t, d.stmts.DeleteSessionByID(t.Context(), projectID, deleted))

			rest := pageAll(t, 2, first.NextCursor, func(cursor []byte) (*database.ListResult[*domain.Session], error) {
				return d.stmts.ListSessions(t.Context(), &database.ListOptions[domain.SessionField]{
					Filter: filter,
					Pagination: database.Page[domain.SessionField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(s *domain.Session) string { return s.ID })
			got := append([]string{first.Items[0].ID}, rest...)
			assert.NotContains(t, got, deleted)
			assert.Len(t, uniqueStrings(got), 2)
			_ = sessions
		})
	})
}

func TestCursorBattle_ListResultIterate(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		prefix := uniqueProjectID(t)
		want := []string{prefix + "-a", prefix + "-b", prefix + "-c"}
		for _, id := range want {
			require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(id)))
			t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), id) })
		}
		filter := database.Or(
			database.Equal(database.Col(domain.ProjectFieldID), want[0]),
			database.Equal(database.Col(domain.ProjectFieldID), want[1]),
			database.Equal(database.Col(domain.ProjectFieldID), want[2]),
		)
		order := database.OrderBy[domain.ProjectField]{
			Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
			Direction: database.OrderAsc,
		}
		first, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
			Filter:     filter,
			Pagination: database.Page[domain.ProjectField]{Limit: 2, OrderBy: order},
		})
		require.NoError(t, err)

		var got []string
		for project, err := range first.Iterate(func(cursor []byte) (*database.ListResult[*domain.Project], error) {
			return d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter: filter,
				Pagination: database.Page[domain.ProjectField]{
					Limit: 2, OrderBy: order, Cursor: cursor,
				},
			})
		}) {
			require.NoError(t, err)
			got = append(got, project.ID)
		}
		assertDrainMatch(t, want, got)
	})
}

func TestCursorBattle_NullableEncryptionKeysActivatedAt(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		want := make([]string, 0, 3)
		for range 3 {
			key := newTestEncryptionKey("", projectID)
			require.NoError(t, d.stmts.CreateEncryptionKey(t.Context(), key))
			require.Nil(t, key.ActivatedAt)
			want = append(want, key.ID)
		}
		filter := database.Equal(database.Col(domain.EncryptionKeyFieldProjectID), projectID)
		order := database.OrderBy[domain.EncryptionKeyField]{
			Columns: []database.Column[domain.EncryptionKeyField]{
				database.Col(domain.EncryptionKeyFieldActivatedAt),
				database.Col(domain.EncryptionKeyFieldID),
			},
			Direction: database.OrderAsc,
		}
		for name, direction := range map[string]database.OrderDirection{
			"asc":  database.OrderAsc,
			"desc": database.OrderDesc,
		} {
			t.Run(name, func(t *testing.T) {
				order.Direction = direction
				got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.EncryptionKey], error) {
					return d.stmts.ListEncryptionKeys(t.Context(), &database.ListOptions[domain.EncryptionKeyField]{
						Filter: filter,
						Pagination: database.Page[domain.EncryptionKeyField]{
							Limit: 2, OrderBy: order, Cursor: cursor,
						},
					})
				}, func(k *domain.EncryptionKey) string { return k.ID })
				assertDrainMatch(t, want, got)
			})
		}
	})
}

func TestCursorBattle_UpdateSortKeyCrossingCursor(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		// Rename (UpdateProject name) does not move ID sort key; use teams ordered by name
		// and rename the page-1 last row so it would sort after the cursor.
		projectID := ensureProject(t, d.stmts)
		alpha := newTestTeam(projectID, "")
		alpha.Name = "alpha-" + uniqueSuffix(t)
		bravo := newTestTeam(projectID, "")
		bravo.Name = "bravo-" + uniqueSuffix(t)
		charlie := newTestTeam(projectID, "")
		charlie.Name = "charlie-" + uniqueSuffix(t)
		for _, team := range []*domain.Team{alpha, bravo, charlie} {
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
		}
		filter := database.Equal(database.Col(domain.TeamFieldProjectID), projectID)
		order := database.OrderBy[domain.TeamField]{
			Columns: []database.Column[domain.TeamField]{
				database.Col(domain.TeamFieldName),
				database.Col(domain.TeamFieldID),
			},
			Direction: database.OrderAsc,
		}
		first, err := d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{
			Filter:     filter,
			Pagination: database.Page[domain.TeamField]{Limit: 2, OrderBy: order},
		})
		require.NoError(t, err)
		require.Len(t, first.Items, 2)
		require.Equal(t, alpha.ID, first.Items[0].ID)
		require.Equal(t, bravo.ID, first.Items[1].ID)

		// Move bravo past charlie by renaming.
		bravo.Name = "zzz-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.UpdateTeam(t.Context(), bravo))

		rest := pageAll(t, 2, first.NextCursor, func(cursor []byte) (*database.ListResult[*domain.Team], error) {
			return d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{
				Filter: filter,
				Pagination: database.Page[domain.TeamField]{
					Limit: 2, OrderBy: order, Cursor: cursor,
				},
			})
		}, func(team *domain.Team) string { return team.ID })
		// Keyset may skip the moved row (now after cursor values) or include it once if
		// still ahead of the remaining set; never duplicate.
		got := append([]string{first.Items[0].ID}, rest...)
		assert.Equal(t, len(uniqueStrings(got)), len(got), "no duplicate IDs across pages")
		assert.Contains(t, got, charlie.ID)
	})
}

func uniqueStrings(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}
