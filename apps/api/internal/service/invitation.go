package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/invitation"
)

// MaxPendingInvitations caps a project's pending, unexpired invitations.
const MaxPendingInvitations = 100

const invitationMetadataMaxLen = 200

// InvitationService manages a project's invitations (ADR 086).
type InvitationService struct {
	db                *DB
	keys              KeyService
	consoleBaseURL    string
	platformProjectID string
}

func NewInvitationService(db *DB, keys KeyService, consoleBaseURL, platformProjectID string) *InvitationService {
	return &InvitationService{
		db:                db,
		keys:              keys,
		consoleBaseURL:    strings.TrimRight(consoleBaseURL, "/"),
		platformProjectID: platformProjectID,
	}
}

// Invitation is a stored invitation with its metadata decrypted.
type Invitation struct {
	*domain.Invitation
	Metadata *domain.InvitationMetadata
}

// CreatedInvitation carries the link, which no later read returns.
type CreatedInvitation struct {
	Invitation
	Link string
}

type CreateInvitationInput struct {
	ProjectID     string
	Type          domain.InvitationType
	ProjectMember *domain.InvitationProjectMember
	Metadata      *domain.InvitationMetadata
	// ReplacesInvitationID makes this create a replace.
	ReplacesInvitationID string
}

type ListInvitationsRequest struct {
	ProjectID string
	Status    *domain.InvitationStatus
	Type      *domain.InvitationType
	Limit     int
	PageToken string
}

type ListInvitationsResponse struct {
	Invitations   []*Invitation
	NextPageToken string
}

func (s *InvitationService) Create(ctx context.Context, input CreateInvitationInput) (_ *CreatedInvitation, err error) {
	ctx, end := startSpan(ctx, "InvitationService.Create")
	defer end(&err)

	if err := validateCreateInvitation(&input); err != nil {
		return nil, err
	}
	// Without a platform project nobody can sign in to redeem the link.
	if s.platformProjectID == "" {
		return nil, domain.ErrInvitationPlatformRequired()
	}
	if input.ProjectID != s.platformProjectID {
		claimed, err := projectIsClaimed(ctx, s.db.Statements(), input.ProjectID)
		if err != nil {
			return nil, err
		}
		if !claimed {
			return nil, domain.ErrInvitationProjectUnclaimed()
		}
	}

	// Minted before the transaction, so a retried callback writes the same row.
	token, tokenHash, err := domain.NewInvitationToken()
	if err != nil {
		return nil, err
	}
	journeyID, err := domain.NewInvitationJourneyID()
	if err != nil {
		return nil, err
	}
	var encryptedMetadata *string
	if input.Metadata != nil {
		encryptedMetadata, err = s.encryptMetadata(ctx, input.ProjectID, input.Metadata)
		if err != nil {
			return nil, err
		}
	}
	now := time.Now().UTC()

	var created *domain.Invitation
	metadata := input.Metadata
	err = s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		// The cap holds only under this lock.
		if err := stmts.LockProject(ctx, input.ProjectID); err != nil {
			return err
		}
		entity := &domain.Invitation{
			ProjectID:         input.ProjectID,
			Type:              input.Type,
			ProjectMember:     input.ProjectMember,
			EncryptedMetadata: encryptedMetadata,
			ExpiresAt:         now.Add(domain.InvitationExpiration),
			JourneyID:         journeyID,
			TokenHash:         tokenHash,
		}
		actor, _ := audit.ActorFromContext(ctx)
		entity.CreatedBy = actor.ActorID
		entity.CreatedByType = actor.ActorType

		if input.ReplacesInvitationID != "" {
			original, err := s.releaseReplaced(ctx, stmts, input.ProjectID, input.ReplacesInvitationID)
			if err != nil {
				return err
			}
			entity.JourneyID = original.JourneyID
			if entity.EncryptedMetadata == nil && original.EncryptedMetadata != nil {
				// Decrypted before the insert: the link is lost if Create fails after it.
				moved, err := s.decrypt(ctx, original)
				if err != nil {
					return err
				}
				entity.EncryptedMetadata = original.EncryptedMetadata
				metadata = moved[0].Metadata
			}
		}

		pending, err := stmts.CountPendingInvitations(ctx, input.ProjectID, now)
		if err != nil {
			return err
		}
		if pending >= MaxPendingInvitations {
			return domain.ErrInvitationPendingLimit()
		}
		if err := stmts.CreateInvitation(ctx, entity); err != nil {
			return err
		}
		// TODO(#2850): emit invitation.created for entity, with
		// replaces_invitation_id, and invitation.cancelled (reason replaced,
		// replaced_by entity.ID) for the deleted original.
		created = entity
		return nil
	})
	if err != nil {
		return nil, mapInvitationError(err, "failed to create invitation")
	}
	return &CreatedInvitation{
		Invitation: Invitation{Invitation: created, Metadata: metadata},
		Link:       s.consoleBaseURL + "/invitations/accept#token=" + token,
	}, nil
}

// releaseReplaced deletes the original a replace names, unless it was accepted.
func (s *InvitationService) releaseReplaced(ctx context.Context, stmts AllStatements, projectID, id string) (*domain.Invitation, error) {
	original, err := stmts.GetInvitationByID(ctx, projectID, id)
	if err != nil {
		return nil, err
	}
	if original.Status == domain.InvitationStatusAccepted {
		return nil, domain.ErrInvitationNotPending()
	}
	// A miss here means it was accepted after the read.
	if err := stmts.DeleteUnacceptedInvitation(ctx, projectID, id); err != nil {
		return nil, notPendingOnMiss(err)
	}
	return original, nil
}

func (s *InvitationService) Get(ctx context.Context, projectID, id string) (_ *Invitation, err error) {
	ctx, end := startSpan(ctx, "InvitationService.Get")
	defer end(&err)

	entity, err := s.db.Statements().GetInvitationByID(ctx, projectID, id)
	if err != nil {
		return nil, mapInvitationError(err, "failed to get invitation")
	}
	invitations, err := s.decrypt(ctx, entity)
	if err != nil {
		return nil, err
	}
	return invitations[0], nil
}

// List returns a project's invitations newest first.
func (s *InvitationService) List(ctx context.Context, req ListInvitationsRequest) (_ *ListInvitationsResponse, err error) {
	ctx, end := startSpan(ctx, "InvitationService.List")
	defer end(&err)

	opts := invitation.ListOptions(req.ProjectID, req.Status, req.Type, time.Now().UTC(), uint32(normalizeLimit(req.Limit)))
	if req.PageToken != "" {
		opts.Pagination.Cursor = []byte(req.PageToken)
	}
	result, err := s.db.Statements().ListInvitations(ctx, opts)
	if err != nil {
		return nil, mapListError(err, "failed to list invitations")
	}
	invitations, err := s.decrypt(ctx, result.Items...)
	if err != nil {
		return nil, err
	}
	return &ListInvitationsResponse{
		Invitations:   invitations,
		NextPageToken: string(result.NextCursor),
	}, nil
}

// Cancel deletes a pending invitation.
func (s *InvitationService) Cancel(ctx context.Context, projectID, id string) (err error) {
	ctx, end := startSpan(ctx, "InvitationService.Cancel")
	defer end(&err)

	now := time.Now().UTC()
	err = s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		if _, err := stmts.GetInvitationByID(ctx, projectID, id); err != nil {
			return err
		}
		if err := stmts.DeletePendingInvitation(ctx, projectID, id, now); err != nil {
			return notPendingOnMiss(err)
		}
		// TODO(#2850): emit invitation.cancelled with reason cancelled.
		return nil
	})
	if err != nil {
		return mapInvitationError(err, "failed to cancel invitation")
	}
	return nil
}

func validateCreateInvitation(input *CreateInvitationInput) error {
	if input.ProjectID == "" {
		return domain.ErrInvitationInvalid().WithDetails("project_id is required")
	}
	if input.Type != domain.InvitationTypeProjectMember {
		return domain.ErrNotImplemented()
	}
	if input.ProjectMember == nil {
		return domain.ErrInvitationInvalid().WithDetails("project_member is required")
	}
	if _, ok := allowedGrantRelations[input.ProjectMember.Relation]; !ok {
		return domain.ErrInvitationInvalid().WithDetails("relation must be viewer, editor or admin")
	}
	input.ReplacesInvitationID = strings.TrimSpace(input.ReplacesInvitationID)
	if input.Metadata != nil {
		input.Metadata.Name = strings.TrimSpace(input.Metadata.Name)
		if input.Metadata.Name == "" || len([]rune(input.Metadata.Name)) > invitationMetadataMaxLen {
			return domain.ErrInvitationInvalid().WithDetails("metadata.name must be 1 to 200 characters")
		}
	}
	return nil
}

func (s *InvitationService) encryptMetadata(ctx context.Context, projectID string, metadata *domain.InvitationMetadata) (*string, error) {
	plain, err := json.Marshal(metadata)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to encode invitation metadata")
	}
	crypter, err := s.keys.GetProjectCrypter(ctx, projectID, domain.EncryptionKeyPurposeSecret)
	if err != nil {
		return nil, err
	}
	encrypted, err := crypter.Encrypt(string(plain))
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to encrypt invitation metadata")
	}
	return &encrypted, nil
}

// decrypt reads each invitation's metadata with the key that wrote it.
func (s *InvitationService) decrypt(ctx context.Context, entities ...*domain.Invitation) ([]*Invitation, error) {
	decrypter := decrypterOfWritingKey(ctx, s.keys)
	invitations := make([]*Invitation, 0, len(entities))
	for _, entity := range entities {
		item := &Invitation{Invitation: entity}
		if entity.EncryptedMetadata != nil {
			plain, err := decrypter.Decrypt(*entity.EncryptedMetadata)
			if err != nil {
				return nil, domain.ErrInternal(err).WithMessage("failed to decrypt invitation metadata")
			}
			item.Metadata = new(domain.InvitationMetadata)
			if err := json.Unmarshal([]byte(plain), item.Metadata); err != nil {
				return nil, domain.ErrInternal(err).WithMessage("failed to decode invitation metadata")
			}
		}
		invitations = append(invitations, item)
	}
	return invitations, nil
}

func notPendingOnMiss(err error) error {
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return domain.ErrInvitationNotPending()
	}
	return err
}

func mapInvitationError(err error, internalMsg string) error {
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return domain.ErrInvitationNotFound()
	}
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	return domain.ErrInternal(err).WithMessage(internalMsg)
}
