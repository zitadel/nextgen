//go:build sqlite_integration

package sqlite

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func uniqueSuffix(t *testing.T) string {
	t.Helper()
	return strings.ReplaceAll(t.Name(), "/", "_") + "-" + rand.Text()
}

func handoffCompletedAttempt(t *testing.T, projectID string, mutate func(*domain.AuthAttempt)) (plainToken string, attempt *domain.AuthAttempt) {
	t.Helper()
	plainToken = "handoff_" + uniqueSuffix(t)
	attempt = &domain.AuthAttempt{
		ProjectID:      projectID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		Checks:         []domain.AuthCheck{&domain.AuthFactorPassword{}},
	}
	if mutate != nil {
		mutate(attempt)
	}
	require.NoError(t, testPool.CreateAuthAttempt(t.Context(), attempt))
	sum := sha256.Sum256([]byte(plainToken))
	attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
	require.NoError(t, testPool.HandoffAuthAttempt(t.Context(), attempt))
	t.Cleanup(func() {
		_ = testPool.DeleteAuthAttemptByID(context.Background(), projectID, attempt.ID)
	})
	return plainToken, attempt
}

func ensureTestUser(t *testing.T, projectID, userID string) {
	t.Helper()
	schemaURL := "https://example.com/schemas/session-test-" + uniqueSuffix(t)
	require.NoError(t, testPool.CreateJSONSchema(t.Context(), &domain.JSONSchema{
		ProjectID: projectID,
		URL:       schemaURL,
		Schema:    []byte(`{"type":"object"}`),
	}))
	emailAttr, err := domain.NewCreateAttribute("email", userID+"@example.com", domain.AttributeUniquenessProject)
	require.NoError(t, err)
	nameAttr, err := domain.NewCreateAttribute("name", userID, domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	require.NoError(t, testPool.CreateUser(t.Context(), &domain.CreateUser{
		ProjectID:  projectID,
		SchemaURL:  schemaURL,
		ID:         userID,
		Attributes: domain.CreateAttributes{*emailAttr, *nameAttr},
	}))
}

func TestSessionStatements_Exchange_basic(t *testing.T) {
	projectID := "proj-sess-ex-" + t.Name()
	require.NoError(t, testPool.CreateProject(t.Context(), &domain.Project{ID: projectID, Name: "s"}))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	plain, attempt := handoffCompletedAttempt(t, projectID, nil)
	exchanged, err := testPool.ExchangeSession(t.Context(), projectID, plain, nil, 0)
	require.NoError(t, err)
	require.NotEmpty(t, exchanged.ID)
	require.NotEmpty(t, exchanged.TokenID)
	t.Cleanup(func() {
		_ = testPool.DeleteSessionByID(context.Background(), projectID, exchanged.ID)
	})

	_, err = testPool.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
	require.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
}

func TestSessionStatements_Exchange_withUserAndPassword(t *testing.T) {
	projectID := "proj-sess-up-" + t.Name()
	require.NoError(t, testPool.CreateProject(t.Context(), &domain.Project{ID: projectID, Name: "s"}))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	userID := "user_1"
	ensureTestUser(t, projectID, userID)
	plain, _ := handoffCompletedAttempt(t, projectID, func(a *domain.AuthAttempt) {
		a.RequiredChecks = []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword}
		userFactor := domain.SetAuthFactorUser(time.Now().UTC())
		userFactor.UserID = userID
		a.Checks = []domain.AuthCheck{userFactor, domain.SetAuthFactorPassword(time.Now().UTC())}
	})

	ttl := 24 * time.Hour
	exchanged, err := testPool.ExchangeSession(t.Context(), projectID, plain, nil, ttl)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = testPool.DeleteSessionByID(context.Background(), projectID, exchanged.ID)
	})
	require.NotNil(t, exchanged.UserID)
	assert.Equal(t, userID, *exchanged.UserID)
	assert.Equal(t, ttl, exchanged.TimeToLive)
}

func TestSessionStatements_Exchange_concurrent(t *testing.T) {
	projectID := "proj-sess-conc-" + t.Name()
	require.NoError(t, testPool.CreateProject(t.Context(), &domain.Project{ID: projectID, Name: "s"}))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	const n = 8
	plains := make([]string, n)
	for i := 0; i < n; i++ {
		userID := fmt.Sprintf("user_%d", i)
		ensureTestUser(t, projectID, userID)
		plain, _ := handoffCompletedAttempt(t, projectID, func(a *domain.AuthAttempt) {
			a.RequiredChecks = []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword}
			uf := domain.SetAuthFactorUser(time.Now().UTC())
			uf.UserID = userID
			a.Checks = []domain.AuthCheck{uf, domain.SetAuthFactorPassword(time.Now().UTC())}
		})
		plains[i] = plain
	}

	type result struct {
		err error
		id  string
	}
	results := make([]result, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			exchanged, err := testPool.ExchangeSession(context.Background(), projectID, plains[i], nil, 24*time.Hour)
			results[i].err = err
			if exchanged != nil {
				results[i].id = exchanged.ID
			}
		}(i)
	}
	wg.Wait()

	for i, r := range results {
		require.NoError(t, r.err, "worker %d: %v", i, r.err)
		require.NotEmpty(t, r.id, "worker %d", i)
		id := r.id
		t.Cleanup(func() {
			_ = testPool.DeleteSessionByID(context.Background(), projectID, id)
		})
	}
}
