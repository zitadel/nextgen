package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/go-faster/jx"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/cookie"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	flowCookieName = "_zflow"
	flowCookiePath = "/flow"
	// TODO: make configurable once the secrets/config story lands.
	flowCookieMaxAge = 10 * time.Minute
)

// errFlowCookieExpired is returned by openFlowCookie when the cookie's
// IssuedAt is older than flowCookieMaxAge. Distinct from cookie.ErrInvalid
// so handlers can surface the right error code.
var errFlowCookieExpired = errors.New("api: flow cookie expired")

func (h Handler) CreateFlow(ctx context.Context, req *api.CreateFlowRequest) (api.CreateFlowRes, error) {
	purpose, err := domain.FlowDefinitionPurposeString(string(req.Purpose))
	if err != nil {
		return &api.ErrorDetailsStatusCode{
			StatusCode: http.StatusBadRequest,
			Response: api.ErrorDetails{
				Code:    "invalid_purpose",
				Message: fmt.Sprintf("unknown purpose %q", req.Purpose),
			},
		}, nil
	}

	hint := buildResolveHint(req.Hint)
	resolveReq := service.ResolveFlowRequest{
		ProjectID: string(req.ProjectID),
		Purpose:   purpose,
		Hint:      hint,
	}
	if name, ok := req.FlowDefinitionName.Get(); ok {
		resolveReq.Name = &name
	}
	if v, ok := req.SchemaVersion.Get(); ok {
		resolveReq.SchemaVersion = &v
	}
	if id, ok := req.AuthRequestID.Get(); ok {
		resolveReq.AuthRequestID = &id
	}

	def, err := h.flowService.Resolve(ctx, resolveReq)
	if err != nil {
		return mapFlowError(err), nil
	}

	startReq := service.StartFlowRequest{
		Definition: def,
		Purpose:    purpose,
		Hint:       hint,
	}
	if u, ok := req.RedirectURI.Get(); ok {
		// TODO: validate redirect URI against RP allowlist once OIDC ships.
		s := u.String()
		startReq.RedirectURI = &s
	}
	// TODO: bind a real auth-request once the OIDC layer lands; the
	// current AuthRequestID on the body is accepted but not threaded.

	result, err := h.flowService.Start(ctx, startReq)
	if err != nil {
		return mapFlowError(err), nil
	}

	cookieValue, err := h.sealFlowCookie(result.State)
	if err != nil {
		return mapFlowError(err), nil
	}

	resp := toFlowResponse(result)
	return &api.FlowResponseHeaders{
		SetCookie: api.NewOptString(buildSetCookie(cookieValue, false)),
		Response:  resp,
	}, nil
}

func (h Handler) SubmitFlowStep(ctx context.Context, req *api.FlowSubmitRequest, params api.SubmitFlowStepParams) (api.SubmitFlowStepRes, error) {
	state, mapped := h.decodeFlowCookie(params.Zflow, params.ID)
	if mapped != nil {
		// Best-effort conversion to the operation-typed wrapper, falling
		// back to ErrorDetailsStatusCode for codes the operation does not
		// declare.
		return mapped, nil
	}

	submitReq := service.SubmitFlowRequest{
		State:  state,
		Action: req.Action,
	}
	if fields, ok := req.Fields.Get(); ok {
		submitReq.Fields = decodeFlowSubmitFields(fields)
	}
	if proofs, ok := req.GateProofs.Get(); ok {
		submitReq.GateProofs = map[string]string(proofs)
	}
	if id, ok := req.SSOProviderID.Get(); ok {
		submitReq.SSOProviderID = &id
	}

	result, err := h.flowService.Submit(ctx, submitReq)
	if err != nil {
		return mapFlowError(err), nil
	}

	hasStepError := result.Step != nil && result.Step.Error != nil
	terminal := result.Step != nil && result.Step.Complete != nil

	setCookie, err := h.buildResponseCookie(result.State, terminal)
	if err != nil {
		return mapFlowError(err), nil
	}

	resp := toFlowResponse(result)
	headers := api.FlowResponseHeaders{
		SetCookie: api.NewOptString(setCookie),
		Response:  resp,
	}
	if hasStepError {
		bad := api.SubmitFlowStepBadRequest(headers)
		return &bad, nil
	}
	ok := api.SubmitFlowStepOK(headers)
	return &ok, nil
}

func (h Handler) GetFlowStep(ctx context.Context, params api.GetFlowStepParams) (api.GetFlowStepRes, error) {
	state, mapped := h.decodeFlowCookie(params.Zflow, params.ID)
	if mapped != nil {
		return mapped, nil
	}

	result, err := h.flowService.GetStep(ctx, service.GetFlowStepRequest{State: state})
	if err != nil {
		return mapFlowError(err), nil
	}

	resp := toFlowResponse(result)
	return &resp, nil
}

func (h Handler) SubmitFlowEvent(ctx context.Context, _ *api.FlowEventRequest, params api.SubmitFlowEventParams) (api.SubmitFlowEventRes, error) {
	_, mapped := h.decodeFlowCookie(params.Zflow, params.ID)
	if mapped != nil {
		return mapped, nil
	}
	// Read-only ack. No state mutation, no Set-Cookie — the cookie TTL
	// must not extend on event submissions so they cannot act as a
	// stealth keep-alive. Concrete event sinks are a follow-up.
	return &api.SubmitFlowEventNoContent{}, nil
}

func buildResolveHint(opt api.OptFlowHint) service.ResolveFlowHint {
	h, ok := opt.Get()
	if !ok {
		return service.ResolveFlowHint{}
	}
	out := service.ResolveFlowHint{}
	if v, ok := h.AppID.Get(); ok {
		out.AppID = &v
	}
	if v, ok := h.TeamID.Get(); ok {
		out.TeamID = &v
	}
	if v, ok := h.UserSchemaID.Get(); ok {
		out.UserSchemaID = &v
	}
	return out
}

// decodeFlowCookie opens the cookie, binds the path id, and returns the
// decoded state. The second return is non-nil when an error response
// should be sent instead of proceeding.
func (h Handler) decodeFlowCookie(value, pathID string) (*domain.FlowState, *api.ErrorDetailsStatusCode) {
	state, err := h.openFlowCookie(value)
	if err != nil {
		return nil, cookieErrorResponse(err)
	}
	if state.ID != pathID {
		return nil, &api.ErrorDetailsStatusCode{
			StatusCode: http.StatusNotFound,
			Response: api.ErrorDetails{
				Code:    "flow.not_found",
				Message: "flow id does not match the cookie",
			},
		}
	}
	return state, nil
}

// openFlowCookie unseals the cookie value, decodes the payload, and
// enforces freshness. Returns cookie.ErrInvalid for malformed values and
// errFlowCookieExpired for stale ones.
func (h Handler) openFlowCookie(value string) (*domain.FlowState, error) {
	if value == "" {
		return nil, cookie.ErrInvalid
	}
	plain, err := h.sealer.Open(value)
	if err != nil {
		return nil, err
	}
	var state domain.FlowState
	if err := json.Unmarshal(plain, &state); err != nil {
		return nil, cookie.ErrInvalid
	}
	if h.now().Sub(state.IssuedAt) > flowCookieMaxAge {
		return nil, errFlowCookieExpired
	}
	return &state, nil
}

// sealFlowCookie JSON-encodes state and seals it. The state machine
// stamps IssuedAt; this helper does not.
func (h Handler) sealFlowCookie(state *domain.FlowState) (string, error) {
	payload, err := json.Marshal(state)
	if err != nil {
		return "", fmt.Errorf("api: marshal flow state: %w", err)
	}
	return h.sealer.Seal(payload)
}

// buildResponseCookie produces the Set-Cookie value for a step response.
// Terminal steps emit a cleared cookie; non-terminal steps emit a fresh
// sealed state.
func (h Handler) buildResponseCookie(state *domain.FlowState, terminal bool) (string, error) {
	if terminal {
		return buildSetCookie("", true), nil
	}
	sealed, err := h.sealFlowCookie(state)
	if err != nil {
		return "", err
	}
	return buildSetCookie(sealed, false), nil
}

func buildSetCookie(value string, clear bool) string {
	c := &http.Cookie{
		Name:     flowCookieName,
		Value:    value,
		Path:     flowCookiePath,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	}
	if clear {
		c.MaxAge = -1
	} else {
		c.MaxAge = int(flowCookieMaxAge.Seconds())
	}
	return c.String()
}

func cookieErrorResponse(err error) *api.ErrorDetailsStatusCode {
	if errors.Is(err, errFlowCookieExpired) {
		return &api.ErrorDetailsStatusCode{
			StatusCode: http.StatusUnauthorized,
			Response: api.ErrorDetails{
				Code:    "flow.cookie_expired",
				Message: "flow cookie expired",
			},
		}
	}
	return &api.ErrorDetailsStatusCode{
		StatusCode: http.StatusUnauthorized,
		Response: api.ErrorDetails{
			Code:    "flow.cookie_invalid",
			Message: "flow cookie invalid or missing",
		},
	}
}

// mapFlowError converts service / state-machine errors into the wire
// response. Domain errors propagate via their existing code; state
// machine sentinels map to operation-level codes.
func mapFlowError(err error) *api.ErrorDetailsStatusCode {
	var dErr domain.Error
	if errors.As(err, &dErr) {
		switch dErr.Code {
		case domain.ErrFlowDefinitionNotFound().Code:
			return &api.ErrorDetailsStatusCode{
				StatusCode: http.StatusNotFound,
				Response: api.ErrorDetails{
					Code:    "flow.not_found",
					Message: dErr.Message,
				},
			}
		case domain.ErrFlowDefinitionPurposeMismatch().Code:
			return &api.ErrorDetailsStatusCode{
				StatusCode: http.StatusBadRequest,
				Response: api.ErrorDetails{
					Code:    "flow.purpose_mismatch",
					Message: dErr.Message,
				},
			}
		}
	}
	switch {
	case errors.Is(err, domain.ErrInvalidAction):
		return &api.ErrorDetailsStatusCode{
			StatusCode: http.StatusBadRequest,
			Response: api.ErrorDetails{
				Code:    "flow.invalid_action",
				Message: err.Error(),
			},
		}
	case errors.Is(err, domain.ErrUnsupported):
		return &api.ErrorDetailsStatusCode{
			StatusCode: http.StatusBadRequest,
			Response: api.ErrorDetails{
				Code:    "flow.unsupported",
				Message: err.Error(),
			},
		}
	case errors.Is(err, domain.ErrSessionConflict):
		return &api.ErrorDetailsStatusCode{
			StatusCode: http.StatusConflict,
			Response: api.ErrorDetails{
				Code:    "flow.session_conflict",
				Message: err.Error(),
			},
		}
	}
	return internalErrorResponse(err)
}

// toFlowResponse maps a service result into the wire payload. Cookie
// emission is the caller's responsibility.
func toFlowResponse(result domain.FlowStepResult) api.FlowResponse {
	resp := api.FlowResponse{
		ID:        result.State.ID,
		SessionID: result.State.SessionID,
		Step:      toFlowStep(result.Step),
	}
	if result.Step != nil && result.Step.Complete != nil && *result.Step.Complete == domain.FlowStepCompleteRedirect && result.Step.RedirectURL != nil {
		if u, err := url.Parse(*result.Step.RedirectURL); err == nil {
			resp.RedirectURI = api.NewOptURI(*u)
		}
	}
	return resp
}

func toFlowStep(step *domain.FlowStep) api.FlowStep {
	if step == nil {
		return api.FlowStep{}
	}
	out := api.FlowStep{
		Name:    step.Name,
		Fields:  toAPIFields(step.Fields),
		Actions: toAPIActions(step.Actions),
	}
	if step.Error != nil {
		out.Error = api.NewOptNilString(*step.Error)
	}
	if step.Complete != nil {
		out.Complete = api.NewOptFlowStepComplete(api.FlowStepComplete(*step.Complete))
	}
	if step.RedirectURL != nil {
		if u, err := url.Parse(*step.RedirectURL); err == nil {
			out.RedirectURL = api.NewOptURI(*u)
		}
	}
	return out
}

func toAPIFields(in map[string]domain.FlowField) api.FlowStepFields {
	if len(in) == 0 {
		return nil
	}
	out := make(api.FlowStepFields, len(in))
	for name, f := range in {
		out[name] = toAPIField(f)
	}
	return out
}

func toAPIField(f domain.FlowField) api.Field {
	field := api.Field{
		Type:     api.FieldType(f.Type),
		TextKey:  f.TextKey,
		Required: api.NewOptBool(f.Required),
	}
	if f.Value != nil {
		// Pre-fill is always a string today; encode as a JSON string.
		raw, err := json.Marshal(*f.Value)
		if err == nil {
			field.Value = jx.Raw(raw)
		}
	}
	if f.Validation != nil {
		v := api.FieldValidation{}
		if f.Validation.Format != "" {
			v.Format = api.NewOptString(f.Validation.Format)
		}
		if f.Validation.MinLength > 0 {
			v.MinLength = api.NewOptInt(f.Validation.MinLength)
		}
		if f.Validation.MaxLength > 0 {
			v.MaxLength = api.NewOptInt(f.Validation.MaxLength)
		}
		field.Validation = api.NewOptFieldValidation(v)
	}
	return field
}

func toAPIActions(in map[string]domain.FlowAction) api.FlowStepActions {
	if len(in) == 0 {
		return nil
	}
	out := make(api.FlowStepActions, len(in))
	for name, a := range in {
		out[name] = api.StepAction{
			TextKey: a.TextKey,
			Primary: api.NewOptBool(a.Primary),
		}
	}
	return out
}

// decodeFlowSubmitFields converts the wire form (jx.Raw per field) into
// the loosely-typed map the state machine validates. JSON numbers come
// back as float64, matching encoding/json's default.
func decodeFlowSubmitFields(in api.FlowSubmitRequestFields) map[string]any {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]any, len(in))
	for name, raw := range in {
		var v any
		if err := json.Unmarshal(raw, &v); err != nil {
			// Skip values we can't decode; the state machine validator
			// will surface a missing-field error per schema rules.
			continue
		}
		out[name] = v
	}
	return out
}

