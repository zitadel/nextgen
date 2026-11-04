//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// newTestSigningKey builds a token signing key of algorithm in state. The key
// column is opaque to storage, so a fixture string stands in for the wrapped
// key.
func newTestSigningKey(projectID string, algorithm jose.SignatureAlgorithm, state domain.KeyState) *domain.SigningKey {
	return &domain.SigningKey{
		ProjectID: projectID,
		Key:       "encrypted-fixture-key",
		Algorithm: algorithm,
		State:     state,
		Purpose:   domain.SigningKeyPurposeToken,
	}
}

func createSigningKey(t *testing.T, d dialect, key *domain.SigningKey) *domain.SigningKey {
	t.Helper()
	require.NoError(t, d.stmts.CreateSigningKey(t.Context(), key), "create %s %s key", key.State, key.Algorithm)
	return key
}

// listSigningKeyIDs lists the keys filter matches, in ID order, and returns
// their IDs.
func listSigningKeyIDs(t *testing.T, d dialect, filter database.Filter[domain.SigningKeyField]) []string {
	t.Helper()
	result, err := d.stmts.ListSigningKeys(t.Context(), &database.ListOptions[domain.SigningKeyField]{
		Filter: filter,
		Pagination: database.Page[domain.SigningKeyField]{
			OrderBy: database.OrderBy[domain.SigningKeyField]{
				Columns: []database.Column[domain.SigningKeyField]{database.Col(domain.SigningKeyFieldID)},
			},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Empty(t, result.NextCursor, "an unlimited list has no next page")
	ids := make([]string, len(result.Items))
	for i, key := range result.Items {
		ids[i] = key.ID
	}
	return ids
}

func signingKeyIDs(keys ...*domain.SigningKey) []string {
	ids := make([]string, len(keys))
	for i, key := range keys {
		ids[i] = key.ID
	}
	return ids
}

func TestCryptoKeyStatements_ListSigningKeys(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		otherProjectID := ensureProject(t, d.stmts)

		now := time.Now().UTC().Truncate(time.Second)
		retiredEdDSA := newTestSigningKey(projectID, jose.EdDSA, domain.KeyStateExpired)
		retiredEdDSA.ActivatedAt = new(now.Add(-2 * time.Hour))
		retiredEdDSA.RetiredAt = new(now.Add(-time.Hour))
		createSigningKey(t, d, retiredEdDSA)

		eddsa := newTestSigningKey(projectID, jose.EdDSA, domain.KeyStateActive)
		eddsa.ActivatedAt = new(now.Add(-time.Hour))
		createSigningKey(t, d, eddsa)

		rs256 := newTestSigningKey(projectID, jose.RS256, domain.KeyStateActive)
		rs256.ActivatedAt = new(now)
		createSigningKey(t, d, rs256)

		es256 := newTestSigningKey(projectID, jose.ES256, domain.KeyStateActive)
		es256.ActivatedAt = new(now)
		createSigningKey(t, d, es256)

		nextRS256 := createSigningKey(t, d, newTestSigningKey(projectID, jose.RS256, domain.KeyStateNotActiveYet))

		otherEdDSA := createSigningKey(t, d, newTestSigningKey(otherProjectID, jose.EdDSA, domain.KeyStateActive))
		otherRS256 := createSigningKey(t, d, newTestSigningKey(otherProjectID, jose.RS256, domain.KeyStateActive))

		inProject := database.Equal(database.Col(domain.SigningKeyFieldProjectID), projectID)
		active := database.Equal(database.Col(domain.SigningKeyFieldState), domain.KeyStateActive)
		token := database.Equal(database.Col(domain.SigningKeyFieldPurpose), domain.SigningKeyPurposeToken)
		algorithm := func(alg jose.SignatureAlgorithm) database.Filter[domain.SigningKeyField] {
			return database.Equal(database.Col(domain.SigningKeyFieldAlgorithm), alg)
		}

		t.Run("a project's keys leave other projects out", func(t *testing.T) {
			assert.ElementsMatch(t,
				signingKeyIDs(retiredEdDSA, eddsa, rs256, es256, nextRS256),
				listSigningKeyIDs(t, d, inProject))
			assert.ElementsMatch(t,
				signingKeyIDs(otherEdDSA, otherRS256),
				listSigningKeyIDs(t, d, database.Equal(database.Col(domain.SigningKeyFieldProjectID), otherProjectID)))
		})

		t.Run("the active keys are one per algorithm", func(t *testing.T) {
			assert.ElementsMatch(t,
				signingKeyIDs(eddsa, rs256, es256),
				listSigningKeyIDs(t, d, database.And(inProject, active, token)))
		})

		t.Run("an algorithm's keys in every state", func(t *testing.T) {
			assert.ElementsMatch(t, signingKeyIDs(retiredEdDSA, eddsa), listSigningKeyIDs(t, d, database.And(inProject, algorithm(jose.EdDSA))))
			assert.ElementsMatch(t, signingKeyIDs(rs256, nextRS256), listSigningKeyIDs(t, d, database.And(inProject, algorithm(jose.RS256))))
			assert.ElementsMatch(t, signingKeyIDs(es256), listSigningKeyIDs(t, d, database.And(inProject, algorithm(jose.ES256))))
		})

		t.Run("no match is an empty list", func(t *testing.T) {
			assert.Empty(t, listSigningKeyIDs(t, d, database.And(
				database.Equal(database.Col(domain.SigningKeyFieldProjectID), otherProjectID),
				algorithm(jose.ES256),
			)))
		})

		t.Run("a listed key round trips", func(t *testing.T) {
			result, err := d.stmts.ListSigningKeys(t.Context(), &database.ListOptions[domain.SigningKeyField]{
				Filter: database.And(inProject, algorithm(jose.EdDSA)),
				Pagination: database.Page[domain.SigningKeyField]{
					OrderBy: database.OrderBy[domain.SigningKeyField]{
						Columns: []database.Column[domain.SigningKeyField]{database.Col(domain.SigningKeyFieldActivatedAt)},
					},
				},
			})
			require.NoError(t, err)
			require.Len(t, result.Items, 2)

			retired, current := result.Items[0], result.Items[1]
			assert.Equal(t, retiredEdDSA.ID, retired.ID, "activated_at orders the retired key first")
			assert.Equal(t, projectID, retired.ProjectID)
			assert.Equal(t, "encrypted-fixture-key", retired.Key)
			assert.Equal(t, jose.EdDSA, retired.Algorithm)
			assert.Equal(t, domain.KeyStateExpired, retired.State)
			assert.Equal(t, domain.SigningKeyPurposeToken, retired.Purpose)
			assert.False(t, retired.CreatedAt.IsZero())
			require.NotNil(t, retired.ActivatedAt)
			assert.WithinDuration(t, *retiredEdDSA.ActivatedAt, *retired.ActivatedAt, 0)
			require.NotNil(t, retired.RetiredAt)
			assert.WithinDuration(t, *retiredEdDSA.RetiredAt, *retired.RetiredAt, 0)

			assert.Equal(t, eddsa.ID, current.ID)
			assert.Equal(t, domain.KeyStateActive, current.State)
			assert.Nil(t, current.RetiredAt)
		})

		t.Run("GetSigningKey reads the active key of an algorithm", func(t *testing.T) {
			for _, want := range []*domain.SigningKey{eddsa, rs256, es256} {
				got, err := d.stmts.GetSigningKey(t.Context(), database.And(inProject, active, token, algorithm(want.Algorithm)))
				require.NoError(t, err, "active %s key", want.Algorithm)
				assert.Equal(t, want.ID, got.ID, "active %s key", want.Algorithm)
				assert.Equal(t, want.Algorithm, got.Algorithm)
			}

			_, err := d.stmts.GetSigningKey(t.Context(), database.And(
				database.Equal(database.Col(domain.SigningKeyFieldProjectID), otherProjectID),
				active, token, algorithm(jose.ES256),
			))
			assert.ErrorIs(t, err, new(database.NoRowFoundError), "the other project has no ES256 key")
		})
	})
}

// A project holds one active token signing key per algorithm (ADR 082 §7),
// where it once held one whatever the algorithm.
func TestCryptoKeyStatements_ActiveTokenSigningKeyPerAlgorithm(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("each algorithm holds an active key of its own", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			keys := []*domain.SigningKey{
				createSigningKey(t, d, newTestSigningKey(projectID, jose.EdDSA, domain.KeyStateActive)),
				createSigningKey(t, d, newTestSigningKey(projectID, jose.RS256, domain.KeyStateActive)),
				createSigningKey(t, d, newTestSigningKey(projectID, jose.ES256, domain.KeyStateActive)),
			}
			assert.ElementsMatch(t, signingKeyIDs(keys...), listSigningKeyIDs(t, d, database.And(
				database.Equal(database.Col(domain.SigningKeyFieldProjectID), projectID),
				database.Equal(database.Col(domain.SigningKeyFieldState), domain.KeyStateActive),
			)))
		})

		t.Run("a second active key of one algorithm is a UniqueError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			createSigningKey(t, d, newTestSigningKey(projectID, jose.EdDSA, domain.KeyStateActive))
			first := createSigningKey(t, d, newTestSigningKey(projectID, jose.RS256, domain.KeyStateActive))

			err := d.stmts.CreateSigningKey(t.Context(), newTestSigningKey(projectID, jose.RS256, domain.KeyStateActive))
			assert.ErrorIs(t, err, new(database.UniqueError))

			assert.Equal(t, signingKeyIDs(first), listSigningKeyIDs(t, d, database.And(
				database.Equal(database.Col(domain.SigningKeyFieldProjectID), projectID),
				database.Equal(database.Col(domain.SigningKeyFieldState), domain.KeyStateActive),
				database.Equal(database.Col(domain.SigningKeyFieldAlgorithm), jose.RS256),
			)), "the refused key left the first one the only active RS256 key")
		})

		t.Run("a key that is not active does not count", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			createSigningKey(t, d, newTestSigningKey(projectID, jose.ES256, domain.KeyStateActive))
			for _, state := range []domain.KeyState{
				domain.KeyStateNotActiveYet,
				domain.KeyStateNotActiveYet,
				domain.KeyStateExpired,
				domain.KeyStateExpired,
				domain.KeyStateRemoved,
			} {
				createSigningKey(t, d, newTestSigningKey(projectID, jose.ES256, state))
			}
		})

		t.Run("projects hold their active keys apart", func(t *testing.T) {
			createSigningKey(t, d, newTestSigningKey(ensureProject(t, d.stmts), jose.RS256, domain.KeyStateActive))
			createSigningKey(t, d, newTestSigningKey(ensureProject(t, d.stmts), jose.RS256, domain.KeyStateActive))
		})
	})
}
