//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"cmp"
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	// A client ID metadata document's URL, the longest kind of client id.
	testConsentClient   = "https://client.example.com/oauth/client-metadata.json"
	testConsentResource = "https://api.example.com/mcp"
)

func consentByKey(projectID, userID, clientID, resource string) database.Filter[domain.ConsentField] {
	return database.And(
		database.Equal(database.Col(domain.ConsentFieldProjectID), projectID),
		database.Equal(database.Col(domain.ConsentFieldUserID), userID),
		database.Equal(database.Col(domain.ConsentFieldClientID), clientID),
		database.Equal(database.Col(domain.ConsentFieldResource), resource),
	)
}

func consentByID(projectID, consentID string) database.Filter[domain.ConsentField] {
	return database.And(
		database.Equal(database.Col(domain.ConsentFieldProjectID), projectID),
		database.Equal(database.Col(domain.ConsentFieldID), consentID),
	)
}

// consentFixture is one project holding two users.
type consentFixture struct {
	projectID, userID, otherUserID string
}

func newConsentFixture(t *testing.T, stmts service.AllStatements) consentFixture {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, stmts)
	return consentFixture{
		projectID:   projectID,
		userID:      createLinkUser(t, stmts, projectID, schemaURL, "consenting"),
		otherUserID: createLinkUser(t, stmts, projectID, schemaURL, "other"),
	}
}

// consent is a live consent of userID to clientID for resource. The deadline
// is whole seconds, which every dialect stores exactly.
func (f consentFixture) consent(userID, clientID, resource string, scope ...string) *domain.Consent {
	return &domain.Consent{
		ProjectID:  f.projectID,
		UserID:     userID,
		ClientID:   clientID,
		ClientName: "Example Client",
		Resource:   resource,
		Scope:      scope,
		ExpiresAt:  time.Now().Add(time.Hour).UTC().Truncate(time.Second),
	}
}

func createConsent(t *testing.T, stmts service.AllStatements, consent *domain.Consent) *domain.Consent {
	t.Helper()
	require.NoError(t, stmts.CreateConsent(t.Context(), consent))
	return consent
}

// issueUnderConsent stores the record of a code or refresh token issued under
// the consent, as the consent service does: an oidc_access_token record that
// names the consent as its oidc_session_id.
func issueUnderConsent(t *testing.T, stmts service.AllStatements, consent *domain.Consent) string {
	t.Helper()
	return issueUnderOIDCSession(t, stmts, consent.ProjectID, consent.UserID, consent.ID)
}

func issueUnderOIDCSession(t *testing.T, stmts service.AllStatements, projectID, userID, oidcSessionID string) string {
	t.Helper()
	expiresAt := time.Now().Add(time.Hour)
	tok := &domain.Token{
		ProjectID:     projectID,
		UserID:        userID,
		Type:          domain.TokenTypeOIDCAccessToken,
		OIDCSessionID: &oidcSessionID,
		Scope:         []string{"files:read"},
		ExpiresAt:     &expiresAt,
	}
	require.NoError(t, stmts.CreateToken(t.Context(), tok))
	return tok.TokenID
}

func assertTokensGone(t *testing.T, stmts service.AllStatements, projectID string, tokenIDs ...string) {
	t.Helper()
	for _, id := range tokenIDs {
		_, err := stmts.GetTokenByID(t.Context(), projectID, id)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "token %s must be gone", id)
	}
}

func assertTokensKept(t *testing.T, stmts service.AllStatements, projectID string, tokenIDs ...string) {
	t.Helper()
	for _, id := range tokenIDs {
		_, err := stmts.GetTokenByID(t.Context(), projectID, id)
		assert.NoError(t, err, "token %s must stay", id)
	}
}

func assertConsentGone(t *testing.T, stmts service.AllStatements, projectID, consentID string) {
	t.Helper()
	_, err := stmts.GetConsent(t.Context(), consentByID(projectID, consentID))
	assert.ErrorIs(t, err, new(database.NoRowFoundError), "consent %s must be gone", consentID)
}

func assertConsentKept(t *testing.T, stmts service.AllStatements, projectID, consentID string) {
	t.Helper()
	_, err := stmts.GetConsent(t.Context(), consentByID(projectID, consentID))
	assert.NoError(t, err, "consent %s must stay", consentID)
}

func TestConsentStatements_CreateAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)

		consent := createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, testConsentResource, "files:read", "files:write"))
		assert.True(t, domain.PrefixConsent.Matches(consent.ID), "id %q", consent.ID)
		assert.False(t, consent.CreatedAt.IsZero())
		assert.False(t, consent.UpdatedAt.IsZero())
		assert.Equal(t, time.UTC, consent.CreatedAt.Location())
		assert.Equal(t, time.UTC, consent.UpdatedAt.Location())

		for _, tc := range []struct {
			name   string
			filter database.Filter[domain.ConsentField]
		}{
			{"by_user_client_and_resource", consentByKey(f.projectID, f.userID, testConsentClient, testConsentResource)},
			{"by_id", consentByID(f.projectID, consent.ID)},
		} {
			t.Run(tc.name, func(t *testing.T) {
				got, err := d.stmts.GetConsent(t.Context(), tc.filter)
				require.NoError(t, err)
				assert.Equal(t, f.projectID, got.ProjectID)
				assert.Equal(t, consent.ID, got.ID)
				assert.Equal(t, f.userID, got.UserID)
				assert.Equal(t, testConsentClient, got.ClientID)
				assert.Equal(t, "Example Client", got.ClientName)
				assert.Equal(t, testConsentResource, got.Resource)
				assert.Equal(t, []string{"files:read", "files:write"}, got.Scope)
				assert.True(t, consent.CreatedAt.Equal(got.CreatedAt), "create returned %s, get %s", consent.CreatedAt, got.CreatedAt)
				assert.True(t, consent.UpdatedAt.Equal(got.UpdatedAt), "create returned %s, get %s", consent.UpdatedAt, got.UpdatedAt)
				assert.True(t, consent.ExpiresAt.Equal(got.ExpiresAt), "stored %s, read %s", consent.ExpiresAt, got.ExpiresAt)
				assert.Equal(t, time.UTC, got.CreatedAt.Location())
				assert.Equal(t, time.UTC, got.UpdatedAt.Location())
				assert.Equal(t, time.UTC, got.ExpiresAt.Location())
			})
		}
	})
}

// The scope column is NOT NULL, so a consent stored without one reads back
// with an empty scope, the same on every dialect.
func TestConsentStatements_CreateWithoutScope(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		consent := createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, testConsentResource))

		got, err := d.stmts.GetConsent(t.Context(), consentByID(f.projectID, consent.ID))
		require.NoError(t, err)
		assert.Equal(t, []string{}, got.Scope)
	})
}

// Spanner replays a transaction after an abort with the same *Consent, after
// the first attempt minted its id, so a preset id is kept.
func TestConsentStatements_CreateKeepsPresetID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		consent := f.consent(f.userID, testConsentClient, testConsentResource)
		consent.ID = domain.PrefixConsent.IDPrefix("preset-" + uniqueSuffix(t))
		want := consent.ID
		createConsent(t, d.stmts, consent)

		assert.Equal(t, want, consent.ID)
		got, err := d.stmts.GetConsent(t.Context(), consentByID(f.projectID, want))
		require.NoError(t, err)
		assert.Equal(t, want, got.ID)
	})
}

// One consent per user, client and API: a second create is the UniqueError the
// service answers by widening the first.
func TestConsentStatements_OnePerUserClientAndResource(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, testConsentResource))

		err := d.stmts.CreateConsent(t.Context(), f.consent(f.userID, testConsentClient, testConsentResource, "files:write"))
		assert.ErrorIs(t, err, new(database.UniqueError))

		// Any one of the three differing makes another consent.
		createConsent(t, d.stmts, f.consent(f.otherUserID, testConsentClient, testConsentResource))
		createConsent(t, d.stmts, f.consent(f.userID, "https://other-client.example.com/metadata.json", testConsentResource))
		createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, "https://other-api.example.com"))
	})
}

func TestConsentStatements_UnknownUserIsForeignKey(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		err := d.stmts.CreateConsent(t.Context(), f.consent(domain.PrefixUser.IDPrefix("does_not_exist"), testConsentClient, testConsentResource))
		assert.ErrorIs(t, err, new(database.ForeignKeyError))
	})
}

func TestConsentStatements_GetMissIsNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		consent := createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, testConsentResource))
		otherProject := ensureProject(t, d.stmts)

		for _, tc := range []struct {
			name   string
			filter database.Filter[domain.ConsentField]
		}{
			{"another_resource", consentByKey(f.projectID, f.userID, testConsentClient, "https://other-api.example.com")},
			{"another_client", consentByKey(f.projectID, f.userID, "https://other-client.example.com/metadata.json", testConsentResource)},
			{"another_user", consentByKey(f.projectID, f.otherUserID, testConsentClient, testConsentResource)},
			{"unknown_id", consentByID(f.projectID, domain.PrefixConsent.IDPrefix("does_not_exist"))},
			{"another_project", consentByID(otherProject, consent.ID)},
		} {
			t.Run(tc.name, func(t *testing.T) {
				_, err := d.stmts.GetConsent(t.Context(), tc.filter)
				assert.ErrorIs(t, err, new(database.NoRowFoundError))
			})
		}
	})
}

// GetConsent reads a consent past its deadline too: the service decides that
// it is gone, and replaces it in the transaction that found it.
func TestConsentStatements_GetReturnsExpired(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		expired := f.consent(f.userID, testConsentClient, testConsentResource)
		expired.ExpiresAt = time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
		createConsent(t, d.stmts, expired)

		got, err := d.stmts.GetConsent(t.Context(), consentByKey(f.projectID, f.userID, testConsentClient, testConsentResource))
		require.NoError(t, err)
		assert.Equal(t, expired.ID, got.ID)
		assert.False(t, got.Live(time.Now()))
	})
}

// The list the consent service pages: one user's live consents, newest first.
// Another user's consent and an expired one of the user are seeded too, so the
// exact result also pins both filters.
func TestConsentStatements_ListOneUsersLiveConsentsNewestFirst(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		consents := make([]*domain.Consent, 0, 5)
		for _, client := range []string{"a", "b", "c", "d", "e"} {
			consents = append(consents, createConsent(t, d.stmts, f.consent(f.userID, "https://"+client+".example.com/metadata.json", testConsentResource)))
		}
		expired := f.consent(f.userID, testConsentClient, testConsentResource)
		expired.ExpiresAt = time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
		createConsent(t, d.stmts, expired)
		createConsent(t, d.stmts, f.consent(f.otherUserID, testConsentClient, testConsentResource))

		// Consents created in the same instant tie on created_at, so the
		// expected order comes from the stored values, not the insert order.
		slices.SortFunc(consents, func(a, b *domain.Consent) int {
			return cmp.Or(b.CreatedAt.Compare(a.CreatedAt), strings.Compare(b.ID, a.ID))
		})
		want := make([]string, len(consents))
		for i, consent := range consents {
			want[i] = consent.ID
		}

		now := time.Now()
		got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.Consent], error) {
			return d.stmts.ListConsents(t.Context(), &database.ListOptions[domain.ConsentField]{
				Filter: database.And(
					database.Equal(database.Col(domain.ConsentFieldProjectID), f.projectID),
					database.Equal(database.Col(domain.ConsentFieldUserID), f.userID),
					database.GreaterThan(database.Col(domain.ConsentFieldExpiresAt), now),
				),
				Pagination: database.Page[domain.ConsentField]{
					Limit:  2,
					Cursor: cursor,
					OrderBy: database.OrderBy[domain.ConsentField]{
						Columns: []database.Column[domain.ConsentField]{
							database.Col(domain.ConsentFieldCreatedAt),
							database.Col(domain.ConsentFieldID),
						},
						Direction: database.OrderDesc,
					},
				},
			})
		}, func(consent *domain.Consent) string { return consent.ID })
		assert.Equal(t, want, got)
	})
}

func TestConsentStatements_Update(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)

		t.Run("a_later_consent_replaces_name_and_scope", func(t *testing.T) {
			consent := f.consent(f.userID, testConsentClient, testConsentResource, "files:read")
			consent.ClientName = "Old Name"
			createConsent(t, d.stmts, consent)

			name := "New Name"
			deadline := consent.ExpiresAt.Add(time.Hour)
			require.NoError(t, d.stmts.UpdateConsent(t.Context(), f.projectID, consent.ID, domain.ConsentUpdate{
				ClientName: &name,
				Scope:      []string{"files:read", "files:write"},
				ExpiresAt:  deadline,
			}))

			got, err := d.stmts.GetConsent(t.Context(), consentByID(f.projectID, consent.ID))
			require.NoError(t, err)
			assert.Equal(t, "New Name", got.ClientName)
			assert.Equal(t, []string{"files:read", "files:write"}, got.Scope)
			assert.True(t, deadline.Equal(got.ExpiresAt), "deadline %s, stored %s", deadline, got.ExpiresAt)
			assert.True(t, got.UpdatedAt.After(consent.UpdatedAt), "updated_at %s must move past %s", got.UpdatedAt, consent.UpdatedAt)
			assert.True(t, consent.CreatedAt.Equal(got.CreatedAt), "created_at must stay")
		})

		t.Run("a_use_moves_only_the_deadline", func(t *testing.T) {
			consent := createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, "https://use.example.com", "files:read"))

			deadline := consent.ExpiresAt.Add(time.Minute)
			require.NoError(t, d.stmts.UpdateConsent(t.Context(), f.projectID, consent.ID, domain.ConsentUpdate{ExpiresAt: deadline}))

			got, err := d.stmts.GetConsent(t.Context(), consentByID(f.projectID, consent.ID))
			require.NoError(t, err)
			assert.Equal(t, "Example Client", got.ClientName)
			assert.Equal(t, []string{"files:read"}, got.Scope)
			assert.True(t, deadline.Equal(got.ExpiresAt), "deadline %s, stored %s", deadline, got.ExpiresAt)
			assert.True(t, got.UpdatedAt.After(consent.UpdatedAt), "updated_at %s must move past %s", got.UpdatedAt, consent.UpdatedAt)
		})

		t.Run("an_empty_scope_replaces_the_scope", func(t *testing.T) {
			consent := createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, "https://empty.example.com", "files:read"))

			require.NoError(t, d.stmts.UpdateConsent(t.Context(), f.projectID, consent.ID, domain.ConsentUpdate{
				Scope:     []string{},
				ExpiresAt: consent.ExpiresAt,
			}))

			got, err := d.stmts.GetConsent(t.Context(), consentByID(f.projectID, consent.ID))
			require.NoError(t, err)
			assert.Equal(t, []string{}, got.Scope)
		})

		t.Run("missing_returns_NoRowFoundError", func(t *testing.T) {
			err := d.stmts.UpdateConsent(t.Context(), f.projectID, domain.PrefixConsent.IDPrefix("does_not_exist"), domain.ConsentUpdate{
				ExpiresAt: time.Now().Add(time.Hour),
			})
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}

// Revoking a consent revokes what was issued under it, and nothing else: not
// another consent's records, and not the user's other credentials.
func TestConsentStatements_DeleteRevokesItsTokens(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		revoked := createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, testConsentResource))
		kept := createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, "https://other-api.example.com"))
		code, refresh := issueUnderConsent(t, d.stmts, revoked), issueUnderConsent(t, d.stmts, revoked)
		keptRefresh := issueUnderConsent(t, d.stmts, kept)

		sessionID := "sess-" + uniqueSuffix(t)
		sessionToken := &domain.Token{
			ProjectID: f.projectID,
			UserID:    f.userID,
			Type:      domain.TokenTypeSessionToken,
			SessionID: &sessionID,
			Scope:     []string{},
		}
		require.NoError(t, d.stmts.CreateToken(t.Context(), sessionToken))
		pat := &domain.Token{ProjectID: f.projectID, UserID: f.userID, Type: domain.TokenTypePersonalAccessToken}
		require.NoError(t, d.stmts.CreateToken(t.Context(), pat))

		require.NoError(t, d.stmts.DeleteConsent(t.Context(), f.projectID, revoked.ID))

		assertConsentGone(t, d.stmts, f.projectID, revoked.ID)
		assertTokensGone(t, d.stmts, f.projectID, code, refresh)
		assertConsentKept(t, d.stmts, f.projectID, kept.ID)
		assertTokensKept(t, d.stmts, f.projectID, keptRefresh, sessionToken.TokenID, pat.TokenID)

		err := d.stmts.DeleteConsent(t.Context(), f.projectID, revoked.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError), "a consent is revoked once")
	})
}

// A missing consent deletes nothing, not even a record that names it.
func TestConsentStatements_DeleteMissingDeletesNothing(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		missing := domain.PrefixConsent.IDPrefix("does_not_exist")
		stray := issueUnderOIDCSession(t, d.stmts, f.projectID, f.userID, missing)

		err := d.stmts.DeleteConsent(t.Context(), f.projectID, missing)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		assertTokensKept(t, d.stmts, f.projectID, stray)
	})
}

// An expired consent gives way to a new one in the transaction that finds it:
// the delete of the old one and the create of its successor, under the same
// user, client and API, commit or roll back together.
func TestConsentStatements_ReplaceInsideTransaction(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		expired := f.consent(f.userID, testConsentClient, testConsentResource, "files:read")
		expired.ExpiresAt = time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
		createConsent(t, d.stmts, expired)
		expiredRefresh := issueUnderConsent(t, d.stmts, expired)

		replace := func(t *testing.T, end error) (*domain.Consent, error) {
			var successor *domain.Consent
			err := d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
				// A retry replays the closure, so the successor starts afresh
				// each attempt.
				successor = f.consent(f.userID, testConsentClient, testConsentResource, "files:write")
				if err := tx.Statements().DeleteConsent(ctx, f.projectID, expired.ID); err != nil {
					return err
				}
				if err := tx.Statements().CreateConsent(ctx, successor); err != nil {
					return err
				}
				return end
			})
			return successor, err
		}
		key := consentByKey(f.projectID, f.userID, testConsentClient, testConsentResource)

		t.Run("rolled_back_keeps_the_expired_one", func(t *testing.T) {
			errRollback := errors.New("roll back")
			_, err := replace(t, errRollback)
			require.ErrorIs(t, err, errRollback, "the delete and the create must succeed inside the transaction")

			got, err := d.stmts.GetConsent(t.Context(), key)
			require.NoError(t, err)
			assert.Equal(t, expired.ID, got.ID)
			assertTokensKept(t, d.stmts, f.projectID, expiredRefresh)
		})

		t.Run("committed_replaces_it", func(t *testing.T) {
			successor, err := replace(t, nil)
			require.NoError(t, err)

			got, err := d.stmts.GetConsent(t.Context(), key)
			require.NoError(t, err)
			assert.Equal(t, successor.ID, got.ID)
			assert.NotEqual(t, expired.ID, got.ID)
			assert.Equal(t, []string{"files:write"}, got.Scope)
			assertTokensGone(t, d.stmts, f.projectID, expiredRefresh)
		})
	})
}

// A deleted client takes its consents with it, and what was issued under
// them, in its own project only.
func TestConsentStatements_DeleteConsentsByClient(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		const otherClient = "https://other-client.example.com/metadata.json"
		deleted := []*domain.Consent{
			createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, testConsentResource)),
			createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, "https://other-api.example.com")),
			createConsent(t, d.stmts, f.consent(f.otherUserID, testConsentClient, testConsentResource)),
		}
		deletedTokens := make([]string, 0, len(deleted))
		for _, consent := range deleted {
			deletedTokens = append(deletedTokens, issueUnderConsent(t, d.stmts, consent))
		}
		otherClientConsent := createConsent(t, d.stmts, f.consent(f.userID, otherClient, testConsentResource))
		otherClientRefresh := issueUnderConsent(t, d.stmts, otherClientConsent)

		other := newConsentFixture(t, d.stmts)
		otherProjectConsent := createConsent(t, d.stmts, other.consent(other.userID, testConsentClient, testConsentResource))
		otherProjectRefresh := issueUnderConsent(t, d.stmts, otherProjectConsent)

		require.NoError(t, d.stmts.DeleteConsentsByClient(t.Context(), f.projectID, testConsentClient))

		for _, consent := range deleted {
			assertConsentGone(t, d.stmts, f.projectID, consent.ID)
		}
		assertTokensGone(t, d.stmts, f.projectID, deletedTokens...)
		assertConsentKept(t, d.stmts, f.projectID, otherClientConsent.ID)
		assertTokensKept(t, d.stmts, f.projectID, otherClientRefresh)
		assertConsentKept(t, d.stmts, other.projectID, otherProjectConsent.ID)
		assertTokensKept(t, d.stmts, other.projectID, otherProjectRefresh)

		// A client without consents is no error, whether it had some once or
		// never.
		assert.NoError(t, d.stmts.DeleteConsentsByClient(t.Context(), f.projectID, testConsentClient))
		assert.NoError(t, d.stmts.DeleteConsentsByClient(t.Context(), f.projectID, "https://never-consented.example.com/metadata.json"))
	})
}

// A consent is the user's, so it goes with the user, and so does what was
// issued under it.
func TestConsentStatements_UserDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		consent := createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, testConsentResource))
		refresh := issueUnderConsent(t, d.stmts, consent)
		kept := createConsent(t, d.stmts, f.consent(f.otherUserID, testConsentClient, testConsentResource))

		require.NoError(t, d.stmts.DeleteUserByID(t.Context(), f.projectID, f.userID))

		assertConsentGone(t, d.stmts, f.projectID, consent.ID)
		assertTokensGone(t, d.stmts, f.projectID, refresh)
		assertConsentKept(t, d.stmts, f.projectID, kept.ID)
	})
}

func TestConsentStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		f := newConsentFixture(t, d.stmts)
		consent := createConsent(t, d.stmts, f.consent(f.userID, testConsentClient, testConsentResource))

		_, err := d.stmts.DeleteProjectByID(t.Context(), f.projectID)
		require.NoError(t, err)

		assertConsentGone(t, d.stmts, f.projectID, consent.ID)
	})
}
