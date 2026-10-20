package domain

import "time"

// Self is the person behind a user-bound session: the subject of a self-access
// (`/me`) operation, which acts on that user in that project only. Its fields
// are unexported so SelfFromSession is the only way to get one: holding a Self
// means a verified session produced it.
type Self struct {
	projectID string
	userID    string
}

// ProjectID is the session's project, the one the user lives in.
func (s Self) ProjectID() string { return s.projectID }

// UserID is the session's user.
func (s Self) UserID() string { return s.userID }

// SelfFromSession is the one place a self-access operation learns who is
// calling: a present, unexpired session bound to a user. Anything else is
// ErrSessionTokenInvalid. The session is the authorization, so no grant is
// checked (system-permission-catalog: self-access).
func SelfFromSession(token *Token, now time.Time) (Self, error) {
	if token == nil || token.UserID == "" || (token.ExpiresAt != nil && now.After(*token.ExpiresAt)) {
		return Self{}, ErrSessionTokenInvalid()
	}
	return Self{projectID: token.ProjectID, userID: token.UserID}, nil
}
