package project

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ListOriginsOptions builds the hydrate list query for the given project ids:
// Or(equal project_id…) ordered by created_at, pattern, project_id.
func ListOriginsOptions(projectIDs []string) *database.ListOptions[domain.OriginField] {
	filters := make([]database.Filter[domain.OriginField], len(projectIDs))
	for i, id := range projectIDs {
		filters[i] = database.Equal(database.Col(domain.OriginFieldProjectID), id)
	}
	return &database.ListOptions[domain.OriginField]{
		Filter: database.Or(filters...),
		Pagination: database.Page[domain.OriginField]{
			OrderBy: database.OrderBy[domain.OriginField]{
				Columns: []database.Column[domain.OriginField]{
					database.Col(domain.OriginFieldCreatedAt),
					database.Col(domain.OriginFieldPattern),
					database.Col(domain.OriginFieldProjectID),
				},
			},
		},
	}
}

// AssignOrigins groups listed storage rows onto projects as wire-shaped
// origins (pattern + kind only). Missing projects get an empty slice.
func AssignOrigins(projects []*domain.Project, listed []*domain.Origin) {
	byProject := make(map[string][]domain.Origin, len(projects))
	for _, o := range listed {
		byProject[o.ProjectID] = append(byProject[o.ProjectID], domain.Origin{
			Pattern: o.Pattern,
			Kind:    o.Kind,
		})
	}
	for _, p := range projects {
		origins := byProject[p.ID]
		if origins == nil {
			origins = []domain.Origin{}
		}
		p.Origins = origins
	}
}
