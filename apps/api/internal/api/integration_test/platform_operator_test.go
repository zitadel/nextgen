//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

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

// TestPlatformOperatorReadsUnclaimedEvents pins ADR 049 §4 as amended on
// 2026-11-10: a platform operator reads the events of a project nobody has
// claimed, while the project's own secret and a platform user with a grant on
// it, who is no operator, still read none until the claim.
func TestPlatformOperatorReadsUnclaimedEvents(t *testing.T) {
	t.Parallel()

	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	stored, err := harness.EnsureServiceDB(t).Statements().ListEvents(t.Context(), events.ListOptions(customer.ID, 1))
	require.NoError(t, err)
	require.NotEmpty(t, stored.Items, "creating the project stores its first events")
	eventID := stored.Items[0].ID
	list := "/events?project_id=" + customer.ID
	get := "/events/" + eventID + "?project_id=" + customer.ID

	listed := func(t *testing.T, status int, raw string) []string {
		t.Helper()
		require.Equal(t, http.StatusOK, status, raw)
		var page struct {
			Events []struct {
				ID string `json:"id"`
			} `json:"events"`
		}
		require.NoError(t, json.Unmarshal([]byte(raw), &page))
		ids := make([]string, 0, len(page.Events))
		for _, ev := range page.Events {
			ids = append(ids, ev.ID)
		}
		return ids
	}

	t.Run("an operator reads them", func(t *testing.T) {
		operatorID := platformUser(t)
		grantPlatformOperator(t, operatorID)
		operator := platformSessionCookie(t, operatorID)

		status, raw := consoleCall(t, operator, http.MethodGet, list, "")
		assert.Contains(t, listed(t, status, raw), eventID)

		status, raw = consoleCall(t, operator, http.MethodGet, get, "")
		require.Equal(t, http.StatusOK, status, raw)
		assert.Contains(t, raw, eventID)
	})

	t.Run("the project's own secret reads none", func(t *testing.T) {
		bearer := map[string]string{"Authorization": "Bearer " + harness.ProjectSecret(t, customer)}

		status, raw := cookieRequest(t, nil, http.MethodGet, list, "", bearer)
		assert.Empty(t, listed(t, status, raw))

		status, raw = cookieRequest(t, nil, http.MethodGet, get, "", bearer)
		assert.Equal(t, http.StatusNotFound, status, raw)
	})

	t.Run("a platform user with a grant, who is no operator, reads none", func(t *testing.T) {
		peerID := platformUser(t)
		harness.SeedProjectViewer(t, customer.ID, peerID)
		peer := platformSessionCookie(t, peerID)

		status, raw := consoleCall(t, peer, http.MethodGet, list, "")
		assert.Empty(t, listed(t, status, raw))

		status, raw = consoleCall(t, peer, http.MethodGet, get, "")
		assert.Equal(t, http.StatusNotFound, status, raw)
	})
}

// TestPlatformProjectReadGatesTheRoot pins the read the console lists its root
// pages on (D42, Console ADR 0004 §5): GET /projects/{platform project}
// answers for someone who can act on that project and for nobody else. A
// person homed in it, and one who owns a team in it as every hosted customer
// does, are refused: being signed in to the platform project grants nothing
// (ADR 053 §9).
func TestPlatformProjectReadGatesTheRoot(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	path := "/projects/" + platform.ID

	operatorID := platformUser(t)
	grantPlatformOperator(t, operatorID)

	adminID := platformUser(t)
	admin := harness.SeedProjectAdmin(t, platform.ID, adminID)
	t.Cleanup(func() {
		_ = harness.EnsureServiceDB(t).Statements().RevokeAuthzAssignment(context.Background(), platform.ID, admin.ID)
	})

	teamOwnerID, _ := harness.CreateUserOwnedByTeam(t, platform.ID)

	for name, tc := range map[string]struct {
		userID string
		status int
	}{
		"an operator": {operatorID, http.StatusOK},
		"an administrator of the platform project": {adminID, http.StatusOK},
		"a person homed in it":                     {platformUser(t), http.StatusNotFound},
		// A team-scoped grant is a foothold in the project, so the miss reads
		// as a refusal; the console takes either for "not yours".
		"the owner of a team in it": {teamOwnerID, http.StatusForbidden},
	} {
		t.Run(name, func(t *testing.T) {
			status, body := consoleCall(t, platformSessionCookie(t, tc.userID), http.MethodGet, path, "")
			assert.Equal(t, tc.status, status, body)
		})
	}
}

// TestPinnedPlatformProjectKeepsItsRelations pins the other side of Console
// ADR 0004 §1: writing configuration asks for the admin role on the reserved
// platform project only, the row bootstrap provisions. The harness's platform
// project is an ordinary project the deployment pins, as a self-hoster's only
// project is, so an editor of it still adds an origin from the Console.
func TestPinnedPlatformProjectKeepsItsRelations(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	require.NotEqual(t, domain.PlatformProjectID, platform.ID, "the harness pins an ordinary project")
	path := "/projects/" + platform.ID + "/origins"

	editorID := platformUser(t)
	editor := harness.SeedProjectEditor(t, platform.ID, editorID)
	pattern := fmt.Sprintf("https://pinned-%d.example.com", time.Now().UnixNano())
	t.Cleanup(func() {
		_ = harness.EnsureProjectService(t).RemoveOrigin(context.Background(), platform.ID, pattern)
		_ = harness.EnsureServiceDB(t).Statements().RevokeAuthzAssignment(context.Background(), platform.ID, editor.ID)
	})

	status, body := consoleCall(t, platformSessionCookie(t, editorID), http.MethodPost, path,
		fmt.Sprintf(`{"pattern":%q,"kind":"preview"}`, pattern))
	assert.Less(t, status, http.StatusBadRequest, body)
}
