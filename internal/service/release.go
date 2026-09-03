package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/release"
)

// ---- Input / output types ---------------------------------------------------

// CreateReleasePointer is one revision the caller asked to pin. The handle is
// absent by design: it is the revision's own identifying field, so the service
// reads it from the revision during the existence check it already performs.
type CreateReleasePointer struct {
	Kind       domain.ReleasePointerKind
	RevisionID string
}

type CreateReleaseInput struct {
	ProjectID string
	Pointers  []CreateReleasePointer
	Message   *string
	GitSHA    *string
	GitDirty  bool
}

type CreateReleaseOutput struct {
	Release *domain.Release
	// Created distinguishes a new release from one that already pinned this
	// exact set, which the caller answers 200 to rather than 201.
	Created bool
}

type ListReleasesInput struct {
	ProjectID string
	PageToken string
	Limit     int
}

type ListReleasesOutput struct {
	Items         []*domain.Release
	NextPageToken string
}

type ReleaseService interface {
	Create(ctx context.Context, input CreateReleaseInput) (*CreateReleaseOutput, error)
	Get(ctx context.Context, projectID, id string) (*domain.Release, error)
	List(ctx context.Context, input ListReleasesInput) (*ListReleasesOutput, error)
}

type releaseService struct {
	v2Pool *DB
}

func NewReleaseService(v2Pool *DB) ReleaseService {
	return &releaseService{v2Pool: v2Pool}
}

// Create assembles a release from revisions that already exist.
//
// It is idempotent on the pinned set rather than on a caller-supplied key:
// metadata is excluded from the content hash, so re-submitting the same
// revisions under a new message resolves to the release that already pins
// them. That makes a re-run against unchanged content a no-op rather than a
// growing pile of identical releases.
func (s *releaseService) Create(ctx context.Context, input CreateReleaseInput) (*CreateReleaseOutput, error) {
	pointers, err := s.resolvePointers(ctx, input.ProjectID, input.Pointers)
	if err != nil {
		return nil, err
	}

	actor, _ := audit.ActorFromContext(ctx)
	entity, err := domain.NewRelease(input.ProjectID, pointers, domain.ReleaseMetadata{
		Message:       input.Message,
		GitSHA:        input.GitSHA,
		GitDirty:      input.GitDirty,
		CreatedBy:     actor.ActorID,
		CreatedByType: actor.ActorType,
	})
	if err != nil {
		return nil, err
	}

	// Read before insert so the common re-deploy answers without burning an
	// id. The unique index on (project_id, content_hash) is what makes this
	// correct under concurrency; the read only spares the round trip.
	existing, err := s.getByContentHash(ctx, input.ProjectID, entity.ContentHash)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return &CreateReleaseOutput{Release: existing}, nil
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateRelease(ctx, entity); err != nil {
			return err
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeReleaseCreated,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  entity.ProjectID,
			EntityType: "release",
			EntityID:   entity.ID,
			Payload:    domain.ReleasePayloadSnapshot(entity),
		})
	})
	if err != nil {
		// Two callers pinned the same set at once and this one lost the race.
		// The winner's release is the answer: the loser asked for a release
		// pinning exactly that set, and one now exists.
		if _, ok := errors.AsType[*database.IntegrityViolationError](err); ok {
			raced, hashErr := s.getByContentHash(ctx, input.ProjectID, entity.ContentHash)
			if hashErr != nil {
				return nil, hashErr
			}
			if raced != nil {
				return &CreateReleaseOutput{Release: raced}, nil
			}
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create release")
	}

	return &CreateReleaseOutput{Release: entity, Created: true}, nil
}

func (s *releaseService) Get(ctx context.Context, projectID, id string) (*domain.Release, error) {
	entity, err := s.v2Pool.Statements().GetReleaseByID(ctx, projectID, id)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrReleaseNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get release from database")
	}
	return entity, nil
}

func (s *releaseService) List(ctx context.Context, input ListReleasesInput) (*ListReleasesOutput, error) {
	opts := release.ListOptions(input.ProjectID, uint32(normalizeLimit(input.Limit)))
	opts.Pagination.Cursor = []byte(input.PageToken)

	result, err := s.v2Pool.Statements().ListReleases(ctx, opts)
	if err != nil {
		return nil, mapListError(err, "failed to list releases")
	}

	return &ListReleasesOutput{
		Items:         result.Items,
		NextPageToken: string(result.NextCursor),
	}, nil
}

// getByContentHash returns nil without an error when the project holds no
// release pinning that set, so callers can branch on presence rather than on
// an error type.
func (s *releaseService) getByContentHash(ctx context.Context, projectID, contentHash string) (*domain.Release, error) {
	entity, err := s.v2Pool.Statements().GetReleaseByContentHash(ctx, projectID, contentHash)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, nil
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to look up release by content hash")
	}
	return entity, nil
}

// resolvePointers turns the caller's (kind, revision_id) pairs into pinned
// pointers, reading each revision's handle from the revision itself. Every
// revision is read anyway to prove it exists, so binding the handle here costs
// nothing extra and removes the class of error where a caller names a resource
// its own revision disagrees with.
//
// Ordering, the empty set and duplicate handles are the domain constructor's
// to reject; this only resolves.
//
// TODO(#1154): the pinned set is not checked for closure. A flow pinned here
// may reference a user schema this release does not pin, and nothing objects.
// The check belongs in this loop, which already holds every resolved handle and
// has read each revision — but it is not expressible while a flow references
// its schema by revision id instead of by handle (#1144).
func (s *releaseService) resolvePointers(ctx context.Context, projectID string, requested []CreateReleasePointer) ([]domain.ReleasePointer, error) {
	pointers := make([]domain.ReleasePointer, 0, len(requested))
	for _, pointer := range requested {
		handle, err := s.resolveHandle(ctx, projectID, pointer)
		if err != nil {
			return nil, err
		}
		pointers = append(pointers, domain.ReleasePointer{
			Kind:       pointer.Kind,
			Handle:     handle,
			RevisionID: pointer.RevisionID,
		})
	}
	return pointers, nil
}

// resolveHandle reads the handle a revision declares. It is per kind rather
// than a shared column read: a schema's handle is its objectType, a flow
// definition's is its name, and branding has no identifying field at all
// because a project has exactly one.
func (s *releaseService) resolveHandle(ctx context.Context, projectID string, pointer CreateReleasePointer) (string, error) {
	stmts := s.v2Pool.Statements()
	switch pointer.Kind {
	case domain.ReleasePointerKindSchema:
		schema, err := stmts.GetJSONSchemaByID(ctx, projectID, pointer.RevisionID)
		if err != nil {
			return "", mapRevisionLookupError(err, pointer)
		}
		// A schema registered by URL whose document was never parsed declares
		// no objectType, so nothing says which resource it is a revision of.
		if schema.ObjectType == nil || *schema.ObjectType == "" {
			return "", domain.ErrReleaseRevisionUnpinnable(
				fmt.Sprintf("schema %q declares no objectType", pointer.RevisionID))
		}
		return *schema.ObjectType, nil

	case domain.ReleasePointerKindFlowDefinition:
		definition, err := stmts.GetFlowDefinitionByID(ctx, projectID, pointer.RevisionID)
		if err != nil {
			return "", mapRevisionLookupError(err, pointer)
		}
		return definition.Name, nil

	case domain.ReleasePointerKindBranding:
		if _, err := stmts.GetBrandingByID(ctx, projectID, pointer.RevisionID); err != nil {
			return "", mapRevisionLookupError(err, pointer)
		}
		// A project has one branding, so there is nothing to distinguish it
		// from; the constant still collides correctly when a caller pins two
		// branding revisions in one release.
		return domain.ReleaseBrandingHandle, nil

	default:
		// Unreachable over HTTP: the wire enum admits only the three kinds
		// above. It stays mapped for the in-process callers that skip the
		// decoder.
		return "", domain.ErrReleaseInvalid(fmt.Sprintf("unknown pointer kind %d", pointer.Kind), nil)
	}
}

// mapRevisionLookupError reports a missing revision as the caller's error and
// anything else as ours. The detail names the pointer, since a release pins
// many and the code alone does not say which one failed.
func mapRevisionLookupError(err error, pointer CreateReleasePointer) error {
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return domain.ErrReleaseRevisionNotFound(
			fmt.Sprintf("no %s revision %q in this project", pointer.Kind, pointer.RevisionID))
	}
	return domain.ErrInternal(err).WithMessage("failed to resolve pinned revision")
}
