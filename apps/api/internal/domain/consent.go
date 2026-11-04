package domain

import (
	"slices"
	"time"
)

// PrefixConsent names a user's consent to an OAuth client for one API.
const PrefixConsent ResourcePrefix = "consent"

func ErrConsentNotFound() Error {
	return newError(PrefixConsent.ErrorCodePrefix("not_found"), "The consent was not found", nil, nil)
}

// Consent records that a user let an OAuth client use some of an API's
// scopes (ADR 082 §8). It is kept per user, client and API, since a token is
// for one API, and stored like a session: transient, with a deadline that
// each use moves, never past an absolute lifetime (ADR 072). The codes and
// refresh tokens issued under it name it as their oidc_session_id, so
// revoking it revokes them.
type Consent struct {
	// ProjectID links to [Project]: the user's project.
	ProjectID string
	// ID is the unique identifier of the consent within the project, minted
	// by the storage.
	ID string
	// UserID is the user who consented.
	UserID string
	// ClientID is the client's id: an app client's, a registration's, or the
	// URL of a client ID metadata document.
	ClientID string
	// ClientName is the name the client went by when the user consented, for
	// the user to recognise it; a registered client's name is its own claim.
	ClientName string
	// Resource is the API's identifier, the aud of the tokens issued under it.
	Resource string
	// Scope is what the user agreed to.
	Scope []string
	// CreatedAt is when the user consented, set by the storage and read only.
	// The absolute lifetime runs from it.
	CreatedAt time.Time
	// UpdatedAt is the time of the last write, set by the storage and read
	// only.
	UpdatedAt time.Time
	// ExpiresAt is the idle deadline: each use moves it, never past the end of
	// the absolute lifetime. A consent past it is gone, whether or not its row
	// still is.
	ExpiresAt time.Time
}

// Covers reports whether the user consented to every scope in requested.
func (c *Consent) Covers(requested []string) bool {
	for _, scope := range requested {
		if !slices.Contains(c.Scope, scope) {
			return false
		}
	}
	return true
}

// Live reports whether the consent is still in force at now.
func (c *Consent) Live(now time.Time) bool { return now.Before(c.ExpiresAt) }

// ConsentUpdate is what a later consent, or a use, writes to a consent.
type ConsentUpdate struct {
	// ClientName replaces the client's name when set.
	ClientName *string
	// Scope replaces what the user agreed to when not nil.
	Scope []string
	// ExpiresAt is the new idle deadline.
	ExpiresAt time.Time
}

// ConsentField enumerates the fields of Consent which can be used for
// filtering and ordering in list operations.
type ConsentField uint8

const (
	ConsentFieldUnspecified ConsentField = iota
	ConsentFieldProjectID
	ConsentFieldID
	ConsentFieldUserID
	ConsentFieldClientID
	ConsentFieldResource
	ConsentFieldCreatedAt
	ConsentFieldUpdatedAt
	ConsentFieldExpiresAt
)
