package api

import (
	"context"
	"errors"
	"time"

	"github.com/muhlemmer/gu"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// verifyClaimSession authenticates the human behind claim/complete (ADR 046 §2,
// Claim C2). It returns the session's user id. Every rejection is pre-wrapped
// as the public 401 verdict (auth.unauthorized) with the distinct sentinel kept
// in the parent chain for logs and tests. Production caller: CompleteClaim
// (Claim E1, #611).
func (h Handler) verifyClaimSession(ctx context.Context) (string, error) {
	sessionToken, ok := sessionTokenFromContext(ctx)
	if !ok {
		return "", invalidSessionCredential(domain.ErrSessionTokenInvalid())
	}

	// Load by the token's own project so a foreign-project session surfaces as
	// the distinct wrong-project verdict below, not as a lookup miss.
	session, err := h.sessionService.Get(ctx, service.GetSessionInput{
		ProjectID: sessionToken.ProjectID,
		SessionID: gu.Value(sessionToken.SessionID),
	})
	if err != nil {
		if errors.Is(err, domain.ErrSessionNotFound()) {
			return "", invalidSessionCredential(err)
		}
		return "", err
	}

	if session.TokenID != sessionToken.TokenID {
		return "", invalidSessionCredential(domain.ErrSessionTokenInvalid())
	}
	// Checked before the lifecycle so a foreign caller learns nothing about the
	// platform session's state.
	if h.platformProjectID == "" || session.ProjectID != h.platformProjectID {
		return "", invalidSessionCredential(domain.ErrClaimSessionWrongProject())
	}
	// Explicit expiry check before State(), which reports a factor-less expired
	// session as Building.
	if time.Now().After(session.ExpiresAt) {
		return "", invalidSessionCredential(domain.ErrClaimSessionExpired())
	}
	if session.State() != domain.SessionStateActive {
		return "", invalidSessionCredential(domain.ErrClaimSessionNotActive())
	}
	if session.UserID == nil || *session.UserID == "" {
		return "", invalidSessionCredential(domain.ErrClaimSessionNotActive())
	}
	return *session.UserID, nil
}
