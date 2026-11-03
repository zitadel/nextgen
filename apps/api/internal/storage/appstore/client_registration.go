package appstore

import (
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ClientRegistrationSchema binds client registration list, filter and order
// fields for all dialects. The read is a single table, so names are bare.
var ClientRegistrationSchema = database.NewSchema(map[domain.ClientRegistrationField]database.FieldBinding[domain.ClientRegistration]{
	domain.ClientRegistrationFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(r *domain.ClientRegistration) any { return r.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.ClientRegistrationFieldID: {
		SQLName:  "id",
		Accessor: func(r *domain.ClientRegistration) any { return r.ID },
		Coerce:   database.CoerceString,
	},
	domain.ClientRegistrationFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(r *domain.ClientRegistration) any { return r.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.ClientRegistrationFieldExpiresAt: {
		SQLName:  "expires_at",
		Accessor: func(r *domain.ClientRegistration) any { return r.ExpiresAt },
		Coerce:   database.CoerceTime,
	},
})

// EnsureClientRegistrationListOptions returns opts with the default
// created_at + id ascending order when OrderBy is unset, and an id tiebreak
// after any other order. A nil opts becomes an empty ListOptions.
func EnsureClientRegistrationListOptions(opts *database.ListOptions[domain.ClientRegistrationField]) *database.ListOptions[domain.ClientRegistrationField] {
	if opts == nil {
		opts = &database.ListOptions[domain.ClientRegistrationField]{}
	}
	out := *opts
	if len(out.Pagination.OrderBy.Columns) == 0 {
		out.Pagination.OrderBy = database.OrderBy[domain.ClientRegistrationField]{
			Columns: []database.Column[domain.ClientRegistrationField]{
				database.Col(domain.ClientRegistrationFieldCreatedAt),
				database.Col(domain.ClientRegistrationFieldID),
			},
			Direction: database.OrderAsc,
		}
	}
	return &out
}

// EncodeClientRegistrationMetadata is the metadata column's value.
func EncodeClientRegistrationMetadata(m domain.ClientRegistrationMetadata) ([]byte, error) {
	return json.Marshal(m)
}

// DecodeClientRegistrationMetadata reads the metadata column.
func DecodeClientRegistrationMetadata(raw []byte) (domain.ClientRegistrationMetadata, error) {
	var m domain.ClientRegistrationMetadata
	err := json.Unmarshal(raw, &m)
	return m, err
}
