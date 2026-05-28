package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) GetMyUser(ctx context.Context, params api.GetMyUserParams) (api.GetMyUserRes, error) {
	input := service.GetMyUserInput{
		SessionToken: params.NextgenSession,
	}

	userbs, err := h.userService.GetMyUser(ctx, input)
	if err != nil {
		return nil, err
	}

	user := &api.GetMyUserOK{}
	err = user.UnmarshalJSON(userbs)
	if err != nil {
		return nil, err
	}
	return user, nil
}

// ------------------ Errors ---------------

func userErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrUserNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	default:
		return internalErrorResponse(err)
	}
}
