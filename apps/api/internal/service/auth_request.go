package service

import (
	"context"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// AuthRequestService stores the authorization requests the OAuth endpoint
// hands to the login (ADR 081 §8).
type AuthRequestService interface {
	// Create stores request with a new binding and an expiry, and returns the
	// nonce the browser's binding cookie holds.
	Create(ctx context.Context, request *domain.AuthRequest) (bindingNonce string, err error)
}

type authRequestService struct {
	db StatementPool
}

func NewAuthRequestService(db StatementPool) AuthRequestService {
	return &authRequestService{db: db}
}

// Create implements [AuthRequestService].
func (s *authRequestService) Create(ctx context.Context, request *domain.AuthRequest) (_ string, err error) {
	ctx, end := startSpan(ctx, "AuthRequestService.Create")
	defer end(&err)

	nonce, hash, err := domain.NewAuthRequestBinding()
	if err != nil {
		return "", err
	}
	request.BindingHash = hash
	request.ExpiresAt = time.Now().Add(domain.AuthRequestTTL)
	if err := s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateAuthRequest(ctx, request); err != nil {
			return err
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeAuthRequestCreated,
			Category:   domain.EventCategoryAuth,
			ProjectID:  request.ProjectID,
			EntityType: "auth_request",
			EntityID:   request.ID,
			Payload:    domain.AuthRequestCreatedPayload{ClientID: request.ClientID},
		})
	}); err != nil {
		if _, ok := errors.AsType[*database.UnavailableError](err); ok {
			return "", domain.ErrUnavailable().WithParent(err)
		}
		return "", domain.ErrInternal(err).WithMessage("failed to store the authorization request")
	}
	return nonce, nil
}
