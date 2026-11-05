package api

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// sessionProofMessage is the refusal message of provenSessionID. It is the same
// for every reason, so a caller cannot tell a missing session from a foreign
// one.
const sessionProofMessage = "session_id requires the session_token of that session."

// provenSessionID resolves the session a sign-in runs against. A session id
// names a session but proves nothing about who holds it, and a step-up attempt
// on it inherits its verified factors, so a request that names one must also
// present that session's token (the session_token POST /sessions and the
// handoff exchange return). The token must be a live session token of
// projectID for the same session. With only a token, the session is the
// token's. With neither, it returns nil: the sign-in gets a new session. An
// empty string is a field the request did not send.
//
// Every refusal is the caller's invalid-request error, refuse, whether the
// token is missing, rejected by introspection, of another project or of
// another session. A failure to decide (the token store is down) is a server
// fault and is returned as such.
func (h Handler) provenSessionID(ctx context.Context, projectID, sessionID, sessionToken string, refuse func() domain.Error) (*string, error) {
	notProven := refuse().WithMessage(sessionProofMessage)
	if sessionToken == "" {
		if sessionID == "" {
			return nil, nil
		}
		return nil, notProven
	}
	token, err := h.tokenService.IntrospectToken(ctx, sessionToken)
	if err != nil {
		if isRejectedToken(err) {
			return nil, notProven
		}
		if domain.IsServerFault(err) {
			return nil, err
		}
		return nil, domain.ErrInternal(err)
	}
	if domain.ValidateSessionToken(token) != nil || token.ProjectID != projectID {
		return nil, notProven
	}
	if sessionID != "" && sessionID != *token.SessionID {
		return nil, notProven
	}
	return token.SessionID, nil
}
