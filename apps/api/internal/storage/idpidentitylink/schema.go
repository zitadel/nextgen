// Package idpidentitylink holds the read plumbing every dialect shares for
// identity links.
package idpidentitylink

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds identity link filter fields for all dialects.
var Schema = database.NewSchema(map[domain.IDPIdentityLinkField]database.FieldBinding[domain.IDPIdentityLink]{
	domain.IDPIdentityLinkFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(l *domain.IDPIdentityLink) any { return l.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.IDPIdentityLinkFieldID: {
		SQLName:  "id",
		Accessor: func(l *domain.IDPIdentityLink) any { return l.ID },
		Coerce:   database.CoerceString,
	},
	domain.IDPIdentityLinkFieldConnectionID: {
		SQLName:  "connection_id",
		Accessor: func(l *domain.IDPIdentityLink) any { return l.ConnectionID },
		Coerce:   database.CoerceString,
	},
	domain.IDPIdentityLinkFieldSubject: {
		SQLName:  "subject",
		Accessor: func(l *domain.IDPIdentityLink) any { return l.Subject },
		Coerce:   database.CoerceString,
	},
	domain.IDPIdentityLinkFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(l *domain.IDPIdentityLink) any { return l.UserID },
		Coerce:   database.CoerceString,
	},
	domain.IDPIdentityLinkFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(l *domain.IDPIdentityLink) any { return l.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})
