//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func createClientRegistration(t *testing.T, stmts service.AllStatements, projectID string, expiresAt time.Time, secretHash string) *domain.ClientRegistration {
	t.Helper()
	entity := &domain.ClientRegistration{
		ProjectID: projectID,
		Metadata: domain.ClientRegistrationMetadata{
			ClientName:   "Agent " + uniqueSuffix(t),
			LogoURI:      "https://agent.example/logo.png",
			RedirectURIs: []string{"http://127.0.0.1/callback"},
			GrantTypes:   []domain.GrantType{domain.GrantAuthorizationCode, domain.GrantRefreshToken},
			AuthMethod:   domain.ClientAuthNone,
		},
		SecretHash: secretHash,
		ExpiresAt:  expiresAt,
	}
	require.NoError(t, stmts.CreateClientRegistration(t.Context(), entity))
	return entity
}

func TestClientRegistrationStatements_CreateAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		expiresAt := time.Now().Add(time.Hour).UTC().Truncate(time.Microsecond)

		public := createClientRegistration(t, d.stmts, projectID, expiresAt, "")
		confidential := createClientRegistration(t, d.stmts, projectID, expiresAt, "sha256:00ff")

		// The dialect mints the id, which is the client_id (ADR 047).
		assert.True(t, domain.PrefixClientRegistration.Matches(public.ID), "id %q is not dcr_-prefixed", public.ID)
		assert.NotEqual(t, public.ID, confidential.ID)
		assert.WithinDuration(t, time.Now(), public.CreatedAt, 5*time.Second)

		for _, want := range []*domain.ClientRegistration{public, confidential} {
			got, err := d.stmts.GetClientRegistration(t.Context(), projectID, want.ID)
			require.NoError(t, err)
			assert.Equal(t, want.Metadata, got.Metadata, "the metadata round-trips as registered")
			assert.Equal(t, want.SecretHash, got.SecretHash, "no hash reads back empty, a hash as written")
			assert.True(t, expiresAt.Equal(got.ExpiresAt), "expires_at %v, want %v", got.ExpiresAt, expiresAt)
			assert.True(t, want.CreatedAt.Equal(got.CreatedAt))
		}

		// A registration belongs to its project: another project's read misses.
		_, err := d.stmts.GetClientRegistration(t.Context(), ensureProject(t, d.stmts), public.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// The purge reads only what is past its expiry, earliest first, a batch at a
// time, and moving a registration's expiry takes it out of that set.
func TestClientRegistrationStatements_ExpiredAndExtend(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		now := time.Now().UTC()
		older := createClientRegistration(t, d.stmts, projectID, now.Add(-2*time.Hour), "")
		newer := createClientRegistration(t, d.stmts, projectID, now.Add(-time.Hour), "")
		live := createClientRegistration(t, d.stmts, projectID, now.Add(time.Hour), "")
		// Another project's expired registration is not this project's to purge.
		createClientRegistration(t, d.stmts, ensureProject(t, d.stmts), now.Add(-time.Hour), "")

		ids, err := d.stmts.ListExpiredClientRegistrations(t.Context(), projectID, now, 10)
		require.NoError(t, err)
		assert.Equal(t, []string{older.ID, newer.ID}, ids)

		ids, err = d.stmts.ListExpiredClientRegistrations(t.Context(), projectID, now, 1)
		require.NoError(t, err)
		assert.Equal(t, []string{older.ID}, ids, "the limit keeps the earliest")

		require.NoError(t, d.stmts.ExtendClientRegistration(t.Context(), projectID, older.ID, now.Add(time.Hour)))
		ids, err = d.stmts.ListExpiredClientRegistrations(t.Context(), projectID, now, 10)
		require.NoError(t, err)
		assert.Equal(t, []string{newer.ID}, ids)
		assert.NotContains(t, ids, live.ID)

		err = d.stmts.ExtendClientRegistration(t.Context(), projectID, "dcr_unknown", now)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestClientRegistrationStatements_Delete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		entity := createClientRegistration(t, d.stmts, projectID, time.Now().Add(time.Hour), "sha256:00ff")

		require.NoError(t, d.stmts.DeleteClientRegistration(t.Context(), projectID, entity.ID))
		_, err := d.stmts.GetClientRegistration(t.Context(), projectID, entity.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		assert.ErrorIs(t, d.stmts.DeleteClientRegistration(t.Context(), projectID, entity.ID), new(database.NoRowFoundError),
			"a second delete has nothing to delete")
	})
}

func TestClientRegistrationStatements_ListPagesOldestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		var want []string
		for range 3 {
			want = append(want, createClientRegistration(t, d.stmts, projectID, time.Now().Add(time.Hour), "").ID)
		}
		createClientRegistration(t, d.stmts, ensureProject(t, d.stmts), time.Now().Add(time.Hour), "")

		var got []string
		cursor := []byte(nil)
		for {
			page, err := d.stmts.ListClientRegistrations(t.Context(), &database.ListOptions[domain.ClientRegistrationField]{
				Filter:     database.Equal(database.Col(domain.ClientRegistrationFieldProjectID), projectID),
				Pagination: database.Page[domain.ClientRegistrationField]{Limit: 2, Cursor: cursor},
			})
			require.NoError(t, err)
			for _, item := range page.Items {
				got = append(got, item.ID)
			}
			if len(page.NextCursor) == 0 {
				break
			}
			cursor = page.NextCursor
		}
		assert.Equal(t, want, got, "every registration of the project, once, oldest first")
	})
}
