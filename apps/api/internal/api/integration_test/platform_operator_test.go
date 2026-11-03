//go:build postgres_integration || spanner_integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/events"
)

// platformUser creates a user in the shared platform project, with no team,
// and deletes it when the test ends: the platform project outlives the test
// (internal/AGENTS.md).
func platformUser(t *testing.T) string {
	t.Helper()
	platform := harness.EnsurePlatformProject(t)
	userID := "user_" + helpers.RandString(8)
	email, err := domain.NewCreateAttribute("email", helpers.RandString(8)+"@example.com", domain.AttributeUniquenessProject)
	require.NoError(t, err)
	require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
		ProjectID:  platform.ID,
		SchemaURL:  apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL),
		ID:         userID,
		Attributes: domain.CreateAttributes{*email},
	}))
	t.Cleanup(func() {
		_ = harness.EnsureServiceDB(t).Statements().DeleteUserByID(context.Background(), platform.ID, userID)
	})
	return userID
}

// grantPlatformOperator writes the assignment platform.operators would
// reconcile for userID (ADR 075 §4) and revokes it when the test ends.
func grantPlatformOperator(t *testing.T, userID string) {
	t.Helper()
	platform := harness.EnsurePlatformProject(t)
	grant := domain.NewPlatformOperatorAssignment(platform.ID, userID)
	stmts := harness.EnsureServiceDB(t).Statements()
	require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), grant))
	t.Cleanup(func() { _ = stmts.RevokeAuthzAssignment(context.Background(), platform.ID, grant.ID) })
}

// listsProject pages listMyProjects with the session until it finds projectID,
// and reports whether it did. The test database holds every project the
// package's tests created, so for an operator the target is rarely on the
// first page.
func listsProject(t *testing.T, cookie *http.Cookie, projectID string) bool {
	t.Helper()
	path := "/users/me/projects?limit=100"
	for range 500 {
		status, raw := consoleCall(t, cookie, http.MethodGet, path, "")
		require.Equal(t, http.StatusOK, status, raw)
		var page struct {
			Projects []struct {
				ID string `json:"id"`
			} `json:"projects"`
			NextPageToken string `json:"next_page_token"`
		}
		require.NoError(t, json.Unmarshal([]byte(raw), &page))
		for _, p := range page.Projects {
			if p.ID == projectID {
				return true
			}
		}
		if page.NextPageToken == "" {
			return false
		}
		path = "/users/me/projects?limit=100&page_token=" + url.QueryEscape(page.NextPageToken)
	}
	t.Fatal("listMyProjects did not end")
	return false
}

// TestPlatformOperatorConsoleSession pins ADR 075 end to end. A platform
// operator's Console session manages a project nobody granted it, finds it
// among the projects it can act on, and its writes are marked in the
// customer's own events. Nobody else in the platform project gets any of that,
// an administrator of the platform project included (ADR 053 §9).
func TestPlatformOperatorConsoleSession(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	customerUserID, _ := harness.CreateUserOwnedByTeam(t, customer.ID)

	operatorID := platformUser(t)
	grantPlatformOperator(t, operatorID)
	operator := platformSessionCookie(t, operatorID)

	peer := platformSessionCookie(t, platformUser(t))

	adminID := platformUser(t)
	admin := harness.SeedProjectAdmin(t, platform.ID, adminID)
	t.Cleanup(func() {
		_ = harness.EnsureServiceDB(t).Statements().RevokeAuthzAssignment(context.Background(), platform.ID, admin.ID)
	})
	platformAdmin := platformSessionCookie(t, adminID)

	t.Run("an operator manages a project nobody granted it", func(t *testing.T) {
		status, body := consoleCall(t, operator, http.MethodGet, "/projects/"+customer.ID, "")
		assert.Equal(t, http.StatusOK, status, body)

		status, body = consoleCall(t, operator, http.MethodPost, "/users/query?project_id="+customer.ID, `{}`)
		require.Equal(t, http.StatusOK, status, body)
		assert.Contains(t, body, customerUserID)

		status, body = consoleCall(t, operator, http.MethodPatch, "/projects/"+customer.ID, `{"name":"renamed by an operator"}`)
		assert.Equal(t, http.StatusOK, status, body)
	})

	t.Run("the customer sees the operator's write marked in its own events", func(t *testing.T) {
		opts := events.ListOptions(customer.ID, 100)
		opts.Filter = database.And(opts.Filter, database.Equal(database.Col(domain.EventFieldActorID), operatorID))
		page, err := harness.EnsureServiceDB(t).Statements().ListEvents(t.Context(), opts)
		require.NoError(t, err)
		require.NotEmpty(t, page.Items, "the operator's change belongs to the customer's stream")
		for _, ev := range page.Items {
			var meta domain.EventMetadata
			require.NoError(t, json.Unmarshal(ev.Metadata, &meta))
			require.NotNil(t, meta.Authorization, "%s", ev.EventType)
			assert.Equal(t, domain.EventAuthorizationPathPlatformOperator, meta.Authorization.Path)
			assert.Equal(t, platform.ID, meta.Authorization.ActorHomeProjectID)
		}
	})

	t.Run("an operator's projects are every project", func(t *testing.T) {
		assert.True(t, listsProject(t, operator, customer.ID))
	})

	for name, cookie := range map[string]*http.Cookie{
		"a platform user":                          peer,
		"an administrator of the platform project": platformAdmin,
	} {
		t.Run(name+" gets none of it", func(t *testing.T) {
			status, body := consoleCall(t, cookie, http.MethodGet, "/projects/"+customer.ID, "")
			assert.Equal(t, http.StatusNotFound, status, body)
			assert.False(t, listsProject(t, cookie, customer.ID))
		})
	}

	t.Run("a deactivated operator loses access though the session lives on", func(t *testing.T) {
		goneID := platformUser(t)
		grantPlatformOperator(t, goneID)
		gone := platformSessionCookie(t, goneID)
		status, body := consoleCall(t, gone, http.MethodGet, "/projects/"+customer.ID, "")
		require.Equal(t, http.StatusOK, status, body)

		require.NoError(t, harness.EnsureServiceDB(t).Statements().DeactivateUser(t.Context(), platform.ID, goneID))
		status, body = consoleCall(t, gone, http.MethodGet, "/projects/"+customer.ID, "")
		assert.Equal(t, http.StatusNotFound, status, body)
	})
}
