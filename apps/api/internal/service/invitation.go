package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/invitation"
)

// MaxPendingInvitations caps a project's pending, unexpired invitations.
const MaxPendingInvitations = 100

const invitationMetadataMaxLen = 200

// InvitationService manages a project's invitations (ADR 086).
type InvitationService struct {
	db     *DB
	keys   KeyService
	grants *GrantService
	refs   UserRefResolver
	// consoleBaseURL never ends in a slash.
	consoleBaseURL    string
	platformProjectID string
}

func NewInvitationService(db *DB, keys KeyService, grants *GrantService, refs UserRefResolver, consoleBaseURL, platformProjectID string) *InvitationService {
	return &InvitationService{
		db:                db,
		keys:              keys,
		grants:            grants,
		refs:              refs,
		consoleBaseURL:    consoleBaseURL,
		platformProjectID: platformProjectID,
	}
}

// Invitation is a stored invitation with its metadata decrypted.
type Invitation struct {
	*domain.Invitation
	Metadata *domain.InvitationMetadata
	// Inviter names CreatedBy when the list expands it; nil otherwise and
	// when a project secret created the invitation.
	Inviter *domain.UserRef
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
	// Statuses matches any of them; empty matches all.
	Statuses      []domain.InvitationStatus
	Type          *domain.InvitationType
	ExpandInviter bool
	Limit         int
	PageToken     string
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
	claimed, err := projectIsClaimedOrExempt(ctx, s.db.Statements(), s.platformProjectID, input.ProjectID)
	if err != nil {
		return nil, err
	}
	if !claimed {
		return nil, domain.ErrInvitationProjectUnclaimed()
	}

	// Minted before the transaction, so a retried callback reuses them.
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
	// The metadata a replace moves is decrypted here: key lookups use the
	// pool, which inside the transaction can deadlock on SQLite's one connection.
	var moved *Invitation
	if input.ReplacesInvitationID != "" && input.Metadata == nil {
		original, err := s.db.Statements().GetInvitationByID(ctx, input.ProjectID, input.ReplacesInvitationID)
		if err != nil {
			return nil, mapInvitationError(err, "failed to create invitation")
		}
		if moved, err = decryptInvitation(decrypterOfWritingKey(ctx, s.keys), original); err != nil {
			return nil, err
		}
	}
	now := time.Now().UTC()
	actor, _ := audit.ActorFromContext(ctx)

	var created *domain.Invitation
	var metadata *domain.InvitationMetadata
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
			CreatedBy:         actor.ActorID,
			CreatedByType:     actor.ActorType,
		}
		metadata = input.Metadata

		var replaced *domain.Invitation
		if input.ReplacesInvitationID != "" {
			var err error
			replaced, err = s.releaseReplaced(ctx, stmts, input.ProjectID, input.ReplacesInvitationID)
			if err != nil {
				return err
			}
			entity.JourneyID = replaced.JourneyID
			// Metadata is never rewritten, only cleared, so the earlier read still matches.
			if moved != nil && moved.Metadata != nil && replaced.EncryptedMetadata != nil {
				entity.EncryptedMetadata = replaced.EncryptedMetadata
				metadata = moved.Metadata
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
		if replaced != nil {
			if err := emitInvitationCancelled(ctx, stmts, replaced, domain.InvitationCancelReasonReplaced, entity.ID); err != nil {
				return err
			}
		}
		if err := emitInvitationCreated(ctx, stmts, entity, input.ReplacesInvitationID); err != nil {
			return err
		}
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
	return decryptInvitation(decrypterOfWritingKey(ctx, s.keys), entity)
}

// List returns a project's invitations newest first.
func (s *InvitationService) List(ctx context.Context, req ListInvitationsRequest) (_ *ListInvitationsResponse, err error) {
	ctx, end := startSpan(ctx, "InvitationService.List")
	defer end(&err)

	opts := invitation.ListOptions(req.ProjectID, req.Statuses, req.Type, time.Now().UTC(), uint32(normalizeLimit(req.Limit)))
	if req.PageToken != "" {
		opts.Pagination.Cursor = []byte(req.PageToken)
	}
	result, err := s.db.Statements().ListInvitations(ctx, opts)
	if err != nil {
		return nil, mapListError(err, "failed to list invitations")
	}
	decrypter := decrypterOfWritingKey(ctx, s.keys)
	invitations := make([]*Invitation, 0, len(result.Items))
	for _, entity := range result.Items {
		item, err := decryptInvitation(decrypter, entity)
		if err != nil {
			return nil, err
		}
		invitations = append(invitations, item)
	}
	if req.ExpandInviter {
		if err := s.resolveInviters(ctx, invitations); err != nil {
			return nil, err
		}
	}
	return &ListInvitationsResponse{
		Invitations:   invitations,
		NextPageToken: string(result.NextCursor),
	}, nil
}

// Cancel deletes a pending or rejected invitation.
func (s *InvitationService) Cancel(ctx context.Context, projectID, id string) (err error) {
	ctx, end := startSpan(ctx, "InvitationService.Cancel")
	defer end(&err)

	now := time.Now().UTC()
	err = s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		entity, err := stmts.GetInvitationByID(ctx, projectID, id)
		if err != nil {
			return err
		}
		if err := stmts.DeleteCancellableInvitation(ctx, projectID, id, now); err != nil {
			return notPendingOnMiss(err)
		}
		return emitInvitationCancelled(ctx, stmts, entity, domain.InvitationCancelReasonCancelled, "")
	})
	if err != nil {
		return mapInvitationError(err, "failed to cancel invitation")
	}
	return nil
}

// InvitationLookup is what the accept page shows of a pending invitation.
type InvitationLookup struct {
	*domain.Invitation
	ProjectName string
	// Inviter names CreatedBy for a redeemer who cannot read platform users.
	// Nil when a project secret created the invitation.
	Inviter *domain.UserRef
}

// resolveInviters sets each invitation's Inviter from its CreatedBy.
func (s *InvitationService) resolveInviters(ctx context.Context, invitations []*Invitation) error {
	var ids []string
	for _, item := range invitations {
		if item.CreatedBy != nil && !slices.Contains(ids, *item.CreatedBy) {
			ids = append(ids, *item.CreatedBy)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	refs, err := s.inviterRefs(ctx, ids)
	if err != nil {
		return err
	}
	for _, item := range invitations {
		if item.CreatedBy != nil {
			item.Inviter = new(refs[*item.CreatedBy])
		}
	}
	return nil
}

// inviterRefs resolves invitation creators, who are platform users. Every id
// gets a ref: a missing user degrades to its id.
func (s *InvitationService) inviterRefs(ctx context.Context, ids []string) (map[string]domain.UserRef, error) {
	refs, err := s.refs.ResolveUserRefs(ctx, s.platformProjectID, ids)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to resolve the inviter")
	}
	out := make(map[string]domain.UserRef, len(ids))
	for _, id := range ids {
		ref, ok := refs[id]
		if !ok {
			ref = domain.UserRef{UserID: id}
		}
		out[id] = ref
	}
	return out, nil
}

// InviterCheck reports whether userID still administers projectID, reading
// through stmts inside the accept's transaction.
type InviterCheck func(ctx context.Context, stmts AllStatements, projectID, userID string) (bool, error)

// Lookup finds a pending invitation by its link's token.
func (s *InvitationService) Lookup(ctx context.Context, token string) (_ *InvitationLookup, err error) {
	ctx, end := startSpan(ctx, "InvitationService.Lookup")
	defer end(&err)

	stmts := s.db.Statements()
	entity, err := pendingInvitationByToken(ctx, stmts, token, time.Now().UTC())
	if err != nil {
		return nil, mapInvitationError(err, "failed to look up invitation")
	}
	project, err := stmts.GetProjectByID(ctx, entity.ProjectID)
	if err != nil {
		return nil, mapInvitationError(err, "failed to look up invitation")
	}
	found := &InvitationLookup{Invitation: entity, ProjectName: project.Name}
	if entity.CreatedBy != nil {
		refs, err := s.inviterRefs(ctx, []string{*entity.CreatedBy})
		if err != nil {
			return nil, err
		}
		found.Inviter = new(refs[*entity.CreatedBy])
	}
	return found, nil
}

// Accept redeems a pending invitation for userID: the type's adapter writes
// the access, then the invitation is marked accepted (ADR 086 §4).
func (s *InvitationService) Accept(ctx context.Context, token, userID string, inviterIsAdmin InviterCheck) (_ *Invitation, err error) {
	ctx, end := startSpan(ctx, "InvitationService.Accept")
	defer end(&err)

	if s.platformProjectID == "" {
		return nil, domain.ErrInvitationPlatformRequired()
	}
	var accepted *domain.Invitation
	err = s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		// Read per attempt, so a retried transaction rechecks expiry.
		now := time.Now().UTC()
		entity, err := pendingInvitationByToken(ctx, stmts, token, now)
		if err != nil {
			return err
		}
		if entity.CreatedBy != nil && *entity.CreatedBy == userID {
			return domain.ErrInvitationSelfAccept()
		}
		// Serializes the grant writes of accepts racing on other links, and
		// locks the project before the row, as create does.
		if err := stmts.LockProject(ctx, entity.ProjectID); err != nil {
			return err
		}
		claimed, err := projectIsClaimedOrExempt(ctx, stmts, s.platformProjectID, entity.ProjectID)
		if err != nil {
			return err
		}
		if !claimed {
			return domain.ErrInvitationProjectUnclaimed()
		}
		// A project secret names no user, so only the project check applies.
		if entity.CreatedBy != nil {
			admin, err := inviterIsAdmin(ctx, stmts, entity.ProjectID, *entity.CreatedBy)
			if err != nil {
				return err
			}
			if !admin {
				return domain.ErrInvitationInviterNotAdmin()
			}
		}
		// The guarded status change goes first: it locks the row, so a racing
		// accept misses here instead of colliding on the grant.
		accepted, err = stmts.ChangeInvitationStatus(ctx, entity.ProjectID, entity.ID, domain.InvitationStatusAccepted, &userID, now)
		if err != nil {
			return notPendingOnMiss(err)
		}
		if err := s.grantInvited(ctx, stmts, entity, userID, now); err != nil {
			return err
		}
		return emitInvitationAccepted(ctx, stmts, accepted, userID)
	})
	if err != nil {
		// Only the token lookup's miss is a 404; any other miss is a fault.
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to accept invitation")
	}
	return &Invitation{Invitation: accepted}, nil
}

// grantInvited is the invitation type's adapter: it calls the service that
// owns the target, and acceptance continues only on its success.
func (s *InvitationService) grantInvited(ctx context.Context, stmts AllStatements, entity *domain.Invitation, userID string, now time.Time) error {
	switch entity.Type {
	case domain.InvitationTypeProjectMember:
		if entity.ProjectMember == nil {
			return domain.ErrInternal(fmt.Errorf("invitation %q has no project_member object", entity.ID))
		}
		err := s.grants.EnsureUserGrant(ctx, stmts, entity.ProjectID, userID, entity.ProjectMember.Relation, now)
		// Create validated the relation, so a refusal here is a stored fault.
		if errors.Is(err, domain.ErrGrantInvalid()) {
			return domain.ErrInternal(err).WithMessage("invitation holds an invalid relation")
		}
		// The session's user is gone or no longer active.
		if errors.Is(err, domain.ErrGrantPrincipalNotFound()) {
			return domain.ErrAuthUnauthorized(err)
		}
		return err
	default:
		return domain.ErrNotImplemented()
	}
}

// Reject declines a pending invitation for userID.
func (s *InvitationService) Reject(ctx context.Context, token, userID string) (_ *Invitation, err error) {
	ctx, end := startSpan(ctx, "InvitationService.Reject")
	defer end(&err)

	var rejected *domain.Invitation
	err = s.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		now := time.Now().UTC()
		entity, err := pendingInvitationByToken(ctx, stmts, token, now)
		if err != nil {
			return err
		}
		// An administrator cancels their own invitation instead.
		if entity.CreatedBy != nil && *entity.CreatedBy == userID {
			return domain.ErrInvitationSelfReject()
		}
		rejected, err = stmts.ChangeInvitationStatus(ctx, entity.ProjectID, entity.ID, domain.InvitationStatusRejected, nil, now)
		if err != nil {
			return notPendingOnMiss(err)
		}
		return emitInvitationRejected(ctx, stmts, rejected, userID)
	})
	if err != nil {
		return nil, mapInvitationError(err, "failed to reject invitation")
	}
	// The metadata stays for administrators; the link holder doesn't see it.
	rejected.EncryptedMetadata = nil
	return &Invitation{Invitation: rejected}, nil
}

// pendingInvitationByToken finds the invitation a link's token redeems. An
// unknown token and a finished invitation miss alike.
func pendingInvitationByToken(ctx context.Context, stmts InvitationStatements, token string, now time.Time) (*domain.Invitation, error) {
	entity, err := stmts.GetInvitationByTokenHash(ctx, domain.HashSecret(token))
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrInvitationNotFound()
		}
		return nil, err
	}
	if entity.StatusAt(now) != domain.InvitationStatusPending {
		return nil, domain.ErrInvitationNotPending()
	}
	return entity, nil
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

// decryptInvitation reads an invitation's metadata with the key that wrote it.
func decryptInvitation(decrypter crypto.Decrypter, entity *domain.Invitation) (*Invitation, error) {
	item := &Invitation{Invitation: entity}
	if entity.EncryptedMetadata == nil {
		return item, nil
	}
	plain, err := decrypter.Decrypt(*entity.EncryptedMetadata)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to decrypt invitation metadata")
	}
	item.Metadata = new(domain.InvitationMetadata)
	if err := json.Unmarshal([]byte(plain), item.Metadata); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to decode invitation metadata")
	}
	return item, nil
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

func emitInvitationCreated(ctx context.Context, stmts EventStatements, entity *domain.Invitation, replacesID string) error {
	payload := domain.InvitationCreatedPayload{
		Type:                 string(entity.Type),
		JourneyID:            entity.JourneyID,
		ReplacesInvitationID: replacesID,
		ExpiresAt:            entity.ExpiresAt,
	}
	if entity.ProjectMember != nil {
		payload.ProjectMember = &domain.InvitationProjectMemberPayload{Relation: entity.ProjectMember.Relation}
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeInvitationCreated,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "invitation",
		EntityID:   entity.ID,
		Payload:    payload,
	})
}

func emitInvitationAccepted(ctx context.Context, stmts EventStatements, entity *domain.Invitation, userID string) error {
	payload := domain.InvitationAcceptedPayload{
		Type:      string(entity.Type),
		JourneyID: entity.JourneyID,
		UserID:    userID,
	}
	if entity.ProjectMember != nil {
		payload.ProjectMember = &domain.InvitationProjectMemberPayload{Relation: entity.ProjectMember.Relation}
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeInvitationAccepted,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "invitation",
		EntityID:   entity.ID,
		Payload:    payload,
	})
}

func emitInvitationRejected(ctx context.Context, stmts EventStatements, entity *domain.Invitation, userID string) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeInvitationRejected,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "invitation",
		EntityID:   entity.ID,
		Payload:    domain.InvitationRejectedPayload{JourneyID: entity.JourneyID, UserID: userID},
	})
}

func emitInvitationCancelled(ctx context.Context, stmts EventStatements, entity *domain.Invitation, reason, replacedBy string) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeInvitationCancelled,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "invitation",
		EntityID:   entity.ID,
		Payload: domain.InvitationCancelledPayload{
			JourneyID:              entity.JourneyID,
			Reason:                 reason,
			ReplacedByInvitationID: replacedBy,
		},
	})
}
