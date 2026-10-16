package domain

import "time"

// Self is the person behind a user-bound session: the subject of a self-access
// operation (the `/me` endpoints). The session alone authorizes it — no grant,
// no resolver check — so it can only ever act on the session's own user in the
// session's own project (system-permission-catalog: self-access).
type Self struct {
	ProjectID string
	UserID    string
}

// SelfFromSession is the one place a self-access operation learns who is
// calling: a present, unexpired session bound to a user. Anything else —
// no session, an expired one, an anonymous flow session — is
// ErrSessionTokenInvalid.
func SelfFromSession(token *Token, now time.Time) (Self, error) {
	if token == nil || token.UserID == "" || (token.ExpiresAt != nil && now.After(*token.ExpiresAt)) {
		return Self{}, ErrSessionTokenInvalid()
	}
	return Self{ProjectID: token.ProjectID, UserID: token.UserID}, nil
}
