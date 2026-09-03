package service

import (
	"context"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

var allowedGrantRelations = map[string]struct{}{
	"viewer": {},
	"editor": {},
	"admin":  {},
}

// isManagedGrant is the class this HTTP API may Get or Revoke: principal type
// user or team, object_type project, and relation in {viewer, editor, admin}.
// Create already writes that triple. Other authz_assignments rows (project-secret
// setup, owning-team / claim, and future non-project catalog bindings) live in
// the same table and must 404 here so a project secret cannot self-lockout,
// transfer ownership, or revoke an assignment this API would mislabel as project.
func isManagedGrant(a *domain.AuthzAssignment) bool {
	switch a.PrincipalType {
	case domain.AuthzPrincipalTypeUser, domain.AuthzPrincipalTypeTeam:
		if a.ObjectType != "project" {
			return false
		}
		_, ok := allowedGrantRelations[a.Relation]
		return ok
	default:
		return false
	}
}

type GrantService struct {
	v2Pool            *DB
	platformProjectID string
}

func NewGrantService(v2Pool *DB, platformProjectID string) *GrantService {
	return &GrantService{
		v2Pool:            v2Pool,
		platformProjectID: platformProjectID,
	}
}

type CreateGrantInput struct {
	ProjectID     string
	PrincipalType domain.AuthzPrincipalType
	PrincipalID   string
	Relation      string
	ExpiresAt     *time.Time
}

func (s *GrantService) Create(ctx context.Context, input CreateGrantInput) (*domain.AuthzAssignment, error) {
	if err := validateCreateGrant(input); err != nil {
		return nil, err
	}

	var created *domain.AuthzAssignment
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		home, err := s.resolvePrincipalHome(ctx, tx.Statements(), input.PrincipalType, input.PrincipalID)
		if err != nil {
			return err
		}
		if err := s.loadPrincipal(ctx, tx.Statements(), home, input.PrincipalType, input.PrincipalID); err != nil {
			return err
		}

		asgn := &domain.AuthzAssignment{
			ProjectID:     input.ProjectID,
			CatalogID:     domain.SystemCatalogID,
			PrincipalType: input.PrincipalType,
			PrincipalID:   input.PrincipalID,
			ObjectType:    "project",
			Relation:      input.Relation,
			ExpiresAt:     input.ExpiresAt,
		}
		asgn.ApplyScope(domain.NewProjectAssignmentScope())
		if err := tx.Statements().CreateAuthzAssignment(ctx, asgn); err != nil {
			return err
		}
		if err := emitAuthzGranted(ctx, tx.Statements(), asgn); err != nil {
			return err
		}
		created = asgn
		return nil
	})
	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return nil, domain.ErrGrantAlreadyExists().WithParent(err)
		}
		if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
			return nil, domain.ErrGrantInvalid().WithParent(err)
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create grant")
	}
	return created, nil
}

func (s *GrantService) Get(ctx context.Context, projectID, id string) (*domain.AuthzAssignment, error) {
	asgn, err := s.v2Pool.Statements().GetAuthzAssignment(ctx, projectID, id)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrGrantNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get grant")
	}
	if asgn.RevokedAt != nil || !isManagedGrant(asgn) {
		return nil, domain.ErrGrantNotFound()
	}
	return asgn, nil
}

func (s *GrantService) Revoke(ctx context.Context, projectID, id string) error {
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		asgn, err := tx.Statements().GetAuthzAssignment(ctx, projectID, id)
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrGrantNotFound()
			}
			return err
		}
		if asgn.RevokedAt != nil || !isManagedGrant(asgn) {
			return domain.ErrGrantNotFound()
		}
		if err := tx.Statements().RevokeAuthzAssignment(ctx, projectID, id); err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrGrantNotFound()
			}
			return err
		}
		return emitAuthzRevoked(ctx, tx.Statements(), asgn)
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return de
		}
		return domain.ErrInternal(err).WithMessage("failed to revoke grant")
	}
	return nil
}

func validateCreateGrant(input CreateGrantInput) error {
	switch input.PrincipalType {
	case domain.AuthzPrincipalTypeUser:
		if !domain.PrefixUser.Matches(input.PrincipalID) {
			return domain.ErrGrantInvalid().WithDetails("principal_id must use the user_ prefix")
		}
	case domain.AuthzPrincipalTypeTeam:
		if !domain.PrefixTeam.Matches(input.PrincipalID) {
			return domain.ErrGrantInvalid().WithDetails("principal_id must use the team_ prefix")
		}
	default:
		return domain.ErrGrantInvalid().WithDetails("principal_type must be user or team")
	}
	if _, ok := allowedGrantRelations[input.Relation]; !ok {
		return domain.ErrGrantInvalid().WithDetails("relation must be viewer, editor, or admin")
	}
	if input.ExpiresAt != nil && !input.ExpiresAt.After(time.Now()) {
		return domain.ErrGrantInvalid().WithDetails("expires_at must be in the future")
	}
	return nil
}

func (s *GrantService) resolvePrincipalHome(ctx context.Context, stmts AllStatements, principalType domain.AuthzPrincipalType, principalID string) (string, error) {
	scope, err := stmts.GetResourceScope(ctx, principalID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return "", domain.ErrGrantPrincipalNotFound()
		}
		return "", err
	}
	wantKind := domain.ResourceKindUser
	if principalType == domain.AuthzPrincipalTypeTeam {
		wantKind = domain.ResourceKindTeam
	}
	if scope.ResourceKind != wantKind {
		return "", domain.ErrGrantPrincipalNotFound()
	}
	// When no platform project is pinned (bootstrap / single-project), any
	// homed principal may be bound; this matches claim. When pinned, home
	// must be that project.
	if s.platformProjectID != "" && scope.ProjectID != s.platformProjectID {
		return "", domain.ErrGrantPrincipalNotFound()
	}
	return scope.ProjectID, nil
}

func (s *GrantService) loadPrincipal(ctx context.Context, stmts AllStatements, homeProjectID string, principalType domain.AuthzPrincipalType, principalID string) error {
	switch principalType {
	case domain.AuthzPrincipalTypeUser:
		_, err := stmts.GetUser(ctx, database.And(
			database.Equal(database.Col(domain.UserFieldProjectID), homeProjectID),
			database.Equal(database.Col(domain.UserFieldID), principalID),
			database.Equal(database.Col(domain.UserFieldStatus), domain.UserStatusActive.String()),
		), UserQueryOptions{})
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrGrantPrincipalNotFound()
			}
			return err
		}
		return nil
	case domain.AuthzPrincipalTypeTeam:
		_, err := stmts.GetTeam(ctx, database.And(
			database.Equal(database.Col(domain.TeamFieldProjectID), homeProjectID),
			database.Equal(database.Col(domain.TeamFieldID), principalID),
			database.Equal(database.Col(domain.TeamFieldStatus), domain.TeamStatusActive.String()),
		))
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrGrantPrincipalNotFound()
			}
			return err
		}
		return nil
	default:
		return domain.ErrGrantInvalid()
	}
}

func emitAuthzRevoked(ctx context.Context, stmts EventStatements, a *domain.AuthzAssignment) error {
	return audit.Emit(ctx, stmts, authzAssignmentEmitSpec(ctx, domain.EventTypeAuthzRevoked, a, domain.AuthzRevokedPayload{
		PrincipalType: a.PrincipalType.String(),
		PrincipalID:   a.PrincipalID,
		Relation:      a.Relation,
	}))
}

// authzAssignmentEmitSpec stamps grant events on the protected project
// (ADR 053 §8). Actor home may differ; team_id stays empty for project-scoped
// grants; foreign humans get actor_home_project_id in authorization metadata.
func authzAssignmentEmitSpec(ctx context.Context, typ domain.EventType, a *domain.AuthzAssignment, payload any) audit.EmitSpec {
	spec := audit.EmitSpec{
		Type:           typ,
		Category:       domain.EventCategoryAdmin,
		ProjectID:      a.ProjectID,
		EntityType:     "authz_assignment",
		EntityID:       a.ID,
		Payload:        payload,
		ForceProjectID: true,
		ClearTeamID:    true,
	}
	if ac, ok := audit.ActorFromContext(ctx); ok && ac.ProjectID != "" && ac.ProjectID != a.ProjectID {
		spec.Metadata = &domain.EventMetadata{
			Authorization: &domain.EventAuthorizationMetadata{
				ActorHomeProjectID: ac.ProjectID,
			},
		}
	}
	return spec
}
