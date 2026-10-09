//go:build postgres_integration || spanner_integration

package integration_test

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/zitadel/v5/api/generated"
	"github.com/zitadel/zitadel/v5/internal/api/integration_test/helpers"
	"github.com/zitadel/zitadel/v5/internal/domain"
)

// idpFixture is a project and a client holding that project's secret.
type idpFixture struct {
	project *domain.Project
	client  *helpers.ApiClient
}

func newIdpFixture(t *testing.T) idpFixture {
	t.Helper()
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	return idpFixture{project: project, client: client}
}

func (f idpFixture) projectID() api.ProjectID { return api.ProjectID(f.project.ID) }

func (f idpFixture) put(t *testing.T, idp api.IdpConnection) api.CreateIdpRes {
	t.Helper()
	resp, err := f.client.CreateIdp(t.Context(), &api.CreateIdpRequest{Idp: idp}, api.CreateIdpParams{ProjectID: f.projectID()})
	require.NoError(t, err)
	return resp
}

func (f idpFixture) create(t *testing.T, idp api.IdpConnection) api.IdpResponse {
	t.Helper()
	resp := f.put(t, idp)
	require.IsType(t, &api.CreateIdpCreated{}, resp, helpers.MustMarshal(t, resp))
	return api.IdpResponse(*resp.(*api.CreateIdpCreated))
}

func (f idpFixture) revise(t *testing.T, idp api.IdpConnection) api.IdpResponse {
	t.Helper()
	resp := f.put(t, idp)
	require.IsType(t, &api.CreateIdpOK{}, resp, helpers.MustMarshal(t, resp))
	return api.IdpResponse(*resp.(*api.CreateIdpOK))
}

func (f idpFixture) get(t *testing.T, id string) api.GetIdpByIdRes {
	t.Helper()
	resp, err := f.client.GetIdpById(t.Context(), api.GetIdpByIdParams{ProjectID: f.projectID(), ID: id})
	require.NoError(t, err)
	return resp
}

func (f idpFixture) getRevision(t *testing.T, revisionID string) api.GetIdpRevisionByIdRes {
	t.Helper()
	resp, err := f.client.GetIdpRevisionById(t.Context(), api.GetIdpRevisionByIdParams{ProjectID: f.projectID(), RevisionID: revisionID})
	require.NoError(t, err)
	return resp
}

func (f idpFixture) listRevisions(t *testing.T, params api.ListIdpRevisionsParams) api.ListIdpRevisionsRes {
	t.Helper()
	params.ProjectID = f.projectID()
	resp, err := f.client.ListIdpRevisions(t.Context(), params)
	require.NoError(t, err)
	return resp
}

func (f idpFixture) query(t *testing.T, req *api.QueryIdpsRequest) api.QueryIdpsRes {
	t.Helper()
	resp, err := f.client.QueryIdps(t.Context(), req, api.QueryIdpsParams{ProjectID: f.projectID()})
	require.NoError(t, err)
	return resp
}

func (f idpFixture) queryOK(t *testing.T, req *api.QueryIdpsRequest) *api.QueryIdpsResponse {
	t.Helper()
	resp := f.query(t, req)
	require.IsType(t, &api.QueryIdpsResponse{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.QueryIdpsResponse)
}

// postRaw sends a hand-written body to POST /idps. The generated client
// validates the request itself and would never send the invalid documents
// these tests are about.
func (f idpFixture) postRaw(t *testing.T, body string) (int, api.ErrorDetails) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		harness.EnsureTestServer(t).URL+"/idps?project_id="+url.QueryEscape(f.project.ID),
		strings.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+f.client.Token())

	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, *helpers.MustUnmarshal[api.ErrorDetails](t, raw)
}

func slugFilter(op api.FilterOperation, value string) api.QueryIdpsRequestFilterItem {
	return api.QueryIdpsRequestFilterItem{
		Field:     api.IdpFilterFieldSlug,
		Operation: op,
		Value:     api.NewOptFilterValue(api.NewStringFilterValue(value)),
	}
}

func idpIDs(idps []api.IdpResponse) []string {
	ids := make([]string, 0, len(idps))
	for _, idp := range idps {
		ids = append(ids, idp.ID)
	}
	return ids
}

func revisionIDs(idps []api.IdpResponse) []string {
	ids := make([]string, 0, len(idps))
	for _, idp := range idps {
		ids = append(ids, idp.RevisionID)
	}
	return ids
}

// TestCreateIdp covers create-or-revise (#1003): a new slug creates the
// connection, the same slug appends a revision under the same id, and a
// revision may not change the fields that identify the provider.
func TestCreateIdp(t *testing.T) {
	t.Parallel()
	f := newIdpFixture(t)

	google := helpers.OIDCConnection("google")
	created := f.create(t, google)
	assert.True(t, domain.PrefixIDPConnection.Matches(created.ID), created.ID)
	assert.True(t, domain.PrefixIDPConnectionRevision.Matches(created.RevisionID), created.RevisionID)
	assert.Equal(t, "google", created.Slug)

	google.Oidc.Value.Scopes = []string{"openid", "email"}
	revised := f.revise(t, google)

	t.Run("the same slug revises the connection under its id", func(t *testing.T) {
		assert.Equal(t, created.ID, revised.ID)
		assert.NotEqual(t, created.RevisionID, revised.RevisionID)
		assert.True(t, created.CreatedAt.Equal(revised.CreatedAt), "created_at is the connection's, not the revision's")
		assert.False(t, revised.UpdatedAt.Before(created.UpdatedAt))
		assert.Equal(t, []string{"openid", "email"}, revised.Definition.Oidc.Value.Scopes)
	})

	t.Run("get returns the newest revision as stored", func(t *testing.T) {
		resp := f.get(t, created.ID)
		require.IsType(t, &api.IdpResponse{}, resp, helpers.MustMarshal(t, resp))
		assert.JSONEq(t, helpers.MustMarshal(t, revised), helpers.MustMarshal(t, resp))
	})

	t.Run("changing identity fields is rejected with every field named", func(t *testing.T) {
		changed := google
		oidc := changed.Oidc.Value
		oidc.Issuer = "https://login.example.com"
		changed.Oidc = api.NewOptIdpConnectionOidc(oidc)
		changed.SubjectClaim = api.NewOptString("oid")

		resp := f.put(t, changed)
		require.IsType(t, &api.CreateIdpBadRequest{}, resp, helpers.MustMarshal(t, resp))
		body := resp.(*api.CreateIdpBadRequest)
		assert.Equal(t, api.ErrorCode(domain.ErrIDPConnectionFieldImmutable(nil).Code), body.Code)
		assert.JSONEq(t, `{"fields":["subject_claim","oidc.issuer"]}`, string(body.Details.Value["details"]))

		after := f.get(t, created.ID)
		require.IsType(t, &api.IdpResponse{}, after, helpers.MustMarshal(t, after))
		assert.Equal(t, revised.RevisionID, after.(*api.IdpResponse).RevisionID, "nothing was stored")
	})
}

// TestCreateIdpRejectsInvalidDocuments sends documents the idp-connection.json
// schema forbids. None of them may be stored.
func TestCreateIdpRejectsInvalidDocuments(t *testing.T) {
	t.Parallel()
	f := newIdpFixture(t)

	const oidcBlock = `"issuer":"https://accounts.google.com","client_id":"id","scopes":["openid"]`
	tests := []struct {
		name string
		body string
		// property is the part of the document the error details name.
		property string
	}{
		{
			name:     "a literal client secret",
			body:     `{"idp":{"slug":"literal","protocol":"oidc","display_name":"X","oidc":{` + oidcBlock + `,"client_secret":"hunter2"}}}`,
			property: "idp.oidc.client_secret",
		},
		{
			name:     "a cleartext endpoint",
			body:     `{"idp":{"slug":"cleartext","protocol":"oidc","display_name":"X","oidc":{"issuer":"http://accounts.example.com","client_id":"id","scopes":["openid"],"client_secret":"${{ S }}"}}}`,
			property: "idp.oidc.issuer",
		},
		{
			name:     "a protocol without its block",
			body:     `{"idp":{"slug":"blockless","protocol":"oidc","display_name":"X"}}`,
			property: "oidc",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, details := f.postRaw(t, tt.body)
			assert.Equal(t, http.StatusBadRequest, status)
			assert.Equal(t, api.ErrorCode(domain.ErrRequestInvalid().Code), details.Code)
			assert.Contains(t, string(details.Details.Value["details"]), tt.property)
		})
	}

	listed := f.queryOK(t, &api.QueryIdpsRequest{})
	assert.Empty(t, listed.Idps, "no invalid document was stored")
}

// TestQueryIdps lists each connection once, at its newest revision.
func TestQueryIdps(t *testing.T) {
	t.Parallel()
	f := newIdpFixture(t)

	alpha := f.create(t, helpers.OIDCConnection("alpha"))
	beta := f.create(t, helpers.OIDCConnection("beta"))
	gammaDoc := helpers.OIDCConnection("gamma")
	f.create(t, gammaDoc)
	gammaDoc.DisplayName = "Gamma"
	gamma := f.revise(t, gammaDoc)

	t.Run("one row per connection at its newest revision", func(t *testing.T) {
		listed := f.queryOK(t, &api.QueryIdpsRequest{})
		assert.Equal(t, []string{alpha.ID, beta.ID, gamma.ID}, idpIDs(listed.Idps))
		assert.Equal(t, gamma.RevisionID, listed.Idps[2].RevisionID)
		assert.Equal(t, "Gamma", listed.Idps[2].Definition.DisplayName)
	})

	t.Run("filter by slug", func(t *testing.T) {
		equals := f.queryOK(t, &api.QueryIdpsRequest{Filter: []api.QueryIdpsRequestFilterItem{slugFilter(api.FilterOperationEquals, "beta")}})
		assert.Equal(t, []string{beta.ID}, idpIDs(equals.Idps))

		contains := f.queryOK(t, &api.QueryIdpsRequest{Filter: []api.QueryIdpsRequestFilterItem{slugFilter(api.FilterOperationContains, "MM")}})
		assert.Equal(t, []string{gamma.ID}, idpIDs(contains.Idps), "contains folds case")
	})

	// The wire carries created_at in whole seconds and the three connections
	// were likely created within one, so the bounds sit an hour away.
	t.Run("filter by created_at range", func(t *testing.T) {
		createdAt := func(op api.FilterOperation, at time.Time) *api.QueryIdpsRequest {
			return &api.QueryIdpsRequest{Filter: []api.QueryIdpsRequestFilterItem{{
				Field:     api.IdpFilterFieldCreatedAt,
				Operation: op,
				Value:     api.NewOptFilterValue(api.NewStringFilterValue(at.Format(time.RFC3339))),
			}}}
		}
		later := gamma.CreatedAt.Add(time.Hour)
		before := f.queryOK(t, createdAt(api.FilterOperationLessThan, later))
		assert.Equal(t, []string{alpha.ID, beta.ID, gamma.ID}, idpIDs(before.Idps))
		after := f.queryOK(t, createdAt(api.FilterOperationGreaterThan, later))
		assert.Empty(t, after.Idps)
	})

	t.Run("sort by slug in both directions", func(t *testing.T) {
		desc := f.queryOK(t, &api.QueryIdpsRequest{Sorting: api.NewOptQueryIdpsRequestSorting(api.QueryIdpsRequestSorting{
			Field: api.IdpFilterFieldSlug, Direction: api.SortDirectionDesc,
		})})
		assert.Equal(t, []string{gamma.ID, beta.ID, alpha.ID}, idpIDs(desc.Idps))

		asc := f.queryOK(t, &api.QueryIdpsRequest{Sorting: api.NewOptQueryIdpsRequestSorting(api.QueryIdpsRequestSorting{
			Field: api.IdpFilterFieldSlug, Direction: api.SortDirectionAsc,
		})})
		assert.Equal(t, []string{alpha.ID, beta.ID, gamma.ID}, idpIDs(asc.Idps))
	})

	t.Run("pages follow the cursor", func(t *testing.T) {
		first := f.queryOK(t, &api.QueryIdpsRequest{Limit: api.NewOptLimit(2)})
		assert.Equal(t, []string{alpha.ID, beta.ID}, idpIDs(first.Idps))
		require.True(t, first.NextPageToken.IsSet())

		rest := f.queryOK(t, &api.QueryIdpsRequest{Limit: api.NewOptLimit(2), PageToken: api.NewOptNilPageToken(first.NextPageToken.Value)})
		assert.Equal(t, []string{gamma.ID}, idpIDs(rest.Idps))
		assert.False(t, rest.NextPageToken.IsSet())
	})

	t.Run("not_equals is not implemented", func(t *testing.T) {
		resp := f.query(t, &api.QueryIdpsRequest{Filter: []api.QueryIdpsRequestFilterItem{slugFilter(api.FilterOperationNotEquals, "beta")}})
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusNotImplemented, status)
		assert.Equal(t, domain.ErrNotImplemented().Code, code)
	})
}

// TestIdpRevisions covers the history reads: the list is newest first and
// pages, and a revision id reads back that exact revision.
func TestIdpRevisions(t *testing.T) {
	t.Parallel()
	f := newIdpFixture(t)

	doc := helpers.OIDCConnection("history")
	first := f.create(t, doc)
	doc.DisplayName = "Second"
	second := f.revise(t, doc)
	doc.DisplayName = "Third"
	third := f.revise(t, doc)

	t.Run("revisions list newest first with cursors", func(t *testing.T) {
		resp := f.listRevisions(t, api.ListIdpRevisionsParams{ID: first.ID, Limit: api.NewOptLimit(2)})
		require.IsType(t, &api.ListIdpRevisionsResponse{}, resp, helpers.MustMarshal(t, resp))
		page := resp.(*api.ListIdpRevisionsResponse)
		assert.Equal(t, []string{third.RevisionID, second.RevisionID}, revisionIDs(page.Revisions))
		require.True(t, page.NextPageToken.IsSet())

		resp = f.listRevisions(t, api.ListIdpRevisionsParams{
			ID: first.ID, Limit: api.NewOptLimit(2), PageToken: api.NewOptPageToken(page.NextPageToken.Value),
		})
		require.IsType(t, &api.ListIdpRevisionsResponse{}, resp, helpers.MustMarshal(t, resp))
		rest := resp.(*api.ListIdpRevisionsResponse)
		assert.Equal(t, []string{first.RevisionID}, revisionIDs(rest.Revisions))
		assert.False(t, rest.NextPageToken.IsSet())
	})

	t.Run("a revision id reads back that revision", func(t *testing.T) {
		resp := f.getRevision(t, first.RevisionID)
		require.IsType(t, &api.IdpResponse{}, resp, helpers.MustMarshal(t, resp))
		got := resp.(*api.IdpResponse)
		assert.Equal(t, first.RevisionID, got.RevisionID)
		assert.Equal(t, "Google", got.Definition.DisplayName)
		assert.JSONEq(t, helpers.MustMarshal(t, first.Definition), helpers.MustMarshal(t, got.Definition))
	})

	t.Run("a connection id is not a revision id", func(t *testing.T) {
		assertAuthzError(t, f.getRevision(t, first.ID), domain.ErrIDPConnectionNotFound().Code)
	})

	other := newIdpFixture(t)
	foreign := other.create(t, helpers.OIDCConnection("foreign"))
	for name, ids := range map[string]struct{ id, revisionID string }{
		"an unknown id":                {"idp_does_not_exist", "idprev_does_not_exist"},
		"another project's connection": {foreign.ID, foreign.RevisionID},
	} {
		t.Run(name+" is not found", func(t *testing.T) {
			notFound := domain.ErrIDPConnectionNotFound().Code
			assertAuthzError(t, f.get(t, ids.id), notFound)
			assertAuthzError(t, f.listRevisions(t, api.ListIdpRevisionsParams{ID: ids.id}), notFound)
			assertAuthzError(t, f.getRevision(t, ids.revisionID), notFound)
		})
	}
}

// TestIdpAccess covers who may read and write connections. Every route names
// a project, so a caller without access to it gets the same 404 an unknown
// connection gets.
func TestIdpAccess(t *testing.T) {
	t.Parallel()
	owner := newIdpFixture(t)
	connection := owner.create(t, helpers.OIDCConnection("google"))

	t.Run("a caller without access to the project gets 404 everywhere", func(t *testing.T) {
		outsider := newIdpFixture(t)
		// The outsider's own secret, pointed at the owner's project.
		outsider.project = owner.project

		notFound := domain.ErrIDPConnectionNotFound().Code
		assertAuthzError(t, outsider.put(t, helpers.OIDCConnection("intruder")), notFound)
		assertAuthzError(t, outsider.get(t, connection.ID), notFound)
		assertAuthzError(t, outsider.getRevision(t, connection.RevisionID), notFound)
		assertAuthzError(t, outsider.listRevisions(t, api.ListIdpRevisionsParams{ID: connection.ID}), notFound)
		assertAuthzError(t, outsider.query(t, &api.QueryIdpsRequest{}), notFound)
	})

	t.Run("a viewer reads but cannot write", func(t *testing.T) {
		viewer := newIdpFixture(t)
		conn := viewer.create(t, helpers.OIDCConnection("google"))
		replaceSecretGrant(t, viewer.project, domain.NewProjectAssignmentScope())

		resp := viewer.get(t, conn.ID)
		require.IsType(t, &api.IdpResponse{}, resp, helpers.MustMarshal(t, resp))

		denied := viewer.put(t, helpers.OIDCConnection("another"))
		require.IsType(t, &api.CreateIdpForbidden{}, denied, helpers.MustMarshal(t, denied))
		assert.Equal(t, api.ErrorCode(domain.ErrIDPConnectionPermissionDenied().Code), denied.(*api.CreateIdpForbidden).Code)
	})

	t.Run("unauthenticated calls are rejected", func(t *testing.T) {
		anonymous, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		f := idpFixture{project: owner.project, client: anonymous}

		unauthorized := domain.ErrAuthUnauthorized(nil).Code
		assertAuthzError(t, f.put(t, helpers.OIDCConnection("google")), unauthorized)
		assertAuthzError(t, f.get(t, connection.ID), unauthorized)
		assertAuthzError(t, f.getRevision(t, connection.RevisionID), unauthorized)
		assertAuthzError(t, f.listRevisions(t, api.ListIdpRevisionsParams{ID: connection.ID}), unauthorized)
		assertAuthzError(t, f.query(t, &api.QueryIdpsRequest{}), unauthorized)
	})
}

// TestQueryIdpsPartialGrant lists connections for a secret whose only grant
// is viewer on one connection: the list answers 200 with that connection only.
//
// No t.Parallel(), for the reason TestListAuthzTeamScopedOnlyPartialView gives:
// the authz list predicate is costly on the Spanner emulator in proportion to
// the rows other tests left behind.
func TestQueryIdpsPartialGrant(t *testing.T) {
	f := newIdpFixture(t)
	granted := f.create(t, helpers.OIDCConnection("granted"))
	hidden := f.create(t, helpers.OIDCConnection("hidden"))

	replaceSecretGrant(t, f.project, domain.NewResourceAssignmentScope(granted.ID))

	listed := f.queryOK(t, &api.QueryIdpsRequest{})
	assert.Equal(t, []string{granted.ID}, idpIDs(listed.Idps))

	// The by-id reads resolve the connection through the resource scope
	// index, so the grant reaches the granted connection and its history.
	got := f.get(t, granted.ID)
	require.IsType(t, &api.IdpResponse{}, got, helpers.MustMarshal(t, got))
	revisions := f.listRevisions(t, api.ListIdpRevisionsParams{ID: granted.ID})
	require.IsType(t, &api.ListIdpRevisionsResponse{}, revisions, helpers.MustMarshal(t, revisions))
	assert.Equal(t, []string{granted.RevisionID}, revisionIDs(revisions.(*api.ListIdpRevisionsResponse).Revisions))

	// Another connection of the same project is found, but the grant does not
	// cover it.
	denied := domain.ErrIDPConnectionPermissionDenied().Code
	hiddenGet := f.get(t, hidden.ID)
	require.IsType(t, &api.GetIdpByIdForbidden{}, hiddenGet, helpers.MustMarshal(t, hiddenGet))
	assertAuthzError(t, hiddenGet, denied)
	hiddenRevisions := f.listRevisions(t, api.ListIdpRevisionsParams{ID: hidden.ID})
	require.IsType(t, &api.ListIdpRevisionsForbidden{}, hiddenRevisions, helpers.MustMarshal(t, hiddenRevisions))
	assertAuthzError(t, hiddenRevisions, denied)

	// A single revision has no index row, so its read checks the whole
	// project, which a grant on one connection does not cover.
	revision := f.getRevision(t, granted.RevisionID)
	require.IsType(t, &api.GetIdpRevisionByIdForbidden{}, revision, helpers.MustMarshal(t, revision))
	assertAuthzError(t, revision, denied)
}

// replaceSecretGrant swaps the project secret's seeded admin grant for a
// viewer grant at scope.
func replaceSecretGrant(t *testing.T, project *domain.Project, scope domain.AuthzAssignmentScope) {
	t.Helper()
	stmts := harness.EnsureServiceDB(t).Statements()
	asgns, err := stmts.ListAuthzAssignments(t.Context(), project.ID, domain.AuthzPrincipalTypeSKProj, project.ID, false)
	require.NoError(t, err)
	require.NotEmpty(t, asgns, "CreateProject seeds sk_proj as project admin")
	for _, a := range asgns {
		require.NoError(t, stmts.RevokeAuthzAssignment(t.Context(), project.ID, a.ID))
	}
	viewer := &domain.AuthzAssignment{
		ProjectID:     project.ID,
		CatalogID:     domain.SystemCatalogID,
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   project.ID,
		ObjectType:    "project",
		Relation:      "viewer",
	}
	viewer.ApplyScope(scope)
	require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), viewer))
}
