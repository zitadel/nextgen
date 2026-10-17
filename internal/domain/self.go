package domain

import "time"

// Self is the person behind a user-bound session: the subject of a self-access
// (`/me`) operation, which acts on that user in that project only.
type Self struct {
	ProjectID string
	UserID    string
}

// SelfFromSession is the one place a self-access operation learns who is
// calling: a present, unexpired session bound to a user. Anything else is
// ErrSessionTokenInvalid. The session is the authorization, so no grant is
// checked (system-permission-catalog: self-access).
func SelfFromSession(token *Token, now time.Time) (Self, error) {
	if token == nil || token.UserID == "" || (token.ExpiresAt != nil && now.After(*token.ExpiresAt)) {
		return Self{}, ErrSessionTokenInvalid()
	}
	return Self{ProjectID: token.ProjectID, UserID: token.UserID}, nil
}
