// Package invitation holds the invitations table's list schema and the
// encoding of its payload column, shared by the dialect statements.
package invitation

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// Row carries the scanned columns of one invitations row.
type Row struct {
	ProjectID         string
	ID                string
	Type              string
	Payload           []byte
	EncryptedMetadata *string
	Status            string
	CreatedBy         *string
	CreatedByType     *string
	CreatedAt         time.Time
	ExpiresAt         time.Time
	JourneyID         string
	RespondedBy       *string
	RespondedAt       *time.Time
	TokenHash         string
}

// MarshalPayload encodes the object of the invitation's type for the payload
// column. The service validates the request, so a malformed entity here is a
// server fault.
func MarshalPayload(entity *domain.Invitation) ([]byte, error) {
	switch entity.Type {
	case domain.InvitationTypeProjectMember:
		if entity.ProjectMember == nil {
			return nil, domain.ErrInternal(fmt.Errorf("project_member invitation %q has no relation", entity.ID))
		}
		return json.Marshal(entity.ProjectMember)
	default:
		return nil, domain.ErrInternal(fmt.Errorf("unknown invitation type %q", entity.Type))
	}
}

// StatusChange checks a ChangeInvitationStatus it can write: accepted or
// rejected, by a user. Anything else is a server fault.
func StatusChange(status domain.InvitationStatus, respondedBy string) error {
	if (status == domain.InvitationStatusAccepted || status == domain.InvitationStatusRejected) && respondedBy != "" {
		return nil
	}
	return domain.ErrInternal(fmt.Errorf("cannot change an invitation's status to %q", status))
}

// CreatedByType is the created_by_type column value, nil when unset.
func CreatedByType(entity *domain.Invitation) *string {
	if entity.CreatedByType == nil {
		return nil
	}
	return new(string(*entity.CreatedByType))
}

// ToDomain converts a scanned row into a domain.Invitation.
func ToDomain(row Row) (*domain.Invitation, error) {
	entity := &domain.Invitation{
		ProjectID:         row.ProjectID,
		ID:                row.ID,
		Type:              domain.InvitationType(row.Type),
		EncryptedMetadata: row.EncryptedMetadata,
		Status:            domain.InvitationStatus(row.Status),
		CreatedBy:         row.CreatedBy,
		// Spanner returns UTC while pgx defaults to local; normalize.
		CreatedAt:   row.CreatedAt.UTC(),
		ExpiresAt:   row.ExpiresAt.UTC(),
		JourneyID:   row.JourneyID,
		RespondedBy: row.RespondedBy,
		TokenHash:   row.TokenHash,
	}
	if row.CreatedByType != nil {
		entity.CreatedByType = new(domain.EventActorType(*row.CreatedByType))
	}
	if row.RespondedAt != nil {
		entity.RespondedAt = new(row.RespondedAt.UTC())
	}
	switch entity.Type {
	case domain.InvitationTypeProjectMember:
		entity.ProjectMember = new(domain.InvitationProjectMember)
		if err := json.Unmarshal(row.Payload, entity.ProjectMember); err != nil {
			return nil, fmt.Errorf("invitation %q: decode payload: %w", row.ID, err)
		}
	default:
		return nil, fmt.Errorf("invitation %q has an unknown type %q", row.ID, row.Type)
	}
	return entity, nil
}
