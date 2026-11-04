package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
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
	Build(ctx context.Context, input BuildReleaseInput) (*CreateReleaseOutput, error)
	Get(ctx context.Context, projectID, id string) (*domain.Release, error)
	List(ctx context.Context, input ListReleasesInput) (*ListReleasesOutput, error)
	Revoke(ctx context.Context, projectID, id string) (*domain.Release, error)
}

type releaseService struct {
	v2Pool   *DB
	schemas  *SchemaService
	flows    *flowDefinitionService
	branding *BrandingService
	idps     *idpConnectionService
	apps     *appService
	policies *PolicyService
	// builtinBases resolves a schema given as a built-in schema's `$id` under
	// whichever base the project stores it; the release pins the row found.
	builtinBases domain.BuiltinSchemaBases
}

// NewReleaseService wires Build's kind writers. flows, idps and apps are the
// concretes from NewFlowDefinitionService, NewIDPConnectionService and
// NewAppService.
func NewReleaseService(
	v2Pool *DB,
	schemas *SchemaService,
	flows *flowDefinitionService,
	branding *BrandingService,
	idps *idpConnectionService,
	apps *appService,
	policies *PolicyService,
	builtinBases domain.BuiltinSchemaBases,
) ReleaseService {
	return &releaseService{
		v2Pool:       v2Pool,
		schemas:      schemas,
		flows:        flows,
		branding:     branding,
		idps:         idps,
		apps:         apps,
		policies:     policies,
		builtinBases: builtinBases,
	}
}

// Create assembles a release from revisions that already exist.
//
// It is idempotent on the pinned set rather than on a caller-supplied key:
// metadata is excluded from the content hash, so re-submitting the same
// revisions under a new message resolves to the release that already pins
// them. That makes a re-run against unchanged content a no-op rather than a
// growing pile of identical releases.
func (s *releaseService) Create(ctx context.Context, input CreateReleaseInput) (_ *CreateReleaseOutput, err error) {
	ctx, end := startSpan(ctx, "ReleaseService.Create")
	defer end(&err)

	content, err := s.loadContent(ctx, input.ProjectID, input.Pointers)
	if err != nil {
		return nil, err
	}

	// NewRelease first: it rejects duplicate handles and unpinnable revisions
	// before ValidateRelease walks documents that may be incomplete for that case.
	entity, err := s.newReleaseEntity(ctx, input.ProjectID, content, releaseMetadataFromCreate(input))
	if err != nil {
		return nil, err
	}

	// Read before insert so the common re-deploy answers without burning an
	// id. The unique index on (project_id, content_hash) is what makes this
	// correct under concurrency; the read only spares the round trip.
	// A set already released answers with that release; validation is skipped.
	existing, err := s.getByContentHash(ctx, input.ProjectID, entity.ContentHash)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return &CreateReleaseOutput{Release: existing}, nil
	}
	if err := domain.ValidateRelease(content); err != nil {
		return nil, err
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		return insertRelease(ctx, tx.Statements(), entity)
	})
	if err != nil {
		if out, mapped, mapErr := s.mapReleasePersistError(ctx, input.ProjectID, entity.ContentHash, err); mapErr != nil {
			return nil, mapErr
		} else if mapped {
			return out, nil
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create release")
	}

	return &CreateReleaseOutput{Release: entity, Created: true}, nil
}

func releaseMetadataFromCreate(input CreateReleaseInput) domain.ReleaseMetadata {
	return domain.ReleaseMetadata{
		Message:  input.Message,
		GitSHA:   input.GitSHA,
		GitDirty: input.GitDirty,
	}
}

func (s *releaseService) newReleaseEntity(
	ctx context.Context,
	projectID string,
	content domain.ReleaseContent,
	meta domain.ReleaseMetadata,
) (*domain.Release, error) {
	actor, _ := audit.ActorFromContext(ctx)
	meta.CreatedBy = actor.ActorID
	meta.CreatedByType = actor.ActorType
	return domain.NewRelease(projectID, content, meta)
}

func insertRelease(ctx context.Context, stmts AllStatements, entity *domain.Release) error {
	if err := stmts.CreateRelease(ctx, entity); err != nil {
		return err
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeReleaseCreated,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "release",
		EntityID:   entity.ID,
		Payload:    domain.ReleasePayloadSnapshot(entity),
	})
}

// finalizeReleaseOn looks up entity by content hash on stmts and inserts when
// absent. Used inside Build's transaction so the hash check sees the same
// snapshot as the resource writes.
func finalizeReleaseOn(
	ctx context.Context,
	stmts AllStatements,
	entity *domain.Release,
) (*CreateReleaseOutput, error) {
	existing, err := stmts.GetReleaseByContentHash(ctx, entity.ProjectID, entity.ContentHash)
	if err == nil {
		return &CreateReleaseOutput{Release: existing}, nil
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
		return nil, domain.ErrInternal(err).WithMessage("failed to look up release by content hash")
	}
	if err := insertRelease(ctx, stmts, entity); err != nil {
		return nil, err
	}
	return &CreateReleaseOutput{Release: entity, Created: true}, nil
}

// mapReleasePersistError recovers a concurrent content-hash winner or a
// missing project. mapped is true when out is the answer for that race/FK.
func (s *releaseService) mapReleasePersistError(
	ctx context.Context,
	projectID, contentHash string,
	err error,
) (out *CreateReleaseOutput, mapped bool, mapErr error) {
	if _, ok := errors.AsType[*database.UniqueError](err); ok && contentHash != "" {
		raced, hashErr := s.getByContentHash(ctx, projectID, contentHash)
		if hashErr != nil {
			return nil, false, hashErr
		}
		if raced != nil {
			return &CreateReleaseOutput{Release: raced}, true, nil
		}
	}
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return nil, false, domain.ErrReleaseProjectNotFound().WithParent(err)
	}
	return nil, false, nil
}

func (s *releaseService) Get(ctx context.Context, projectID, id string) (_ *domain.Release, err error) {
	ctx, end := startSpan(ctx, "ReleaseService.Get")
	defer end(&err)

	return getRelease(ctx, s.v2Pool.Statements(), projectID, id)
}

func getRelease(ctx context.Context, stmts ReleaseStatements, projectID, id string) (*domain.Release, error) {
	entity, err := stmts.GetReleaseByID(ctx, projectID, id)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrReleaseNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get release from database")
	}
	return entity, nil
}

// Revoke marks the release revoked, once: a release already revoked comes
// back unchanged. A release an origin still serves is refused with the
// origins and the deployments that pin it.
func (s *releaseService) Revoke(ctx context.Context, projectID, id string) (_ *domain.Release, err error) {
	ctx, end := startSpan(ctx, "ReleaseService.Revoke")
	defer end(&err)

	var revoked *domain.Release
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		entity, err := getRelease(ctx, stmts, projectID, id)
		if err != nil {
			return err
		}
		if entity.Revoked() {
			revoked = entity
			return nil
		}
		// TODO(#2206): a concurrent deploy of this release can land after this check.
		served, err := servedOrigins(ctx, stmts, projectID, id, time.Now())
		if err != nil {
			return err
		}
		if len(served) > 0 {
			return domain.ErrReleaseInUse(domain.ReleaseInUseDetails{Origins: served})
		}
		revoked, err = stmts.RevokeRelease(ctx, projectID, id)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to revoke release")
		}
		return audit.Emit(ctx, stmts, audit.EmitSpec{
			Type:       domain.EventTypeReleaseRevoked,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  projectID,
			EntityType: "release",
			EntityID:   id,
			Payload:    domain.ReleaseRevokedPayload{ContentHash: revoked.ContentHash},
		})
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to revoke release")
	}
	return revoked, nil
}

// servedOrigins returns the origins still serving the release, each with the
// deployment that serves it.
func servedOrigins(ctx context.Context, stmts DeploymentStatements, projectID, releaseID string, now time.Time) ([]domain.ReleaseInUseOrigin, error) {
	result, err := stmts.ListLiveDeployments(WithAuthzListUnrestricted(ctx), now, deployment.LiveListOptions(projectID, &releaseID, 0))
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list the live deployments")
	}
	var served []domain.ReleaseInUseOrigin
	for _, live := range result.Items {
		for _, origin := range live.Origins() {
			served = append(served, domain.ReleaseInUseOrigin{Origin: origin, DeploymentID: live.ID})
		}
	}
	slices.SortFunc(served, func(a, b domain.ReleaseInUseOrigin) int { return strings.Compare(a.Origin, b.Origin) })
	return served, nil
}

func (s *releaseService) List(ctx context.Context, input ListReleasesInput) (_ *ListReleasesOutput, err error) {
	ctx, end := startSpan(ctx, "ReleaseService.List")
	defer end(&err)

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

// loadContent reads each requested revision from the project; its handle
// comes from the revision itself.
func (s *releaseService) loadContent(ctx context.Context, projectID string, requested []CreateReleasePointer) (domain.ReleaseContent, error) {
	stmts := s.v2Pool.Statements()
	var content domain.ReleaseContent
	for _, pointer := range requested {
		switch pointer.Kind {
		case domain.ReleasePointerKindSchema:
			schema, err := s.builtinBases.GetJSONSchema(ctx, stmts, projectID, pointer.RevisionID)
			if err != nil {
				return content, mapRevisionLookupError(err, pointer)
			}
			content.Schemas = append(content.Schemas, schema)

		case domain.ReleasePointerKindFlowDefinition:
			definition, err := stmts.GetFlowDefinitionByID(ctx, projectID, pointer.RevisionID)
			if err != nil {
				return content, mapRevisionLookupError(err, pointer)
			}
			content.FlowDefinitions = append(content.FlowDefinitions, definition)

		case domain.ReleasePointerKindIDP:
			connection, err := stmts.GetIDPConnectionRevision(ctx, projectID, pointer.RevisionID)
			if err != nil {
				return content, mapRevisionLookupError(err, pointer)
			}
			content.IDPConnections = append(content.IDPConnections, connection)

		case domain.ReleasePointerKindPolicy:
			revision, err := stmts.GetPolicyRevision(ctx, projectID, pointer.RevisionID)
			if err != nil {
				return content, mapRevisionLookupError(err, pointer)
			}
			content.Policies = append(content.Policies, revision)

		case domain.ReleasePointerKindBranding:
			branding, err := stmts.GetBrandingByID(ctx, projectID, pointer.RevisionID)
			if err != nil {
				return content, mapRevisionLookupError(err, pointer)
			}
			if content.Branding != nil {
				return content, domain.ErrReleaseInvalid(fmt.Sprintf("%s %q is referenced twice",
					domain.ReleasePointerKindBranding, domain.ReleaseBrandingHandle), nil)
			}
			content.Branding = branding

		default:
			// Unreachable over HTTP: the wire enum admits only the kinds above.
			return content, domain.ErrReleaseInvalid(fmt.Sprintf("unknown pointer kind %d", pointer.Kind), nil)
		}
	}
	return content, nil
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
