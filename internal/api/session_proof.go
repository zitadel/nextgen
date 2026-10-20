package api

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
)

// errSessionNotProven is the one answer to a session a request names but does
// not prove it holds. Each caller maps it to its own invalid-request error.
var errSessionNotProven = errors.New("session not proven")

// sessionProofMessage is the refusal message for errSessionNotProven. It is
// the same for every reason, so a caller cannot tell a missing session from a
// foreign one.
const sessionProofMessage = "session_id requires the session_token of that session."

// provenSessionID resolves the session a sign-in runs against. A session id
// names a session but proves nothing about who holds it, and a step-up attempt
// on it inherits its verified factors, so a request that names one must also
// present that session's token (the session_token POST /sessions and the
// handoff exchange return). The token must be a live session token of
// projectID for the same session. With only a token, the session is the
// token's. With neither, it returns nil: the sign-in gets a new session.
//
// Every refusal is errSessionNotProven, whether the token is missing, invalid,
// expired, revoked, of another project or of another session. A failure to
// decide (the token store is down) is a server fault and is returned as such.
func (h Handler) provenSessionID(ctx context.Context, projectID string, sessionID, sessionToken *string) (*string, error) {
	if sessionToken == nil {
		if sessionID == nil {
			return nil, nil
		}
		return nil, errSessionNotProven
	}
	token, err := h.tokenService.IntrospectToken(ctx, *sessionToken)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidToken()) ||
			errors.Is(err, domain.ErrInvalidTokenIdentifiers()) ||
			errors.Is(err, domain.ErrTokenRevoked()) ||
			errors.Is(err, domain.ErrEncryptionKeyNotFound()) {
			return nil, errSessionNotProven
		}
		if domain.IsServerFault(err) {
			return nil, err
		}
		return nil, domain.ErrInternal(err)
	}
	if domain.ValidateSessionToken(token) != nil || token.ProjectID != projectID {
		return nil, errSessionNotProven
	}
	if sessionID != nil && *sessionID != *token.SessionID {
		return nil, errSessionNotProven
	}
	return token.SessionID, nil
}
