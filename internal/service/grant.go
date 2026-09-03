package service

import (
	"context"
	"errors"
	"fmt"
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

func (s *GrantService) Create(ctx context.Context, input CreateGrantInput) (*Grant, error) {
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
	return s.hydrateOne(ctx, created)
}

func (s *GrantService) Get(ctx context.Context, projectID, id string) (*Grant, error) {
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
	return s.hydrateOne(ctx, asgn)
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

const (
	grantFieldCreatedAt     = "created_at"
	grantFieldPrincipalType = "principal_type"
	grantFieldPrincipalID   = "principal_id"
	grantFieldRelation      = "relation"
	grantFieldExpiresAt     = "expires_at"
	grantFieldID            = "id"
)

// GrantPrincipal is the GET-user or GET-team body for expand: ["principal"].
// Both pointers nil means the principal was requested but could not be loaded.
type GrantPrincipal struct {
	User *domain.User
	Team *domain.Team
}

// Grant is an assignment plus the resolved principal label for the HTTP API.
// Principal is nil unless expand was requested; a non-nil Principal with both
// User and Team nil is the ADR 059 missing-principal case (wire null).
type Grant struct {
	Assignment *domain.AuthzAssignment
	User       *UserRef
	Team       *TeamRef
	Principal  *GrantPrincipal
}

func (g *Grant) attachUser(user *domain.User) {
	if user != nil {
		g.User = userRefFrom(user)
		if g.Principal != nil {
			g.Principal.User = user
		}
		return
	}
	g.User = &UserRef{UserID: g.Assignment.PrincipalID}
}

func (g *Grant) attachTeam(team *domain.Team) {
	if team != nil {
		g.Team = teamRefFrom(team)
		if g.Principal != nil {
			g.Principal.Team = team
		}
		return
	}
	g.Team = &TeamRef{TeamID: g.Assignment.PrincipalID}
}

// UserRef is the ADR 058 label for a user principal. Identifier/display are
// empty when the user cannot be loaded or carries no conventional identity
// attributes. #1090's designation resolver replaces this mapping when it lands.
type UserRef struct {
	UserID             string
	Identifier         string
	IdentifierProperty string
	Display            string
}

// TeamRef is the label for a team principal. Name is empty when the team
// cannot be loaded.
type TeamRef struct {
	TeamID string
	Name   string
}

// ListGrantsRequest is the input for listing the grants of a project.
type ListGrantsRequest struct {
	ProjectID        string
	Limit            int
	PageToken        string
	Sorting          *Sorting
	Filters          []Filter
	IncludePrincipal bool
}

// ListGrantsResponse is the output for listing grants.
type ListGrantsResponse struct {
	Grants        []*Grant
	NextPageToken string
}

// List returns unrevoked managed grants of a project, ordered and paginated
// with an opaque cursor. Principal refs are hydrated in one batch per page.
func (s *GrantService) List(ctx context.Context, req ListGrantsRequest) (*ListGrantsResponse, error) {
	if req.ProjectID == "" {
		return nil, domain.ErrGrantInvalid().WithDetails("project_id is required")
	}

	filters := make([]database.Filter[domain.AuthzAssignmentField], 0, len(req.Filters)+1)
	filters = append(filters, database.Equal(database.Col(domain.AuthzAssignmentFieldProjectID), req.ProjectID))
	for _, f := range req.Filters {
		filter, err := grantFilter(f)
		if err != nil {
			return nil, err
		}
		filters = append(filters, filter)
	}

	orderBy, err := listOrderBy(req.Sorting, domain.AuthzAssignmentFieldCreatedAt, database.OrderAsc, grantField, domain.AuthzAssignmentFieldID)
	if err != nil {
		return nil, err
	}

	var cursor []byte
	if req.PageToken != "" {
		cursor = []byte(req.PageToken)
	}

	result, err := s.v2Pool.Statements().ListManagedGrants(ctx, &database.ListOptions[domain.AuthzAssignmentField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.AuthzAssignmentField]{
			Limit:   uint32(normalizeLimit(req.Limit)),
			OrderBy: orderBy,
			Cursor:  cursor,
		},
	})
	if err != nil {
		return nil, mapListError(err, "failed to list grants")
	}

	grants, err := s.hydrate(ctx, req.IncludePrincipal, result.Items...)
	if err != nil {
		return nil, err
	}
	return &ListGrantsResponse{
		Grants:        grants,
		NextPageToken: string(result.NextCursor),
	}, nil
}

func (s *GrantService) hydrateOne(ctx context.Context, asgn *domain.AuthzAssignment) (*Grant, error) {
	grants, err := s.hydrate(ctx, false, asgn)
	if err != nil {
		return nil, err
	}
	return grants[0], nil
}

func (s *GrantService) hydrate(ctx context.Context, includePrincipal bool, asgns ...*domain.AuthzAssignment) ([]*Grant, error) {
	out := make([]*Grant, 0, len(asgns))
	for _, a := range asgns {
		g := &Grant{Assignment: a}
		if includePrincipal {
			g.Principal = &GrantPrincipal{}
		}
		out = append(out, g)
	}
	if len(out) == 0 {
		return out, nil
	}

	userIDs, teamIDs := principalIDs(asgns)
	home := s.platformProjectID
	if home == "" {
		home = asgns[0].ProjectID
	}

	ctx = WithAuthzListUnrestricted(ctx)
	attrKeys := domain.IdentityAttributeKeys
	if includePrincipal {
		attrKeys = nil
	}
	users, err := s.loadUsers(ctx, home, userIDs, attrKeys)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to resolve grant user refs")
	}
	teams, err := s.loadTeams(ctx, home, teamIDs)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to resolve grant team refs")
	}

	for _, g := range out {
		switch g.Assignment.PrincipalType {
		case domain.AuthzPrincipalTypeUser:
			g.attachUser(users[g.Assignment.PrincipalID])
		case domain.AuthzPrincipalTypeTeam:
			g.attachTeam(teams[g.Assignment.PrincipalID])
		}
	}
	return out, nil
}

func principalIDs(asgns []*domain.AuthzAssignment) (userIDs, teamIDs []string) {
	seenUsers := map[string]struct{}{}
	seenTeams := map[string]struct{}{}
	for _, a := range asgns {
		switch a.PrincipalType {
		case domain.AuthzPrincipalTypeUser:
			if _, ok := seenUsers[a.PrincipalID]; ok {
				continue
			}
			seenUsers[a.PrincipalID] = struct{}{}
			userIDs = append(userIDs, a.PrincipalID)
		case domain.AuthzPrincipalTypeTeam:
			if _, ok := seenTeams[a.PrincipalID]; ok {
				continue
			}
			seenTeams[a.PrincipalID] = struct{}{}
			teamIDs = append(teamIDs, a.PrincipalID)
		}
	}
	return userIDs, teamIDs
}

func (s *GrantService) loadUsers(ctx context.Context, projectID string, userIDs []string, attributeKeys []string) (map[string]*domain.User, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	listed, err := s.v2Pool.Statements().ListUsers(ctx, &database.ListOptions[domain.UserField]{
		Filter: database.And(
			database.Equal(database.Col(domain.UserFieldProjectID), projectID),
			database.Or(equalIDFilters(domain.UserFieldID, userIDs)...),
		),
		Pagination: database.Page[domain.UserField]{
			Limit: uint32(len(userIDs)),
			OrderBy: database.OrderBy[domain.UserField]{
				Columns:   []database.Column[domain.UserField]{database.Col(domain.UserFieldID)},
				Direction: database.OrderAsc,
			},
		},
	}, UserQueryOptions{AttributeKeys: attributeKeys})
	if err != nil {
		return nil, err
	}
	return indexByID(listed.Items, func(u *domain.User) string { return u.ID }), nil
}

func userRefFrom(user *domain.User) *UserRef {
	ref := &UserRef{UserID: user.ID, Display: user.DisplayName()}
	if email := user.Email(); email != "" {
		ref.Identifier = email
		ref.IdentifierProperty = "email"
	}
	return ref
}

func (s *GrantService) loadTeams(ctx context.Context, projectID string, teamIDs []string) (map[string]*domain.Team, error) {
	if len(teamIDs) == 0 {
		return nil, nil
	}
	listed, err := s.v2Pool.Statements().ListTeams(ctx, &database.ListOptions[domain.TeamField]{
		Filter: database.And(
			database.Equal(database.Col(domain.TeamFieldProjectID), projectID),
			database.Or(equalIDFilters(domain.TeamFieldID, teamIDs)...),
		),
		Pagination: database.Page[domain.TeamField]{
			Limit: uint32(len(teamIDs)),
			OrderBy: database.OrderBy[domain.TeamField]{
				Columns:   []database.Column[domain.TeamField]{database.Col(domain.TeamFieldID)},
				Direction: database.OrderAsc,
			},
		},
	})
	if err != nil {
		return nil, err
	}
	return indexByID(listed.Items, func(t *domain.Team) string { return t.ID }), nil
}

func equalIDFilters[F ~uint8](field F, ids []string) []database.Filter[F] {
	filters := make([]database.Filter[F], 0, len(ids))
	for _, id := range ids {
		filters = append(filters, database.Equal(database.Col(field), id))
	}
	return filters
}

func indexByID[T any](items []*T, id func(*T) string) map[string]*T {
	out := make(map[string]*T, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		if key := id(item); key != "" {
			out[key] = item
		}
	}
	return out
}

func teamRefFrom(team *domain.Team) *TeamRef {
	return &TeamRef{TeamID: team.ID, Name: team.Name}
}

func grantFilter(f Filter) (database.Filter[domain.AuthzAssignmentField], error) {
	switch f.Field {
	case grantFieldCreatedAt:
		return createdAtFilter(f.Operation, database.Col(domain.AuthzAssignmentFieldCreatedAt), f.Value)
	case grantFieldExpiresAt:
		return expiresAtFilter(f)
	case grantFieldPrincipalType:
		value, err := stringFilterValue(f)
		if err != nil {
			return nil, err
		}
		switch value {
		case domain.AuthzPrincipalTypeUser.String(), domain.AuthzPrincipalTypeTeam.String():
		default:
			return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown principal_type %q", value))
		}
		return stringEqualsFilter(f.Operation, database.Col(domain.AuthzAssignmentFieldPrincipalType), value)
	case grantFieldPrincipalID:
		value, err := stringFilterValue(f)
		if err != nil {
			return nil, err
		}
		return stringFilter(f.Operation, database.Col(domain.AuthzAssignmentFieldPrincipalID), value)
	case grantFieldRelation:
		value, err := stringFilterValue(f)
		if err != nil {
			return nil, err
		}
		if _, ok := allowedGrantRelations[value]; !ok {
			return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown relation %q", value))
		}
		return stringEqualsFilter(f.Operation, database.Col(domain.AuthzAssignmentFieldRelation), value)
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", f.Field))
	}
}

func expiresAtFilter(f Filter) (database.Filter[domain.AuthzAssignmentField], error) {
	if f.Value == nil {
		switch f.Operation {
		case filterOpEquals:
			return database.Equal(database.Col(domain.AuthzAssignmentFieldExpiresAt), nil), nil
		default:
			return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("operation %q is not valid for a null expires_at", f.Operation))
		}
	}
	return createdAtFilter(f.Operation, database.Col(domain.AuthzAssignmentFieldExpiresAt), f.Value)
}

func stringEqualsFilter[F ~uint8](op string, col database.Column[F], value string) (database.Filter[F], error) {
	switch op {
	case filterOpEquals:
		return database.StringEqual(col, value), nil
	case filterOpNotEquals, filterOpContains, filterOpNotContains:
		return nil, domain.ErrNotImplemented().WithDetails(fmt.Sprintf("operation %q is not supported", op))
	case filterOpLessThan, filterOpGreaterThan, filterOpLessThanOrEqual, filterOpGreaterThanOrEqual:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("operation %q is not valid for this field", op))
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown operation %q", op))
	}
}

func grantField(field string) (domain.AuthzAssignmentField, error) {
	switch field {
	case grantFieldCreatedAt:
		return domain.AuthzAssignmentFieldCreatedAt, nil
	case grantFieldExpiresAt:
		return domain.AuthzAssignmentFieldExpiresAt, nil
	case grantFieldID:
		return domain.AuthzAssignmentFieldID, nil
	default:
		return domain.AuthzAssignmentFieldUnspecified, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", field))
	}
}

func emitAuthzRevoked(ctx context.Context, stmts EventStatements, a *domain.AuthzAssignment) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeAuthzRevoked,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  a.ProjectID,
		EntityType: "authz_assignment",
		EntityID:   a.ID,
		Payload: domain.AuthzRevokedPayload{
			PrincipalType: a.PrincipalType.String(),
			PrincipalID:   a.PrincipalID,
			Relation:      a.Relation,
		},
	})
}
