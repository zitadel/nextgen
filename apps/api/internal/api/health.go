package api

import (
	"context"
	"strings"

	api "github.com/zitadel/nextgen/api/generated"
)

func (h *Handler) GetHealth(ctx context.Context) (api.GetHealthRes, error) {
	return &api.GetHealthOK{Data: strings.NewReader("ok")}, nil
}

func (h *Handler) GetLive(ctx context.Context) (api.GetLiveRes, error) {
	return &api.GetLiveOK{Data: strings.NewReader("ok")}, nil
}

func (h *Handler) GetReady(ctx context.Context) (api.GetReadyRes, error) {
	return &api.GetReadyOK{Data: strings.NewReader("ok")}, nil
}
