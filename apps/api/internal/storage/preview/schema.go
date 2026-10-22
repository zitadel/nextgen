// Package preview holds shared helpers for the previews table.
package preview

import (
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds preview list/filter/order fields for all dialects.
var Schema = database.NewSchema(map[domain.PreviewField]database.FieldBinding[domain.Preview]{
	domain.PreviewFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(p *domain.Preview) any { return p.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.PreviewFieldOrigin: {
		SQLName:  "origin",
		Accessor: func(p *domain.Preview) any { return p.Origin },
		Coerce:   database.CoerceString,
	},
	domain.PreviewFieldExpiresAt: {
		SQLName:  "expires_at",
		Accessor: func(p *domain.Preview) any { return p.ExpiresAt },
		Coerce:   database.CoerceTime,
	},
	domain.PreviewFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(p *domain.Preview) any { return p.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})

// LiveListOptions lists the previews not expired at now, newest first.
func LiveListOptions(projectID string, now time.Time, limit uint32) *database.ListOptions[domain.PreviewField] {
	return &database.ListOptions[domain.PreviewField]{
		Filter: database.And(
			database.Equal(database.Col(domain.PreviewFieldProjectID), projectID),
			database.GreaterThan(database.Col(domain.PreviewFieldExpiresAt), now),
		),
		Pagination: database.Page[domain.PreviewField]{
			Limit: limit,
			OrderBy: database.OrderBy[domain.PreviewField]{
				Columns: []database.Column[domain.PreviewField]{
					database.Col(domain.PreviewFieldCreatedAt),
					database.Col(domain.PreviewFieldOrigin),
				},
				Direction: database.OrderDesc,
			},
		},
	}
}

// ExpiredListOptions lists the previews expired by now, oldest expiry first.
func ExpiredListOptions(projectID string, now time.Time, limit uint32) *database.ListOptions[domain.PreviewField] {
	return &database.ListOptions[domain.PreviewField]{
		Filter: database.And(
			database.Equal(database.Col(domain.PreviewFieldProjectID), projectID),
			// expires_at <= now; the filter vocabulary has no <=.
			database.Or(
				database.LessThan(database.Col(domain.PreviewFieldExpiresAt), now),
				database.Equal(database.Col(domain.PreviewFieldExpiresAt), now),
			),
		),
		Pagination: database.Page[domain.PreviewField]{
			Limit: limit,
			OrderBy: database.OrderBy[domain.PreviewField]{
				Columns: []database.Column[domain.PreviewField]{
					database.Col(domain.PreviewFieldExpiresAt),
					database.Col(domain.PreviewFieldOrigin),
				},
				Direction: database.OrderAsc,
			},
		},
	}
}
