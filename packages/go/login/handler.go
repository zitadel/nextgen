package login

import (
	"bytes"
	"cmp"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/a-h/templ"

	"go.zitadel.com/zitadel/v5/api"
	"go.zitadel.com/zitadel/v5/login/view"
)

// Mount serves the login at prefix on mux: GET renders the current step and
// POST submits it, every step a plain form, so the whole password path
// works with JavaScript off. A signed-in user gets the session cookie the
// Zitadel SDKs read and lands on the flow's redirect, else on
// cfg.PostSignInURL.
func Mount(mux *http.ServeMux, prefix string, cfg Config) error {
	flow, err := NewFlow(cfg)
	if err != nil {
		return err
	}
	prefix = strings.TrimSuffix(prefix, "/")
	js := passkeyFormJS + passkeyStandaloneJS
	h := &handler{
		cfg:    cfg,
		flow:   flow,
		texts:  Texts{Locale: cfg.Locale},
		log:    cfg.logger(),
		css:    tokensCSS + loginCSS,
		js:     js,
		jsETag: fmt.Sprintf(`"%x"`, sha256.Sum256([]byte(js))),
		path:   prefix + "/",
		// The __Host- prefix needs Path=/ and makes the cookie unsettable by
		// a sibling subdomain, the one way to plant a flow; over plain http
		// the prefix is not allowed, and the login's own path will do.
		cookie: &http.Cookie{Name: FlowCookie, Path: prefix + "/", HttpOnly: true, SameSite: http.SameSiteLaxMode},
	}
	if cfg.secure() {
		h.cookie = &http.Cookie{Name: "__Host-" + FlowCookie, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode}
	}
	mux.HandleFunc("GET "+prefix+"/{$}", h.get)
	mux.HandleFunc("POST "+prefix+"/{$}", h.post)
	mux.HandleFunc("GET "+prefix+"/passkey.js", h.passkeyJS)
	return nil
}

// Handler is the login as a handler of its own, serving at the root of
// wherever it is put. Under a path, Mount it instead: its redirects are
// relative to the request path, which a StripPrefix hides.
func Handler(cfg Config) (http.Handler, error) {
	mux := http.NewServeMux()
	return mux, Mount(mux, "", cfg)
}

type handler struct {
	cfg   Config
	flow  *Flow
	texts Texts
	log   *slog.Logger
	css   string
	// js is passkey.js, the one script a step loads: the glue, then the atom.
	js     string
	jsETag string
	// path is the login's route, where its cookie and redirects point.
	path string
	// cookie is the browser's copy of the flow cookie, without a value.
	cookie *http.Cookie
}

// request is a driver for one request, seeded with the browser's copy of
// the flow cookie.
func (h *handler) request(r *http.Request) *Flow {
	f := *h.flow
	if c, err := r.Cookie(h.cookie.Name); err == nil {
		f.Cookie = c.Value
	}
	return &f
}

// get renders the step of the flow named in the query, resuming it after a
// POST, a reload or an SSO return; without one a new flow starts, and so
// does one the API no longer knows.
func (h *handler) get(w http.ResponseWriter, r *http.Request) {
	flow := h.request(r)
	var res *api.FlowResponse
	var err error
	if id := r.URL.Query().Get("flow"); id != "" && flow.Cookie != "" {
		res, err = flow.Step(r.Context(), id)
	} else {
		res, err = flow.Start(r.Context())
	}
	if err != nil {
		h.fail(w, r, err)
		return
	}
	// The error of the submission that redirected here: the API reports it
	// on the refused submission only, not on a later read of the step. Only
	// a key the API could have sent is shown, never free text off a URL.
	if key := r.URL.Query().Get("error"); key != "" && h.texts.knownErrors(key, fieldNames(res.Step)) {
		res.Step.Error = api.NewOptNilString(key)
	}
	h.finish(w, r, flow, res, false)
}

// post submits the form's action with its other values and, after a passkey
// ceremony, the proof passkey-form.js put in challenge_response, or starts
// the sign-in with the chosen provider, and sends the browser back to get.
func (h *handler) post(w http.ResponseWriter, r *http.Request) {
	flow := h.request(r)
	id := r.URL.Query().Get("flow")
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := r.ParseForm(); err != nil || id == "" || flow.Cookie == "" {
		h.restart(w, r)
		return
	}
	var res *api.FlowResponse
	var err error
	if r.PostForm.Get("action") == "sso" {
		res, err = flow.SubmitSSO(r.Context(), id, r.PostForm.Get("sso_provider_id"), h.cfg.PublicOrigin+h.path+"?flow="+url.QueryEscape(id))
	} else {
		var challenge *api.FlowSubmitRequestChallengeResponse
		if raw := r.PostForm.Get("challenge_response"); raw != "" {
			challenge = new(api.FlowSubmitRequestChallengeResponse)
			if err := challenge.UnmarshalJSON([]byte(raw)); err != nil {
				http.Error(w, "challenge_response is not the atom's result", http.StatusBadRequest)
				return
			}
		}
		fields := make(map[string]string, len(r.PostForm))
		for name := range r.PostForm {
			if name != "action" && name != "challenge_response" {
				fields[name] = r.PostForm.Get(name)
			}
		}
		res, err = flow.Submit(r.Context(), id, r.PostForm.Get("action"), fields, challenge)
	}
	if err != nil {
		h.fail(w, r, err)
		return
	}
	h.finish(w, r, flow, res, true)
}

// finish answers with res: a signed-in user gets the session cookie and a
// redirect, an SSO step the provider's URL, a terminal step without a user
// its page, a POST the redirect back to the step, and a GET the page. Every
// other answer hands the rotated flow cookie on.
func (h *handler) finish(w http.ResponseWriter, r *http.Request, flow *Flow, res *api.FlowResponse, posted bool) {
	if res.Step.Complete.IsSet() {
		h.setFlowCookie(w, "", 0)
		token, ok := res.HandoffToken.Get()
		if !ok {
			// A terminal step with nobody to sign in, such as "no account":
			// shown once, since the API answers a later read with 410.
			h.render(w, r, res)
			return
		}
		session, maxAge, err := flow.Exchange(r.Context(), token)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		secure := h.cfg.secure()
		http.SetCookie(w, &http.Cookie{
			Name:     sessionCookieName(h.cfg.ProjectID, secure),
			Value:    session,
			Path:     "/",
			MaxAge:   maxAge,
			HttpOnly: true,
			Secure:   secure,
			SameSite: http.SameSiteLaxMode,
		})
		w.Header().Set("Cache-Control", "private, no-store")
		http.Redirect(w, r, cmp.Or(optURL(res.RedirectURI), optURL(res.Step.RedirectURL), h.cfg.PostSignInURL, "/"), http.StatusSeeOther)
		return
	}
	h.setFlowCookie(w, flow.Cookie, flow.CookieMaxAge)
	if to := optURL(res.Step.RedirectURL); to != "" {
		http.Redirect(w, r, to, http.StatusSeeOther)
		return
	}
	if posted {
		q := url.Values{"flow": {res.ID}}
		if key, ok := res.Step.Error.Get(); ok {
			q.Set("error", key)
		}
		http.Redirect(w, r, "?"+q.Encode(), http.StatusSeeOther)
		return
	}
	h.render(w, r, res)
}

func (h *handler) render(w http.ResponseWriter, r *http.Request, res *api.FlowResponse) {
	title := h.texts.Text(res.Step.Texts.Value.TitleKey.Or("identifier.title"))
	step := view.Step(res.Step, h.texts, "?flow="+url.QueryEscape(res.ID))
	var body bytes.Buffer
	if err := view.Page(cmp.Or(h.cfg.Locale, "en"), title, h.css).Render(templ.WithChildren(r.Context(), step), &body); err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	// A login page in a frame is clickjacking.
	w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
	_, _ = w.Write(body.Bytes())
}

// passkeyJS serves the passkey step's script, which is part of the binary:
// cached by the browser and revalidated against its ETag, so an update
// reaches it with the page.
func (h *handler) passkeyJS(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("ETag", h.jsETag)
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "passkey.js", time.Time{}, strings.NewReader(h.js))
}

// fail answers an error: a flow the API will not continue starts over,
// anything else is logged in full and told to the browser only in general.
func (h *handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	if Restartable(err) {
		h.restart(w, r)
		return
	}
	h.log.ErrorContext(r.Context(), "login: request failed", "err", err, "path", r.URL.Path)
	w.Header().Set("Cache-Control", "no-store")
	http.Error(w, h.texts.Text("error.sign_in_server.title")+" "+h.texts.Text("error.sign_in_server.body"), http.StatusBadGateway)
}

// restart drops the flow the browser holds and sends it to a fresh one.
func (h *handler) restart(w http.ResponseWriter, r *http.Request) {
	h.setFlowCookie(w, "", 0)
	http.Redirect(w, r, h.path, http.StatusSeeOther)
}

// setFlowCookie hands the browser its copy of the flow cookie, expiring
// with the API's; an empty value clears it. Lax, not the API's Strict: a
// provider's callback sends the browser back here cross-site, with it.
func (h *handler) setFlowCookie(w http.ResponseWriter, value string, maxAge int) {
	c := *h.cookie
	c.Value = value
	c.MaxAge = maxAge
	if value == "" {
		c.MaxAge = -1
	}
	http.SetCookie(w, &c)
}

// sessionCookieName is the name the Zitadel SDKs keep a project's session
// under: `__Host-zitadel_session_<project>`, or without the prefix and
// Secure over plain http, where Safari refuses Secure on loopback.
func sessionCookieName(projectID string, secure bool) string {
	if secure {
		return "__Host-zitadel_session_" + projectID
	}
	return "zitadel_session_" + projectID
}

func fieldNames(step api.FlowStep) []string {
	names := make([]string, len(step.Fields))
	for i, f := range step.Fields {
		names[i] = f.Name
	}
	return names
}

func optURL(u api.OptURI) string {
	if !u.Set {
		return ""
	}
	return u.Value.String()
}
