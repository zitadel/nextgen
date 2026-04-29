package api

import (
	"context"
	"fmt"

	api "github.com/zitadel/nextgen/api/generated"
)

type Handler struct {
}

func NewHandler() *Handler {
	return &Handler{}
}

func (h Handler) NewError(ctx context.Context, err error) *api.ErrorDetailsStatusCode {
	return &api.ErrorDetailsStatusCode{
		StatusCode: 401,
		Response: api.ErrorDetails{
			Code:    "auth error",
			Message: err.Error(),
		},
	}
}

func (h Handler) CreateFlow(ctx context.Context, req *api.CreateFlowRequest) (api.CreateFlowRes, error) {
	return nil, fmt.Errorf("not implemented")
}

func (h Handler) GetFlowStep(ctx context.Context, params api.GetFlowStepParams) (api.GetFlowStepRes, error) {
	return nil, fmt.Errorf("not implemented")
}

func (h Handler) SubmitFlowStep(ctx context.Context, req *api.FlowSubmitRequest, params api.SubmitFlowStepParams) (api.SubmitFlowStepRes, error) {
	return nil, fmt.Errorf("not implemented")
}

func (h Handler) SubmitFlowEvent(ctx context.Context, req *api.FlowEventRequest, params api.SubmitFlowEventParams) error {
	return fmt.Errorf("not implemented")
}

var _ api.Handler = (*Handler)(nil)
