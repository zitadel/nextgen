package service

import (
	"context"
	"errors"
	"log/slog"
	mrand "math/rand/v2"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	// One request in this many sweeps the project's expired requests, so
	// concurrent requests in one project rarely run the same delete.
	authRequestSweepOneIn = 16
	// A sweep deletes at most this many rows, so a backlog drains over later
	// sweeps instead of failing one oversized delete.
	authRequestSweepLimit = 1000
)

// AuthRequestService stores the authorization requests the OAuth endpoint
// hands to the login (ADR 081 §8).
type AuthRequestService interface {
	// Create stores request with a new binding and an expiry, and returns the
	// nonce the browser's binding cookie holds.
	Create(ctx context.Context, request *domain.AuthRequest) (bindingNonce string, err error)
}

type authRequestService struct {
	db    StatementPool
	sweep func() bool
}

func NewAuthRequestService(db StatementPool) AuthRequestService {
	return &authRequestService{db: db, sweep: func() bool { return mrand.IntN(authRequestSweepOneIn) == 0 }}
}

// Create implements [AuthRequestService].
func (s *authRequestService) Create(ctx context.Context, request *domain.AuthRequest) (_ string, err error) {
	ctx, end := startSpan(ctx, "AuthRequestService.Create")
	defer end(&err)

	nonce, hash, err := domain.NewAuthRequestBinding()
	if err != nil {
		return "", err
	}
	now := time.Now()
	request.BindingHash = hash
	request.ExpiresAt = now.Add(domain.AuthRequestTTL)
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
	// A failed sweep leaves expired rows for a later one.
	if s.sweep() {
		if err := s.db.Statements().DeleteExpiredAuthRequests(ctx, request.ProjectID, now, authRequestSweepLimit); err != nil {
			getLoggingContext(ctx, "auth_request").WarnContext(ctx, "sweeping expired authorization requests failed",
				slog.String("project_id", request.ProjectID),
				slog.Any("error", err),
			)
		}
	}
	return nonce, nil
}
