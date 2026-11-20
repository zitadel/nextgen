package login

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"time"

	"github.com/go-faster/jx"
	"github.com/ogen-go/ogen/ogenerrors"

	"go.zitadel.com/zitadel/v5/api"
)

// FlowCookie is the API's flow-state cookie: HttpOnly, sealed, and rotated on
// every response. It is the whole state of a flow; the flow ID is only a key
// into it.
const FlowCookie = "_zflow"

// projectSecret authenticates every request with a project secret, the
// bearer token the API's OAuth2 scheme takes. The session cookie scheme is
// skipped: it is for a browser signed in through the login.
type projectSecret string

func (s projectSecret) OAuth2(context.Context, api.OperationName) (api.OAuth2, error) {
	return api.OAuth2{Token: string(s)}, nil
}

func (projectSecret) SessionCookie(context.Context, api.OperationName) (api.SessionCookie, error) {
	return api.SessionCookie{}, ogenerrors.ErrSkipClientSecurity
}

// Flow drives one login flow through the API on a browser's behalf: the
// conversation CreateFlow → SubmitFlowStep, once per step → ExchangeHandoff.
// It renders nothing and serves no HTTP; Mount does both on top of it.
type Flow struct {
	client    *api.Client
	projectID api.ProjectID
	// Origin is cfg.PublicOrigin, sent as the Origin header a browser would
	// send: it selects the deployment, and an SSO return target must be on it.
	Origin string
	// Cookie is the FlowCookie value of the API's last response. The host
	// hands it to the browser after every step and seeds the next Flow from
	// the browser's copy; the API refuses a stale one.
	Cookie string
	// CookieMaxAge is the seconds the API gave Cookie, for the browser's copy
	// to expire with it; 0 when the API set none.
	CookieMaxAge int
}

// NewFlow is a flow driver for cfg's project. One per browser request: copy
// a shared one, so the client is built once.
func NewFlow(cfg Config) (*Flow, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	client, err := api.New(cfg.ServerURL, projectSecret(cfg.ProjectSecret))
	if err != nil {
		return nil, fmt.Errorf("login: %w", err)
	}
	return &Flow{client: client, projectID: api.ProjectID(cfg.ProjectID), Origin: cfg.PublicOrigin}, nil
}

// Start creates a login flow and returns its first step.
func (f *Flow) Start(ctx context.Context) (*api.FlowResponse, error) {
	res, err := f.client.CreateFlow(ctx, &api.CreateFlowRequest{
		ProjectID: f.projectID,
		Purpose:   api.CreateFlowRequestPurposeLogin,
	}, api.CreateFlowParams{Origin: f.origin()})
	if err != nil {
		return nil, fmt.Errorf("login: create flow: %w", err)
	}
	return f.response("create flow", res)
}

// Step re-reads the current step of flowID, after a reload or an SSO return.
func (f *Flow) Step(ctx context.Context, flowID string) (*api.FlowResponse, error) {
	res, err := f.client.GetFlowStep(ctx, api.GetFlowStepParams{FlowID: flowID, Zflow: f.Cookie})
	if err != nil {
		return nil, fmt.Errorf("login: get step: %w", err)
	}
	return f.response("get step", res)
}

// Submit submits action with the form's fields and returns the next step. A
// submission the API refuses for its values comes back as the same step with
// its Error set, not as a Go error, so the host renders it again.
func (f *Flow) Submit(ctx context.Context, flowID, action string, fields map[string]string) (*api.FlowResponse, error) {
	// shortcut: every value goes as a JSON string, so a checkbox (a boolean
	// property) would be refused; the built-in login collects none. Upgrade
	// by reading the step's field types before submitting.
	values := make(api.FlowSubmitRequestFields, len(fields))
	for name, value := range fields {
		raw, _ := json.Marshal(value)
		values[name] = jx.Raw(raw)
	}
	return f.submit(ctx, flowID, &api.FlowSubmitRequest{
		Action: action,
		Fields: api.NewOptFlowSubmitRequestFields(values),
	})
}

// SubmitSSO starts a sign-in with providerID; the returned step's RedirectURL
// is where the browser goes. returnTarget is the absolute URL the provider's
// callback sends the browser back to, on Origin, where the host reads the
// next step with Step.
func (f *Flow) SubmitSSO(ctx context.Context, flowID, providerID, returnTarget string) (*api.FlowResponse, error) {
	return f.submit(ctx, flowID, &api.FlowSubmitRequest{
		Action:        "sso",
		SSOProviderID: api.NewOptString(providerID),
		ReturnTarget:  api.NewOptString(returnTarget),
	})
}

func (f *Flow) submit(ctx context.Context, flowID string, req *api.FlowSubmitRequest) (*api.FlowResponse, error) {
	res, err := f.client.SubmitFlowStep(ctx, req, api.SubmitFlowStepParams{
		FlowID: flowID,
		Zflow:  f.Cookie,
		Origin: f.origin(),
	})
	if err != nil {
		return nil, fmt.Errorf("login: submit: %w", err)
	}
	return f.response("submit", res)
}

// Exchange turns a completed flow's handoff token into the session token the
// host keeps in its session cookie, and the seconds the API gave that
// cookie (0 when it set none), so the host's copy expires with the API's.
func (f *Flow) Exchange(ctx context.Context, handoffToken string) (token string, maxAge int, err error) {
	res, err := f.client.ExchangeHandoff(ctx, &api.ExchangeRequest{HandoffToken: handoffToken},
		api.ExchangeHandoffParams{ProjectID: f.projectID})
	if err != nil {
		return "", 0, fmt.Errorf("login: exchange: %w", err)
	}
	session, ok := res.(*api.SessionWithTokenResponseHeaders)
	if !ok {
		return "", 0, apiError("exchange", res)
	}
	return session.Response.SessionToken, cookieMaxAge(session.SetCookie), nil
}

func (f *Flow) origin() api.OptURI {
	u, err := url.Parse(f.Origin)
	if f.Origin == "" || err != nil {
		return api.OptURI{}
	}
	return api.NewOptURI(*u)
}

// response is the flow in res, or the API's error. Every flow operation
// answers the same success type, and a refused submission answers the step
// with its error under 400, which is a step to render like any other.
func (f *Flow) response(op string, res any) (*api.FlowResponse, error) {
	switch r := res.(type) {
	case *api.FlowResponseHeaders:
		f.rotate(r.SetCookie)
		return &r.Response, nil
	case *api.SubmitFlowStepBadRequestHeaders:
		if r.Response.Type == api.FlowResponseSubmitFlowStepBadRequest {
			f.rotate(r.SetCookie)
			return &r.Response.FlowResponse, nil
		}
		return nil, apiError(op, &r.Response.ErrorDetails)
	}
	return nil, apiError(op, res)
}

// rotate takes the new FlowCookie out of a response's Set-Cookie lines.
func (f *Flow) rotate(setCookie []string) {
	for _, line := range setCookie {
		if c, err := http.ParseSetCookie(line); err == nil && c.Name == FlowCookie {
			f.Cookie = c.Value
			f.CookieMaxAge = cookieMaxAge(line)
		}
	}
}

// cookieMaxAge is the seconds a Set-Cookie line gives its cookie: Max-Age,
// else what Expires amounts to, else 0, as a browser reads it.
func cookieMaxAge(setCookie string) int {
	c, err := http.ParseSetCookie(setCookie)
	if err != nil {
		return 0
	}
	if c.MaxAge == 0 && !c.Expires.IsZero() {
		return max(0, int(time.Until(c.Expires).Seconds()))
	}
	return max(0, c.MaxAge)
}

// APIError is an error response the API documents: the code a host can act
// on, and the message, for its logs.
type APIError struct {
	Op      string
	Code    api.ErrorCode
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("login: %s: %s (%s)", e.Op, e.Message, e.Code)
}

// restartable are the codes after which the flow is gone for good, so the
// only way on is a fresh one: the state the browser holds is unknown,
// expired, invalid, or already spent.
var restartable = []api.ErrorCode{
	"flow.not_found", "flow.completed", "flow.cookie_invalid", "flow.cookie_expired",
	// The auth attempt behind the flow expired or was already handed off; the
	// widget restarts on it too (zitadel-login.ts).
	"flow.restart_required",
}

// Restartable reports whether err says the flow err came from cannot go on
// and a new one should start.
func Restartable(err error) bool {
	e, ok := errors.AsType[*APIError](err)
	return ok && slices.Contains(restartable, e.Code)
}

// apiError is a documented error response as a Go error. The generated
// client has one Go type per operation and status, so rather than a case
// per type, the response is read back as JSON for the code and message
// every error carries, unwrapping the {StatusCode, Response} envelope.
func apiError(op string, res any) error {
	body, err := json.Marshal(res)
	if err != nil {
		return fmt.Errorf("login: %s: unexpected response %T", op, res)
	}
	var envelope struct{ Response json.RawMessage }
	if json.Unmarshal(body, &envelope) == nil && len(envelope.Response) > 0 {
		body = envelope.Response
	}
	var details api.ErrorDetails
	if json.Unmarshal(body, &details) == nil && details.Code != "" {
		return &APIError{Op: op, Code: details.Code, Message: details.Message}
	}
	return fmt.Errorf("login: %s: unexpected response %T", op, res)
}
