package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// The old collection is one whole segment, under the prefix or at the root:
// a name that only starts with its letters is another collection's.
func TestFlowsPath(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct{ path, want string }{
		{path: "/flow", want: "/flows"},
		{path: "/flow/flow_1", want: "/flows/flow_1"},
		{path: "/flow/flow_1/submit", want: "/flows/flow_1/submit"},
		{path: "/flow/", want: "/flows/"},
		{path: "/flow/flow_1/other/deeper", want: "/flows/flow_1/other/deeper"},
		{path: "/api/v1/flow", want: "/api/v1/flows"},
		{path: "/api/v1/flow/flow_1", want: "/api/v1/flows/flow_1"},
		{path: "/api/v1/flow/flow_1/submit", want: "/api/v1/flows/flow_1/submit"},
		// A flow whose ID is the collection's old name.
		{path: "/flow/flow", want: "/flows/flow"},

		{path: "/flows"},
		{path: "/flows/flow_1"},
		{path: "/flows/flow_1/submit"},
		{path: "/flows/flow"},
		{path: "/flowsx"},
		{path: "/flowx/flow_1"},
		{path: "/flow_definitions"},
		{path: "/flow_definitions/flowdef_1"},
		{path: "/flow-definitions"},
		{path: "/flow.json"},
		{path: "/api/v1/flows"},
		{path: "/api/v1/flows/flow_1/submit"},
		{path: "/api/v1/flow_definitions"},
		{path: "/api/v1/flowsx"},
		{path: "/api/v1flow"},
		{path: "/api/v1/api/v1/flow"},
		{path: "/api/v2/flow"},
		{path: "/api/flow"},
		{path: "/users/flow"},
		{path: "/Flow"},
		{path: "flow"},
		{path: "/"},
		{path: ""},
	} {
		got, ok := flowsPath(tt.path)
		assert.Equal(t, tt.want != "", ok, tt.path)
		assert.Equal(t, tt.want, got, tt.path)
	}
}

// The generated router routes the escaped path when a URL carries one, with
// its needless escapes undone: the mapping reads the same string, so it moves
// exactly the requests the router would have taken for the old collection.
func TestLegacyFlowPathTarget(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name, url         string
		wantPath, wantRaw string // wantPath empty: not a path of the old collection
	}{
		{name: "plain", url: "/flow/flow_1/submit?x=1", wantPath: "/flows/flow_1/submit"},
		{name: "under the prefix", url: "/api/v1/flow", wantPath: "/api/v1/flows"},
		{name: "an escaped letter of the collection", url: "/%66low", wantPath: "/flows", wantRaw: "/flows"},
		{name: "an escaped letter under the prefix", url: "/api/v1/fl%6Fw/flow_1", wantPath: "/api/v1/flows/flow_1", wantRaw: "/api/v1/flows/flow_1"},
		{name: "an escaped letter of the prefix", url: "/api/v%31/flow", wantPath: "/api/v1/flows", wantRaw: "/api/v1/flows"},
		{name: "an escaped letter of submit", url: "/flow/flow_1/%73ubmit", wantPath: "/flows/flow_1/submit", wantRaw: "/flows/flow_1/submit"},
		{name: "an escaped slash in the flow ID stays in it", url: "/flow/a%2Fb/submit", wantPath: "/flows/a/b/submit", wantRaw: "/flows/a%2Fb/submit"},
		{name: "a lower-case escape is upper-cased as the router does", url: "/flow/a%2fb", wantPath: "/flows/a/b", wantRaw: "/flows/a%2Fb"},

		{name: "an escaped slash makes one longer segment", url: "/flow%2Fflow_1"},
		{name: "an escaped slash after the prefix", url: "/api/v1%2Fflow"},
		{name: "the new collection, escaped", url: "/flow%73/flow_1"},
		{name: "the new collection", url: "/flows/a%2Fb"},
		{name: "flow definitions", url: "/flow_definitions/a%2Fb"},
		{name: "flow definitions, escaped", url: "/flow%5Fdefinitions"},
		{name: "another collection", url: "/users/flow"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			u, err := url.Parse(tt.url)
			require.NoError(t, err)
			sent := *u

			target, ok := LegacyFlowPathTarget(u)
			assert.Equal(t, sent, *u, "the URL the client sent is left as it came")
			if tt.wantPath == "" {
				assert.False(t, ok)
				assert.Nil(t, target)
				return
			}
			require.True(t, ok)
			assert.Equal(t, tt.wantPath, target.Path)
			assert.Equal(t, tt.wantRaw, target.RawPath)
			assert.Equal(t, u.RawQuery, target.RawQuery)
		})
	}

	t.Run("an escaped path that does not parse falls back to the path, as the router does", func(t *testing.T) {
		t.Parallel()
		target, ok := LegacyFlowPathTarget(&url.URL{Path: "/flow/flow_1", RawPath: "/flow/%zz"})
		require.True(t, ok)
		assert.Equal(t, "/flows/flow_1", target.Path)
	})
}

// flowCalls answers the three flow operations with a refusal that tells
// which one ran, and for which flow.
type flowCalls struct {
	api.UnimplementedHandler
	mutex sync.Mutex
	got   []string
}

func (f *flowCalls) record(call string) error {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	f.got = append(f.got, call)
	return domain.ErrFlowRestartRequired()
}

func (f *flowCalls) CreateFlow(_ context.Context, req *api.CreateFlowRequest, _ api.CreateFlowParams) (api.CreateFlowRes, error) {
	return nil, f.record("createFlow " + string(req.ProjectID))
}

func (f *flowCalls) GetFlowStep(_ context.Context, params api.GetFlowStepParams) (api.GetFlowStepRes, error) {
	return nil, f.record("getFlowStep " + params.FlowID)
}

func (f *flowCalls) SubmitFlowStep(_ context.Context, _ *api.FlowSubmitRequest, params api.SubmitFlowStepParams) (api.SubmitFlowStepRes, error) {
	return nil, f.record("submitFlowStep " + params.FlowID)
}

type flowMount struct {
	mux     *http.ServeMux
	handler *flowCalls
	// logged holds the path the middleware around the routers read for each
	// request, after it was served: what the access log writes.
	logged []string
}

func newFlowMount(t *testing.T) *flowMount {
	t.Helper()
	m := &flowMount{mux: http.NewServeMux(), handler: &flowCalls{}}
	servers, err := NewServers(m.handler, admitAll{},
		api.WithErrorHandler(OgenErrorHandler(0)),
		api.WithNotFound(OgenNotFound(nil)),
		api.WithMethodNotAllowed(OgenMethodNotAllowed),
	)
	require.NoError(t, err)
	chain := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
			m.logged = append(m.logged, r.URL.EscapedPath())
		})
	}
	MountAPI(m.mux, chain, chain, servers)
	return m
}

func (m *flowMount) serve(method, target, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.AddCookie(&http.Cookie{Name: "_zflow", Value: "sealed"})
	rec := httptest.NewRecorder()
	m.mux.ServeHTTP(rec, req)
	return rec
}

// A login component or SDK released before the collection became `/flows`
// still reaches the three flow operations at `/flow`, under the prefix and at
// the root, and is told the path is deprecated. The new path is told nothing.
func TestMountAPIAnswersTheFlowOperationsAtTheirOldPath(t *testing.T) {
	t.Parallel()

	const start = `{"project_id":"proj_1","purpose":"login"}`
	const submit = `{"action":"submit"}`
	for _, tt := range []struct {
		name, method, old, current, body, call string
	}{
		{name: "createFlow", method: http.MethodPost, old: "/flow", current: "/flows", body: start, call: "createFlow proj_1"},
		{name: "getFlowStep", method: http.MethodGet, old: "/flow/flow_1", current: "/flows/flow_1", call: "getFlowStep flow_1"},
		{name: "submitFlowStep", method: http.MethodPost, old: "/flow/flow_1/submit", current: "/flows/flow_1/submit", body: submit, call: "submitFlowStep flow_1"},
		{name: "getFlowStep of a flow named as the old collection", method: http.MethodGet, old: "/flow/flow", current: "/flows/flow", call: "getFlowStep flow"},
		{name: "createFlow by an escaped letter", method: http.MethodPost, old: "/%66low", current: "/flows", body: start, call: "createFlow proj_1"},
		{name: "getFlowStep with an escaped slash in the ID", method: http.MethodGet, old: "/flow/a%2Fb", current: "/flows/a%2Fb", call: "getFlowStep a/b"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			m := newFlowMount(t)

			want := m.serve(tt.method, "/api/v1"+tt.current, tt.body)
			require.Equal(t, http.StatusConflict, want.Code, want.Body.String())
			assert.Empty(t, want.Header().Get("Deprecation"))
			assert.Empty(t, want.Header().Values("Link"))

			old := m.serve(tt.method, "/api/v1"+tt.old, tt.body)
			assert.Equal(t, want.Code, old.Code)
			assert.Equal(t, want.Body.String(), old.Body.String())
			assert.Equal(t, legacyFlowPathDeprecation, old.Header().Get("Deprecation"))
			assert.Equal(t, []string{legacyFlowPathLink}, old.Header().Values("Link"))

			// The root alias names its own, earlier, date, and its Link first.
			root := m.serve(tt.method, tt.old, tt.body)
			assert.Equal(t, want.Code, root.Code)
			assert.Equal(t, want.Body.String(), root.Body.String())
			assert.Equal(t, rootPathDeprecation, root.Header().Get("Deprecation"))
			assert.Equal(t, []string{rootPathDeprecationLink, legacyFlowPathLink}, root.Header().Values("Link"))

			rootCurrent := m.serve(tt.method, tt.current, tt.body)
			assert.Equal(t, want.Code, rootCurrent.Code)
			assert.Equal(t, []string{rootPathDeprecationLink}, rootCurrent.Header().Values("Link"))

			assert.Equal(t, []string{tt.call, tt.call, tt.call, tt.call}, m.handler.got)
			// The access log keeps the path the client sent.
			assert.Equal(t, []string{"/api/v1" + tt.current, "/api/v1" + tt.old, tt.old, tt.current}, m.logged)
		})
	}
}

// A request on the old collection that names no operation gets the answer the
// new collection gives it, and no word on deprecation: no operation moved.
// Another collection whose name starts with the old one's letters is not the
// old collection at all.
func TestMountAPIDeprecatesOnlyFlowOperationsAtTheOldPath(t *testing.T) {
	t.Parallel()
	m := newFlowMount(t)

	for _, tt := range []struct {
		method, old, current string
		status               int
	}{
		{method: http.MethodGet, old: "/flow", current: "/flows", status: http.StatusMethodNotAllowed},
		{method: http.MethodDelete, old: "/flow/flow_1", current: "/flows/flow_1", status: http.StatusMethodNotAllowed},
		{method: http.MethodGet, old: "/flow/flow_1/submit", current: "/flows/flow_1/submit", status: http.StatusMethodNotAllowed},
		{method: http.MethodPost, old: "/flow/flow_1/other", current: "/flows/flow_1/other", status: http.StatusNotFound},
		// The router reads an empty flow ID here, which takes no POST.
		{method: http.MethodPost, old: "/flow/", current: "/flows/", status: http.StatusMethodNotAllowed},
		{method: http.MethodPost, old: "/flow%2Fflow_1", current: "/flows%2Fflow_1", status: http.StatusNotFound},
	} {
		for _, prefix := range []string{"/api/v1", ""} {
			name := tt.method + " " + prefix + tt.old
			want := m.serve(tt.method, prefix+tt.current, "")
			require.Equal(t, tt.status, want.Code, name)

			got := m.serve(tt.method, prefix+tt.old, "")
			assert.Equal(t, want.Code, got.Code, name)
			assert.Equal(t, want.Body.String(), got.Body.String(), name)
			assert.Equal(t, want.Header().Get("Allow"), got.Header().Get("Allow"), name)
			assert.Empty(t, got.Header().Get("Deprecation"), name)
			assert.Empty(t, got.Header().Values("Link"), name)
		}
	}

	// Paths of other collections: served as they came, and the flow
	// operations' deprecation never names them. The flow definitions ask for
	// the credential this request does not send, which no flow operation does.
	for _, tt := range []struct {
		method, path string
		status       int
	}{
		{method: http.MethodGet, path: "/api/v1/flow_definitions?project_id=proj_1", status: http.StatusUnauthorized},
		{method: http.MethodGet, path: "/api/v1/flow_definitions/flowdef_1?project_id=proj_1", status: http.StatusUnauthorized},
		{method: http.MethodPost, path: "/api/v1/flowsx", status: http.StatusNotFound},
		{method: http.MethodPost, path: "/api/v1/flowx/flow_1/submit", status: http.StatusNotFound},
		{method: http.MethodPost, path: "/api/v1/users/flow", status: http.StatusMethodNotAllowed},
	} {
		rec := m.serve(tt.method, tt.path, "")
		assert.Equal(t, tt.status, rec.Code, tt.path+": "+rec.Body.String())
		assert.Empty(t, rec.Header().Get("Deprecation"), tt.path)
		assert.Empty(t, rec.Header().Values("Link"), tt.path)
	}
	// At the root only the root alias speaks.
	root := m.serve(http.MethodGet, "/flow_definitions?project_id=proj_1", "")
	assert.Equal(t, http.StatusUnauthorized, root.Code, root.Body.String())
	assert.Equal(t, []string{rootPathDeprecationLink}, root.Header().Values("Link"))
	assert.Empty(t, m.handler.got, "no request reached a flow operation")
}

// A CORS preflight on the old path keeps ogen's answer for the new one, and
// says nothing about deprecation: it names no operation.
func TestMountAPIAnswersAPreflightOnTheOldFlowPath(t *testing.T) {
	t.Parallel()
	m := newFlowMount(t)

	for _, path := range []string{"/api/v1/flows/flow_1", "/api/v1/flow/flow_1", "/flow/flow_1"} {
		r := httptest.NewRequest(http.MethodOptions, path, nil)
		r.Header.Set("Origin", "https://app.example.com")
		r.Header.Set("Access-Control-Request-Method", http.MethodGet)
		rec := httptest.NewRecorder()
		m.mux.ServeHTTP(rec, r)
		assert.Equal(t, http.StatusNoContent, rec.Code, path)
		assert.Equal(t, "GET", rec.Header().Get("Access-Control-Allow-Methods"), path)
		assert.Empty(t, rec.Header().Get("Deprecation"), path)
	}
}

// RFC 9745: the date as a structured-field date, the link with the relation
// the RFC registers.
func TestLegacyFlowPathDeprecationHeaders(t *testing.T) {
	t.Parallel()
	assert.Regexp(t, `^@[1-9][0-9]*$`, legacyFlowPathDeprecation)
	assert.Equal(t, `<https://preview.zitadel.com/docs/reference/api/flows>; rel="deprecation"; type="text/html"`, legacyFlowPathLink)
	assert.True(t, rootPathDeprecatedSince.Before(legacyFlowPathDeprecatedSince), "the root alias's date is the earlier one a response at the root keeps")
}
