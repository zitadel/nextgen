package login

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeAPI stands in for the API's flow operations with one scripted login:
// identifier → password → complete, then the handoff exchange. Every
// response rotates the flow cookie, and every call after the first must
// carry the cookie of the response before it, as the real API demands.
type fakeAPI struct {
	*httptest.Server
	t       *testing.T
	seq     atomic.Int32
	cookie  string
	submits []map[string]any
	// getStatus, when set, is what GET /flows/{id} answers instead of the
	// password step, with the matching documented error body.
	getStatus int
	// noHandoff makes the completing submission a terminal step with nobody
	// signed in, as "no account" ends.
	noHandoff bool
	// challenge is set by a passkey action without a proof: the pending
	// ceremony, re-attached to the password step until the proof arrives.
	challenge bool
}

func newFakeAPI(t *testing.T) *fakeAPI {
	f := &fakeAPI{t: t}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/flows", func(w http.ResponseWriter, r *http.Request) {
		f.step(w, http.StatusCreated, identifierStep)
	})
	mux.HandleFunc("GET /api/v1/flows/{flow_id}", func(w http.ResponseWriter, r *http.Request) {
		f.requireCookie(w, r)
		switch f.getStatus {
		case http.StatusUnauthorized:
			f.errorf(w, f.getStatus, "flow.cookie_expired", "flow cookie has expired")
		case http.StatusInternalServerError:
			f.errorf(w, f.getStatus, "enc_key.decrypt_failed", "the sealed state could not be opened")
		case 0:
			if f.challenge {
				f.step(w, http.StatusOK, passwordStep+","+passkeyChallenge)
			} else {
				f.step(w, http.StatusOK, passwordStep)
			}
		}
	})
	mux.HandleFunc("POST /api/v1/flows/{flow_id}/submit", func(w http.ResponseWriter, r *http.Request) {
		f.requireCookie(w, r)
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		f.submits = append(f.submits, body)
		switch body["action"] {
		case "submit":
			if fields, _ := body["fields"].(map[string]any); fields["password"] == "wrong" {
				f.step(w, http.StatusBadRequest, passwordStep+`,"error":"error.invalid_credentials"`)
			} else if fields["password"] != nil && f.noHandoff {
				f.step(w, http.StatusOK, noAccountStep)
			} else if fields["password"] != nil {
				f.step(w, http.StatusOK, completeStep)
			} else {
				f.step(w, http.StatusOK, passwordStep)
			}
		case "passkey":
			if f.challenge = body["challenge_response"] == nil; f.challenge {
				f.step(w, http.StatusOK, passwordStep+","+passkeyChallenge)
			} else {
				f.step(w, http.StatusOK, completeStep)
			}
		case "sso":
			f.step(w, http.StatusOK, `"name":"sso-redirect","redirect_url":"https://idp.example/authorize","fields":[],"actions":[],"gates":{}`)
		default:
			f.errorf(w, http.StatusBadRequest, "flow.invalid_action", "no such action")
		}
	})
	mux.HandleFunc("POST /api/v1/sessions/exchange", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			HandoffToken string `json:"handoff_token"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		if body.HandoffToken != "hot_1" {
			f.errorf(w, http.StatusBadRequest, "sess.invalid_handoff_token", "unknown handoff token")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Set-Cookie", "__Host-zitadel_session=sess_tok; Path=/; Max-Age=3600; Secure; HttpOnly")
		fmt.Fprint(w, `{"session":{"session_id":"sess_1","project_id":"proj_1","state":"active","factors":[],`+
			`"created_at":"2026-01-01T00:00:00Z","expires_at":"2026-01-02T00:00:00Z"},"session_token":"zst_1"}`)
	})
	f.Server = httptest.NewServer(mux)
	t.Cleanup(f.Close)
	return f
}

const (
	identifierStep = `"name":"identifier","texts":{"title_key":"identifier.title"},` +
		`"fields":[{"name":"email","type":"email","text_key":"identifier.field.email","autocomplete":"username","required":true}],` +
		`"actions":[{"name":"submit","kind":"submit","primary":true,"text_key":"identifier.action.submit"}],"gates":{},` +
		`"sso_providers":[{"id":"idp_1","name":"Example IdP","template":"generic"}]`
	passwordStep = `"name":"password","texts":{"title_key":"password.title"},` +
		`"fields":[{"name":"password","type":"password","text_key":"password.field.password","autocomplete":"current-password","required":true}],` +
		`"actions":[{"name":"submit","kind":"submit","primary":true},{"name":"back","kind":"back"}],"gates":{}`
	passkeyChallenge = `"challenge":{"method":"passkey","challenge_id":"ch_1","options":{"challenge":"Y2hhbGxlbmdl"}}`
	completeStep     = `"name":"done","complete":"show","fields":[],"actions":[],"gates":{}`
	noAccountStep    = `"name":"no-account","texts":{"title_key":"no-account.title"},"complete":"show","fields":[],"actions":[],"gates":{}`
)

func (f *fakeAPI) errorf(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	fmt.Fprintf(w, `{"code":%q,"message":%q}`, code, message)
}

// step answers a flow response around the step's JSON members with a freshly
// rotated cookie.
func (f *fakeAPI) step(w http.ResponseWriter, status int, step string) {
	f.cookie = fmt.Sprintf("sealed-%d", f.seq.Add(1))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Add("Set-Cookie", FlowCookie+"="+f.cookie+"; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Strict")
	w.WriteHeader(status)
	handoff := ""
	if step == completeStep {
		handoff = `,"handoff_token":"hot_1"`
	}
	fmt.Fprintf(w, `{"id":"flow_1","session_id":"sess_1","step":{%s}%s}`, step, handoff)
}

func (f *fakeAPI) requireCookie(w http.ResponseWriter, r *http.Request) {
	cookies := r.CookiesNamed(FlowCookie)
	require.Len(f.t, cookies, 1, "exactly one flow cookie per request")
	require.Equal(f.t, f.cookie, cookies[0].Value, "the last rotated cookie wins")
}

func testConfig(serverURL string) Config {
	return Config{ServerURL: serverURL, ProjectID: "proj_1", ProjectSecret: "zps_test", PublicOrigin: "http://localhost:3000"}
}

func TestFlow(t *testing.T) {
	ctx := t.Context()
	server := newFakeAPI(t)
	flow, err := NewFlow(testConfig(server.URL))
	require.NoError(t, err)

	res, err := flow.Start(ctx)
	require.NoError(t, err)
	assert.Equal(t, "identifier", res.Step.Name)
	assert.Equal(t, "sealed-1", flow.Cookie)
	assert.Equal(t, 600, flow.CookieMaxAge)

	res, err = flow.Submit(ctx, res.ID, "submit", map[string]string{"email": "a@example.com"}, nil)
	require.NoError(t, err)
	assert.Equal(t, "password", res.Step.Name)
	assert.Equal(t, map[string]any{"email": "a@example.com"}, server.submits[0]["fields"])

	// A refused submission is the step again, with its error, not a Go error.
	res, err = flow.Submit(ctx, res.ID, "submit", map[string]string{"password": "wrong"}, nil)
	require.NoError(t, err)
	assert.Equal(t, "error.invalid_credentials", res.Step.Error.Value)
	assert.Equal(t, "sealed-3", flow.Cookie, "a 400 rotates the cookie too")

	res, err = flow.Step(ctx, res.ID)
	require.NoError(t, err)
	assert.Equal(t, "password", res.Step.Name)

	res, err = flow.Submit(ctx, res.ID, "submit", map[string]string{"password": "right"}, nil)
	require.NoError(t, err)
	assert.True(t, res.Step.Complete.IsSet())

	token, maxAge, err := flow.Exchange(ctx, res.HandoffToken.Value)
	require.NoError(t, err)
	assert.Equal(t, "zst_1", token)
	assert.Equal(t, 3600, maxAge, "the API's session lifetime comes along")
}

func TestFlowSSO(t *testing.T) {
	server := newFakeAPI(t)
	flow, err := NewFlow(testConfig(server.URL))
	require.NoError(t, err)
	res, err := flow.Start(t.Context())
	require.NoError(t, err)

	res, err = flow.SubmitSSO(t.Context(), res.ID, "idp_1", "http://localhost:3000/login/?flow=flow_1")
	require.NoError(t, err)
	assert.Equal(t, "https://idp.example/authorize", res.Step.RedirectURL.Value.String())
	assert.Equal(t, "idp_1", server.submits[0]["sso_provider_id"])
	assert.Equal(t, "http://localhost:3000/login/?flow=flow_1", server.submits[0]["return_target"])
}

func TestFlowErrors(t *testing.T) {
	server := newFakeAPI(t)
	flow, err := NewFlow(testConfig(server.URL))
	require.NoError(t, err)
	res, err := flow.Start(t.Context())
	require.NoError(t, err)

	_, err = flow.Submit(t.Context(), res.ID, "nope", nil, nil)
	assert.EqualError(t, err, "login: submit: no such action (flow.invalid_action)")
	assert.False(t, Restartable(err))
	_, _, err = flow.Exchange(t.Context(), "hot_stale")
	assert.EqualError(t, err, "login: exchange: unknown handoff token (sess.invalid_handoff_token)")

	// The {StatusCode, Response} envelope of an error the operation does not
	// list by status, and the codes after which only a new flow helps.
	server.getStatus = http.StatusInternalServerError
	_, err = flow.Step(t.Context(), res.ID)
	assert.EqualError(t, err, "login: get step: the sealed state could not be opened (enc_key.decrypt_failed)")
	assert.False(t, Restartable(err))
	server.getStatus = http.StatusUnauthorized
	_, err = flow.Step(t.Context(), res.ID)
	assert.EqualError(t, err, "login: get step: flow cookie has expired (flow.cookie_expired)")
	assert.True(t, Restartable(err))
}

func TestConfigValidate(t *testing.T) {
	err := Config{Locale: "de"}.Validate()
	assert.EqualError(t, err, "login: config is missing ServerURL, ProjectID, ProjectSecret, PublicOrigin")
	for _, origin := range []string{
		"app.example", "ftp://app.example", "https://", "https://app.example/login",
		// url.Parse normalises each of these away, so only a round-trip
		// comparison rejects them. An upper-case scheme is the dangerous one:
		// it parses as https while secure() used to read it as plain http,
		// which shipped a session cookie with no Secure and no __Host- prefix.
		"HTTPS://app.example", "https://app.example?", "https://app.example#",
		"https://app.example:", "https://user@app.example",
	} {
		cfg := testConfig("http://api.example")
		cfg.PublicOrigin = origin
		assert.Error(t, cfg.Validate(), origin)
	}
	assert.NoError(t, testConfig("http://api.example").Validate())

	secure := testConfig("http://api.example")
	secure.PublicOrigin = "https://app.example"
	assert.True(t, secure.secure())
	assert.False(t, testConfig("http://api.example").secure())
}

func TestCookieMaxAge(t *testing.T) {
	assert.Equal(t, 600, cookieMaxAge("_zflow=v; Max-Age=600; Path=/"))
	assert.Equal(t, 0, cookieMaxAge("_zflow=v; Path=/"))
	assert.Equal(t, 0, cookieMaxAge("_zflow=v; Max-Age=-1"))
	expires := time.Now().Add(90 * time.Second).UTC().Format(http.TimeFormat)
	assert.InDelta(t, 90, cookieMaxAge("s=v; Expires="+expires), 2, "Expires alone becomes the Max-Age it amounts to")
}
