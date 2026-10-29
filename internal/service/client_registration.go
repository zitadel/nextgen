package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// clientRegistrationPurgeBatch bounds how many expired registrations one
// registration checks, so the purge rides along with the write that grows the
// table without making it slow.
const clientRegistrationPurgeBatch = 20

// ClientRegistrationConsents is what the authorization server keeps for
// clients that registered themselves: consents and the tokens issued under
// them. The registration store calls it inside its own transactions, so a
// registration goes together with what names it.
type ClientRegistrationConsents interface {
	// Named returns the ids among clientIDs that a live consent names.
	Named(ctx context.Context, stmts AllStatements, projectID string, clientIDs []string) ([]string, error)
	// Delete deletes the consents that name clientID, and their tokens.
	Delete(ctx context.Context, stmts AllStatements, projectID, clientID string) error
}

// NoConsents is the ClientRegistrationConsents of a server that keeps no
// consents for registered clients: none names a registration, and deleting
// one deletes nothing else.
type NoConsents struct{}

func (NoConsents) Named(context.Context, AllStatements, string, []string) ([]string, error) {
	return nil, nil
}

func (NoConsents) Delete(context.Context, AllStatements, string, string) error {
	return nil
}

type RegisterClientInput struct {
	ProjectID string
	Metadata  domain.ClientRegistrationMetadata
}

type RegisterClientOutput struct {
	Registration *domain.ClientRegistration
	// Secret is the client secret the server generated for a registration
	// that authenticates with one. It is returned once and stored only as a
	// hash.
	Secret string
}

type ListClientRegistrationsInput struct {
	ProjectID string
	Sorting   *Sorting // optional; defaults to created_at asc
	Filters   []Filter
	Limit     int
	PageToken string
}

type ListClientRegistrationsOutput struct {
	Items         []*domain.ClientRegistration
	NextPageToken string
}

// ClientRegistrationService keeps the clients that registered themselves
// through dynamic client registration (RFC 7591). They are transient: a
// registration no live consent names is purged once past its expiry.
type ClientRegistrationService interface {
	// Register stores a client's registration under a minted client_id, with
	// a generated secret when the client authenticates with one. The
	// authorization server's POST /register calls it once it decided that an
	// app of the project opens dynamic registration. Each call first purges
	// a batch of the project's registrations that expired unused.
	Register(ctx context.Context, input RegisterClientInput) (*RegisterClientOutput, error)
	Get(ctx context.Context, projectID, id string) (*domain.ClientRegistration, error)
	List(ctx context.Context, input ListClientRegistrationsInput) (*ListClientRegistrationsOutput, error)
	// Delete deletes a registration with its consents and their tokens, in
	// one transaction.
	Delete(ctx context.Context, projectID, id string) error
}

type clientRegistrationService struct {
	pool     *DB
	consents ClientRegistrationConsents
}

func NewClientRegistrationService(pool *DB, consents ClientRegistrationConsents) ClientRegistrationService {
	return &clientRegistrationService{pool: pool, consents: consents}
}

func (s *clientRegistrationService) Register(ctx context.Context, input RegisterClientInput) (_ *RegisterClientOutput, err error) {
	ctx, end := startSpan(ctx, "ClientRegistrationService.Register")
	defer end(&err)

	metadata := input.Metadata.WithDefaults()
	if err := metadata.Validate(); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	entity := &domain.ClientRegistration{
		ProjectID: input.ProjectID,
		Metadata:  metadata,
		ExpiresAt: now.Add(domain.ClientRegistrationLifetime),
	}
	out := &RegisterClientOutput{Registration: entity}
	if metadata.AuthMethod.UsesSecret() {
		out.Secret, entity.SecretHash, err = newClientSecret()
		if err != nil {
			return nil, err
		}
	}
	err = s.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		if err := s.purgeExpired(ctx, stmts, input.ProjectID, now); err != nil {
			return err
		}
		if err := stmts.CreateClientRegistration(ctx, entity); err != nil {
			return err
		}
		return emitClientRegistrationEvent(ctx, stmts, domain.EventTypeClientRegistrationCreated, domain.EventCategoryAuth, entity)
	})
	if err != nil {
		return nil, mapClientRegistrationError(err, "failed to register client")
	}
	return out, nil
}

// purgeExpired deletes up to a batch of the project's registrations past
// their expiry that no live consent names, each with whatever consents and
// tokens still name it. A registration a live consent names stays, and is
// checked again a lifetime later, so it does not hold the batch from the
// rest. A row another purge got to first is skipped.
func (s *clientRegistrationService) purgeExpired(ctx context.Context, stmts AllStatements, projectID string, now time.Time) error {
	ids, err := stmts.ListExpiredClientRegistrations(ctx, projectID, now, clientRegistrationPurgeBatch)
	if err != nil || len(ids) == 0 {
		return err
	}
	named, err := s.consents.Named(ctx, stmts, projectID, ids)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if slices.Contains(named, id) {
			err = stmts.ExtendClientRegistration(ctx, projectID, id, now.Add(domain.ClientRegistrationLifetime))
		} else if err = s.consents.Delete(ctx, stmts, projectID, id); err == nil {
			err = stmts.DeleteClientRegistration(ctx, projectID, id)
		}
		if _, gone := errors.AsType[*database.NoRowFoundError](err); err != nil && !gone {
			return err
		}
	}
	return nil
}

func (s *clientRegistrationService) Get(ctx context.Context, projectID, id string) (_ *domain.ClientRegistration, err error) {
	ctx, end := startSpan(ctx, "ClientRegistrationService.Get")
	defer end(&err)

	entity, err := s.pool.Statements().GetClientRegistration(ctx, projectID, id)
	if err != nil {
		return nil, mapClientRegistrationError(err, "failed to get client registration")
	}
	return entity, nil
}

func (s *clientRegistrationService) List(ctx context.Context, input ListClientRegistrationsInput) (_ *ListClientRegistrationsOutput, err error) {
	ctx, end := startSpan(ctx, "ClientRegistrationService.List")
	defer end(&err)

	filters := []database.Filter[domain.ClientRegistrationField]{
		database.Equal(database.Col(domain.ClientRegistrationFieldProjectID), input.ProjectID),
	}
	for _, f := range input.Filters {
		filter, err := clientRegistrationFilter(f)
		if err != nil {
			return nil, err
		}
		filters = append(filters, filter)
	}
	orderBy, err := listOrderBy(input.Sorting, domain.ClientRegistrationFieldCreatedAt, database.OrderAsc, clientRegistrationField, domain.ClientRegistrationFieldID)
	if err != nil {
		return nil, err
	}
	result, err := s.pool.Statements().ListClientRegistrations(ctx, &database.ListOptions[domain.ClientRegistrationField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.ClientRegistrationField]{
			Limit:   uint32(normalizeLimit(input.Limit)),
			OrderBy: orderBy,
			Cursor:  []byte(input.PageToken),
		},
	})
	if err != nil {
		return nil, mapListError(err, "failed to list client registrations")
	}
	return &ListClientRegistrationsOutput{Items: result.Items, NextPageToken: string(result.NextCursor)}, nil
}

func (s *clientRegistrationService) Delete(ctx context.Context, projectID, id string) (err error) {
	ctx, end := startSpan(ctx, "ClientRegistrationService.Delete")
	defer end(&err)

	err = s.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		entity, err := stmts.GetClientRegistration(ctx, projectID, id)
		if err != nil {
			return err
		}
		if err := s.consents.Delete(ctx, stmts, projectID, id); err != nil {
			return err
		}
		if err := stmts.DeleteClientRegistration(ctx, projectID, id); err != nil {
			return err
		}
		return emitClientRegistrationEvent(ctx, stmts, domain.EventTypeClientRegistrationDeleted, domain.EventCategoryAdmin, entity)
	})
	if err != nil {
		return mapClientRegistrationError(err, "failed to delete client registration")
	}
	return nil
}

func mapClientRegistrationError(err error, internalMsg string) error {
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return domain.ErrClientRegistrationNotFound()
	}
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		// project_id is the only foreign key, so the project is gone.
		return domain.ErrClientRegistrationNotFound().WithParent(err)
	}
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	return domain.ErrInternal(err).WithMessage(internalMsg)
}

// clientRegistrationFilter maps an API filter predicate to a storage filter.
func clientRegistrationFilter(f Filter) (database.Filter[domain.ClientRegistrationField], error) {
	switch f.Field {
	case "created_at":
		return createdAtFilter(f.Operation, database.Col(domain.ClientRegistrationFieldCreatedAt), f.Value)
	case "expires_at":
		return timestampFilter("expires_at", f.Operation, database.Col(domain.ClientRegistrationFieldExpiresAt), f.Value)
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", f.Field))
	}
}

// clientRegistrationField maps an API sort field to its
// [domain.ClientRegistrationField].
func clientRegistrationField(field string) (domain.ClientRegistrationField, error) {
	switch field {
	case "created_at":
		return domain.ClientRegistrationFieldCreatedAt, nil
	case "expires_at":
		return domain.ClientRegistrationFieldExpiresAt, nil
	default:
		return domain.ClientRegistrationFieldUnspecified, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", field))
	}
}

func emitClientRegistrationEvent(ctx context.Context, stmts AllStatements, eventType domain.EventType, category domain.EventCategory, entity *domain.ClientRegistration) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       eventType,
		Category:   category,
		ProjectID:  entity.ProjectID,
		EntityType: "client_registration",
		EntityID:   entity.ID,
		Payload:    domain.ClientRegistrationPayload(entity.Metadata),
	})
}
