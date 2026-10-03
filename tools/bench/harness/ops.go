package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-faster/jx"
	api "github.com/zitadel/nextgen/api/generated"
)

// Operation ids. They are the `op` tag on every sample and the only
// per-operation value that ever reaches a tag: paths carrying resource ids
// never do, so the vocabulary — and the number of time series — is bounded
// by this list, not by the dataset.
const (
	OpCreateFlow     = "create_flow"
	OpSubmitIdent    = "submit_identifier"
	OpSubmitPassword = "submit_password"
	OpGetUser        = "get_user"
)

// opKey carries the operation id from a typed call into the client's Do,
// which only sees the *http.Request. The generated client propagates the
// context it was called with.
type opKey struct{}

// WithOp tags the context with the operation id of the call about to be made.
func WithOp(ctx context.Context, op string) context.Context {
	return context.WithValue(ctx, opKey{}, op)
}

// OpFromRequest returns the operation id a typed call attached, or "unknown".
func OpFromRequest(r *http.Request) string {
	if op, ok := r.Context().Value(opKey{}).(string); ok {
		return op
	}
	return "unknown"
}

// LoginResult is what a completed login journey hands back.
type LoginResult struct {
	HandoffToken string `json:"handoff_token"`
	SessionID    string `json:"session_id"`
}

// Login drives POST /flow → submit identifier → submit password through the
// typed client and returns the handoff token. The sealed `_zflow` cookie is
// an explicit parameter of the generated client, so the journey carries it
// from one response's Set-Cookie into the next request itself.
func Login(ctx context.Context, c *api.Client, t Target) (LoginResult, error) {
	created, err := c.CreateFlow(WithOp(ctx, OpCreateFlow), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(t.ProjectID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	})
	if err != nil {
		return LoginResult{}, fmt.Errorf("%s: %w", OpCreateFlow, err)
	}
	flow, ok := created.(*api.FlowResponseHeaders)
	if !ok {
		return LoginResult{}, fmt.Errorf("%s: unexpected response %T", OpCreateFlow, created)
	}
	zflow, err := cookieValue(flow.SetCookie, "_zflow")
	if err != nil {
		return LoginResult{}, fmt.Errorf("%s: %w", OpCreateFlow, err)
	}

	step, err := submit(ctx, c, OpSubmitIdent, flow.Response.ID, zflow, map[string]string{"email": t.Email})
	if err != nil {
		return LoginResult{}, err
	}
	zflow, err = cookieValue(step.SetCookie, "_zflow")
	if err != nil {
		return LoginResult{}, fmt.Errorf("%s: %w", OpSubmitIdent, err)
	}

	step, err = submit(ctx, c, OpSubmitPassword, step.Response.ID, zflow, map[string]string{"x-auth-methods#password": t.Password})
	if err != nil {
		return LoginResult{}, err
	}
	handoff, ok := step.Response.HandoffToken.Get()
	if !ok {
		return LoginResult{}, fmt.Errorf("%s: no handoff token; step %q", OpSubmitPassword, step.Response.Step.Name)
	}
	return LoginResult{HandoffToken: handoff, SessionID: step.Response.SessionID}, nil
}

func submit(ctx context.Context, c *api.Client, op, id, zflow string, fields map[string]string) (*api.SubmitFlowStepOK, error) {
	raw := make(api.FlowSubmitRequestFields, len(fields))
	for k, v := range fields {
		b, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		raw[k] = jx.Raw(b)
	}
	req := &api.FlowSubmitRequest{Action: "submit", Fields: api.NewOptFlowSubmitRequestFields(raw)}
	res, err := c.SubmitFlowStep(WithOp(ctx, op), req, api.SubmitFlowStepParams{ID: id, Zflow: zflow})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	switch r := res.(type) {
	case *api.SubmitFlowStepOK:
		// A rejected input is a 200 with the same step and an error key, not
		// a 4xx, so it has to be checked here or it counts as a success.
		if e, ok := r.Response.Step.Error.Get(); ok {
			return nil, fmt.Errorf("%s: step %q answered error %q", op, r.Response.Step.Name, e)
		}
		return r, nil
	case *api.SubmitFlowStepBadRequest:
		return nil, fmt.Errorf("%s: 400 step %q error %q", op, r.Response.Step.Name, r.Response.Step.Error.Or(""))
	case *api.ErrorDetails:
		return nil, fmt.Errorf("%s: %s: %s", op, r.Code, r.Message)
	default:
		return nil, fmt.Errorf("%s: unexpected response %T", op, res)
	}
}

// GetUser performs GET /users/{id} with the operator bearer.
func GetUser(ctx context.Context, c *api.Client, t Target) (*api.User, error) {
	res, err := c.GetUserByID(WithOp(ctx, OpGetUser), api.GetUserByIDParams{UserID: api.UserID(t.UserID)})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", OpGetUser, err)
	}
	switch r := res.(type) {
	case *api.User:
		return r, nil
	case *api.GetUserByIDUnauthorized:
		return nil, fmt.Errorf("%s: 401 %s", OpGetUser, r.Message)
	case *api.GetUserByIDNotFound:
		return nil, fmt.Errorf("%s: 404 %s", OpGetUser, r.Message)
	default:
		return nil, fmt.Errorf("%s: unexpected response %T", OpGetUser, res)
	}
}

// cookieValue finds one cookie among the Set-Cookie headers the typed
// response carries as plain strings.
func cookieValue(setCookie []string, name string) (string, error) {
	for _, raw := range setCookie {
		c, err := http.ParseSetCookie(raw)
		if err != nil {
			return "", err
		}
		if c.Name == name {
			return c.Value, nil
		}
	}
	return "", fmt.Errorf("response carried no %s cookie in %d Set-Cookie header(s)", name, len(setCookie))
}
