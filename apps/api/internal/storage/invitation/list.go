package invitation

import (
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// NewestFirst is created_at DESC, id DESC.
func NewestFirst() database.OrderBy[domain.InvitationField] {
	return database.OrderBy[domain.InvitationField]{
		Columns: []database.Column[domain.InvitationField]{
			database.Col(domain.InvitationFieldCreatedAt),
			database.Col(domain.InvitationFieldID),
		},
		Direction: database.OrderDesc,
	}
}

// ListOptions lists a project's invitations newest first. Statuses narrow it
// to any of them, and a non-nil type to that type; pending and expired are
// told apart by expires_at at now.
func ListOptions(projectID string, statuses []domain.InvitationStatus, typ *domain.InvitationType, now time.Time, limit uint32) *database.ListOptions[domain.InvitationField] {
	filters := []database.Filter[domain.InvitationField]{
		database.Equal(database.Col(domain.InvitationFieldProjectID), projectID),
	}
	if len(statuses) > 0 {
		anyOf := make([]database.Filter[domain.InvitationField], 0, len(statuses))
		for _, status := range statuses {
			anyOf = append(anyOf, StatusAt(status, now))
		}
		filters = append(filters, database.Or(anyOf...))
	}
	if typ != nil {
		filters = append(filters, database.Equal(database.Col(domain.InvitationFieldType), string(*typ)))
	}
	return &database.ListOptions[domain.InvitationField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.InvitationField]{
			Limit:   limit,
			OrderBy: NewestFirst(),
		},
	}
}

// StatusAt matches the invitations whose [domain.Invitation.StatusAt] is
// status at now.
func StatusAt(status domain.InvitationStatus, now time.Time) database.Filter[domain.InvitationField] {
	pending := database.Equal(database.Col(domain.InvitationFieldStatus), string(domain.InvitationStatusPending))
	unexpired := database.GreaterThan(database.Col(domain.InvitationFieldExpiresAt), now)
	switch status {
	case domain.InvitationStatusPending:
		return database.And(pending, unexpired)
	case domain.InvitationStatusExpired:
		return database.And(pending, database.Not(unexpired))
	default:
		return database.Equal(database.Col(domain.InvitationFieldStatus), string(status))
	}
}
