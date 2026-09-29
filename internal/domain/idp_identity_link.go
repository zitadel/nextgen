package domain

import "time"

// PrefixIDPIdentityLink namespaces identity link ids ("idplink_01KWH3B...").
// Storage-only: no API addresses a link by id.
const PrefixIDPIdentityLink ResourcePrefix = "idplink"

// IDPIdentityLink pins one provider subject on one connection to one user.
// ConnectionID is the connection's id (idp_...), never a revision id: the link
// must survive edits to the connection. Rows are never updated.
type IDPIdentityLink struct {
	ProjectID    string
	ID           string
	ConnectionID string
	// Subject is the provider's identifier for the account, compared as an
	// exact string. Never empty.
	Subject   string
	UserID    string
	CreatedAt time.Time
}

// IDPIdentityLinkField enumerates the fields of IDPIdentityLink which can be
// used for filtering.
type IDPIdentityLinkField uint8

const (
	IDPIdentityLinkFieldUnspecified IDPIdentityLinkField = iota
	IDPIdentityLinkFieldProjectID
	IDPIdentityLinkFieldID
	IDPIdentityLinkFieldConnectionID
	IDPIdentityLinkFieldSubject
	IDPIdentityLinkFieldUserID
	IDPIdentityLinkFieldCreatedAt
)
