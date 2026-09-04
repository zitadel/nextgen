package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	userFieldCreatedAt            = "created_at"
	userFieldID                   = "id"
	userFieldSchema               = "schema"
	userFieldStatus               = "status"
	userFieldTeamID               = "team_id"
	userFieldLifecycleOwnerTeamID = "lifecycle_owner_team_id"
)

// ---- Input types -------------------------------------------------------------

type CreateUserInput struct {
	ProjectID string
	TeamID    *string
	// SchemaURL names the schema Attributes is validated against.
	SchemaURL string
	// Attributes is the schema-defined content only, without envelope fields.
	Attributes map[string]any
	ID         string
}

type UserAction interface {
	Prepare(ctx context.Context) error
	Apply(ctx context.Context, stmts AllStatements) error
}

type SetPasswordInput struct {
	ProjectID                string
	UserID                   string
	Password                 string
	IsPasswordChangeRequired bool
}

type GetUserInput struct {
	ProjectID string
	TeamID    *string
	UserID    string
}

type ListUsersInput struct {
	ProjectID string
	PageToken string
	Limit     int
	Sorting   *Sorting // optional; defaults to createdAt desc
	Filters   []Filter
	// IncludeTeams embeds each user's team memberships (ADR 059).
	IncludeTeams bool
	// IncludeLifecycleOwnerTeam embeds the team that owns each user's
	// lifecycle (ADR 059).
	IncludeLifecycleOwnerTeam bool
}

type ListPasskeysInput struct {
	ProjectID string
	UserID    string
	PageToken string
	Limit     int
}

type ListUserTeamsInput struct {
	ProjectID string
	UserID    string
	PageToken string
	Limit     int
}

type GetMyUserInput struct {
	// SessionToken is the parsed session token, already verified at the API
	// security boundary.
	SessionToken *domain.Token
}

type DeleteUserInput struct {
	ProjectID string
	UserID    string
}

type ListUsersOutput struct {
	Items         []*domain.User
	NextPageToken string
}

type ListUserTeamsOutput struct {
	Items         []*domain.UserTeam
	NextPageToken string
}

// ---- Interface -------------------------------------------------------------

type UserService interface {
	ApplyActions(ctx context.Context, actions ...UserAction) (err error)
	CreateUser(ctx context.Context, input CreateUserInput) (*domain.User, error)
	DeleteUser(ctx context.Context, input DeleteUserInput) error
	ListUsers(ctx context.Context, input ListUsersInput) (*ListUsersOutput, error)
	ListPasskeys(ctx context.Context, input ListPasskeysInput) (passkeys []*domain.UserPasskey, nextPage string, err error)
	ListUserTeams(ctx context.Context, input ListUserTeamsInput) (*ListUserTeamsOutput, error)
	GetUserByID(ctx context.Context, input GetUserInput) (*domain.User, error)
	SetPassword(ctx context.Context, input SetPasswordInput) (err error)
	GetMyUser(ctx context.Context, input GetMyUserInput) (*domain.User, error)
}

// ---- Implementation -------------------------------------------------------------

type userService struct {
	v2Pool      StatementPool
	schemaStore domain.JSONSchemaStore
	hasher      crypto.Hasher
	refs        UserRefResolver
}

// NewUserService returns the interface rather than *userService, deliberately
// against "accept interfaces, return structs". The OpenAPI error generator
// reflects the API handler's fields to find which services an operation calls,
// and only an interface-typed field gives it something to key on — a handler
// holding *userService drops this service out of the reflected floor that
// backstops the call-graph walk.
func NewUserService(
	v2Pool StatementPool,
	schemaStore domain.JSONSchemaStore,
	hasher crypto.Hasher,
	refs UserRefResolver,
) UserService {
	return &userService{
		v2Pool:      v2Pool,
		schemaStore: schemaStore,
		hasher:      hasher,
		refs:        refs,
	}
}

func (s *userService) ApplyActions(ctx context.Context, actions ...UserAction) (err error) {
	for _, action := range actions {
		err = action.Prepare(ctx)
		if err != nil {
			return err
		}
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		for _, action := range actions {
			if err := action.Apply(ctx, tx.Statements()); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return de
		}
		return domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}
	return nil
}

func (s *userService) emitUserCreateFailedBestEffort(ctx context.Context, action *CreateUserAction, applyErr error) {
	var unique *database.UniqueError
	if !errors.As(applyErr, &unique) {
		return
	}
	if action == nil || action.CreateUser == nil {
		return
	}
	_ = audit.Emit(ctx, s.v2Pool.Statements(), audit.EmitSpec{
		Type:       domain.EventTypeUserCreateFailed,
		Category:   domain.EventCategoryEntity,
		ProjectID:  action.ProjectID,
		EntityType: "user",
		Payload:    domain.UserCreateFailedPayload{KeyName: unique.Constraint()},
	})
}

func (s *userService) CreateUser(ctx context.Context, input CreateUserInput) (_ *domain.User, err error) {
	action := NewCreateUserAction(input, s.schemaStore)
	if err := s.ApplyActions(ctx, action); err != nil {
		s.emitUserCreateFailedBestEffort(ctx, action, err)
		return nil, err
	}

	// The insert does not report the row's timestamps or status.
	// TODO(vitorbari): have the insert return the row so create needs no read-back.
	user, err := s.v2Pool.Statements().GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), input.ProjectID),
		database.Equal(database.Col(domain.UserFieldID), action.CreateUser.ID),
	), UserQueryOptions{})
	if err != nil {
		return nil, domain.ErrInternal(err).
			WithMessage("The user was created but could not be read back. Fetch it by id rather than retrying the create.").
			WithDetails(domain.CreatedUserDetails{UserID: action.CreateUser.ID})
	}
	// The identity ref is derived decoration and the create has already
	// committed: a resolution failure must not fail the create — the caller
	// would retry and hit the unique constraints — so the response simply
	// carries no ref fields and clients fall back to the id (ADR 058).
	if refs, err := s.refs.ResolveRefsForUsers(ctx, input.ProjectID, []*domain.User{user}); err == nil {
		if ref, ok := refs[user.ID]; ok {
			user.Ref = &ref
		}
	}

	return user, nil
}

// attachUserRefs resolves the derived identity (ADR 058 §3a) onto each
// user's Ref — one batch per page, per §4.
func (s *userService) attachUserRefs(ctx context.Context, projectID string, users ...*domain.User) error {
	refs, err := s.refs.ResolveRefsForUsers(ctx, projectID, users)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to resolve user identities")
	}
	for _, user := range users {
		if ref, ok := refs[user.ID]; ok {
			user.Ref = &ref
		}
	}
	return nil
}

func (s *userService) DeleteUser(ctx context.Context, input DeleteUserInput) error {
	action := NewDeleteUserAction(input)
	return s.ApplyActions(ctx, action)
}

func (s *userService) ListUsers(ctx context.Context, input ListUsersInput) (*ListUsersOutput, error) {
	columnFilters, queryOpts, err := splitUserFilters(input.Filters)
	if err != nil {
		return nil, err
	}
	queryOpts.IncludeTeams = input.IncludeTeams
	queryOpts.IncludeLifecycleOwnerTeam = input.IncludeLifecycleOwnerTeam

	filters := make([]database.Filter[domain.UserField], 0, len(columnFilters)+1)
	filters = append(filters, database.Equal(database.Col(domain.UserFieldProjectID), input.ProjectID))
	for _, f := range columnFilters {
		filter, err := userFilter(f)
		if err != nil {
			return nil, err
		}
		filters = append(filters, filter)
	}

	// Newest-first by default, unlike the ascending default the other list
	// services use: the users list is read as "who signed up recently".
	orderBy, err := listOrderBy(input.Sorting, domain.UserFieldCreatedAt, database.OrderDesc, userField, domain.UserFieldID)
	if err != nil {
		return nil, err
	}

	result, err := s.v2Pool.Statements().ListUsers(ctx, &database.ListOptions[domain.UserField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.UserField]{
			Limit:   uint32(normalizeLimit(input.Limit)),
			Cursor:  []byte(input.PageToken),
			OrderBy: orderBy,
		},
	}, queryOpts)
	if err != nil {
		return nil, mapListError(err, "failed to list users from database")
	}
	if err := s.attachUserRefs(ctx, input.ProjectID, result.Items...); err != nil {
		return nil, err
	}

	return &ListUsersOutput{
		Items:         result.Items,
		NextPageToken: string(result.NextCursor),
	}, nil
}

// splitUserFilters separates the predicates that compile to a filter on the
// users row from the one that does not. Team membership lives in another
// table and reaches the query as [UserQueryOptions.MembershipTeamID], which
// the dialects compile to an EXISTS clause — the same shape
// [UserQueryOptions.Attributes] already uses for the EAV match.
func splitUserFilters(filters []Filter) ([]Filter, UserQueryOptions, error) {
	var (
		columns []Filter
		opts    UserQueryOptions
	)
	for _, f := range filters {
		if f.Field != userFieldTeamID {
			columns = append(columns, f)
			continue
		}
		// The storage option holds one team and ADR 031 ANDs filters, so a
		// second value would silently win over the first. Refuse instead.
		if opts.MembershipTeamID != nil {
			return nil, UserQueryOptions{}, domain.ErrRequestInvalid().
				WithDetails(fmt.Sprintf("%s may only be given once", userFieldTeamID))
		}
		if f.Operation != filterOpEquals {
			return nil, UserQueryOptions{}, domain.ErrRequestInvalid().
				WithDetails(fmt.Sprintf("operation %q is not valid for %s", f.Operation, userFieldTeamID))
		}
		teamID, err := stringFilterValue(f)
		if err != nil {
			return nil, UserQueryOptions{}, err
		}
		opts.MembershipTeamID = &teamID
	}
	return columns, opts, nil
}

// userFilter maps an API filter predicate to a storage filter. Operations the
// v2 filter layer cannot express return [domain.ErrNotImplemented];
// invalid field/operation/value combinations return [domain.ErrRequestInvalid].
// [splitUserFilters] has already taken team_id out.
func userFilter(f Filter) (database.Filter[domain.UserField], error) {
	switch f.Field {
	case userFieldCreatedAt:
		return createdAtFilter(f.Operation, database.Col(domain.UserFieldCreatedAt), f.Value)
	case userFieldID:
		value, err := stringFilterValue(f)
		if err != nil {
			return nil, err
		}
		return stringFilter(f.Operation, database.Col(domain.UserFieldID), value)
	case userFieldSchema:
		value, err := stringFilterValue(f)
		if err != nil {
			return nil, err
		}
		return stringFilter(f.Operation, database.Col(domain.UserFieldSchemaURL), value)
	case userFieldStatus:
		value, err := stringFilterValue(f)
		if err != nil {
			return nil, err
		}
		return userStatusFilter(f.Operation, value)
	case userFieldLifecycleOwnerTeamID:
		// The column is null for self-owned users. `= NULL` matches nothing in
		// SQL, so a null value would quietly return an empty page; reject it
		// instead. Selecting self-owned users needs an is-null filter the
		// storage layer does not have yet.
		value, err := stringFilterValue(f)
		if err != nil {
			return nil, err
		}
		return stringFilter(f.Operation, database.Col(domain.UserFieldLifecycleOwnerTeamID), value)
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", f.Field))
	}
}

// userStatusFilter filters on the user's lifecycle status.
func userStatusFilter(op, status string) (database.Filter[domain.UserField], error) {
	switch op {
	case filterOpEquals:
	case filterOpNotEquals:
		// todo: update when the operation is supported
		return nil, domain.ErrNotImplemented().WithDetails(fmt.Sprintf("operation %q is not supported", op))
	case filterOpContains, filterOpNotContains, filterOpLessThan, filterOpGreaterThan, filterOpLessThanOrEqual, filterOpGreaterThanOrEqual:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("operation %q is not valid for this field", op))
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown operation %q", op))
	}

	switch domain.UserStatus(status) {
	case domain.UserStatusActive, domain.UserStatusSuspended, domain.UserStatusDeactivated, domain.UserStatusPendingPurge:
		return database.Equal(database.Col(domain.UserFieldStatus), status), nil
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown status %q", status))
	}
}

// userField maps an API field name to its [domain.UserField] for sorting.
func userField(field string) (domain.UserField, error) {
	switch field {
	case userFieldCreatedAt:
		return domain.UserFieldCreatedAt, nil
	case userFieldID:
		return domain.UserFieldID, nil
	case userFieldSchema:
		return domain.UserFieldSchemaURL, nil
	case userFieldStatus:
		return domain.UserFieldStatus, nil
	case userFieldLifecycleOwnerTeamID:
		return domain.UserFieldLifecycleOwnerTeamID, nil
	case userFieldTeamID:
		// Not a column on the user: the keyset cursor is built from the last
		// row's sort values, and there is no membership value on that row.
		return domain.UserFieldUnspecified, domain.ErrRequestInvalid().
			WithDetails(fmt.Sprintf("%s can be filtered but not sorted", userFieldTeamID))
	default:
		return domain.UserFieldUnspecified, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", field))
	}
}

func (s *userService) ListPasskeys(ctx context.Context, input ListPasskeysInput) (passkeys []*domain.UserPasskey, nextPage string, err error) {
	dbpasskeys, err := s.v2Pool.Statements().ListUserPasskeys(
		ctx, &database.ListOptions[domain.UserPasskeyField]{
			Filter: database.And(
				database.Equal(database.Col(domain.UserPasskeyFieldProjectID), input.ProjectID),
				database.Equal(database.Col(domain.UserPasskeyFieldUserID), input.UserID),
			),
			Pagination: database.Page[domain.UserPasskeyField]{
				Limit:  uint32(normalizeLimit(input.Limit)),
				Cursor: []byte(input.PageToken),
				OrderBy: database.OrderBy[domain.UserPasskeyField]{
					Columns: []database.Column[domain.UserPasskeyField]{
						database.Col(domain.UserPasskeyFieldCreatedAt),
					},
					Direction: database.OrderDesc,
				},
			},
		},
	)
	if err != nil {
		return nil, "", domain.ErrInternal(err).WithMessage("failed to get user passkeys from database")
	}

	// Distinguish "user not found" from "user has no passkeys".
	if len(dbpasskeys.Items) == 0 {
		exists, err := s.v2Pool.Statements().UserExists(ctx, input.ProjectID, input.UserID)
		if err != nil {
			return nil, "", domain.ErrInternal(err).WithMessage("failed to get user from database")
		}
		if !exists {
			return nil, "", domain.ErrUserNotFound()
		}
	}

	return dbpasskeys.Items, string(dbpasskeys.NextCursor), nil
}

// ListUserTeams serves the user's team roster one page at a time, each entry
// carrying the team's name. Removed memberships are history and stay out.
//
// The roster is not lifecycle ownership (ADR 024): a user can sit on several
// rosters while owning their own lifecycle, which is reported on the user
// itself.
func (s *userService) ListUserTeams(ctx context.Context, input ListUserTeamsInput) (*ListUserTeamsOutput, error) {
	onRoster := make([]database.Filter[domain.UserTeamField], 0, len(domain.RosterMembershipStatuses))
	for _, status := range domain.RosterMembershipStatuses {
		onRoster = append(onRoster, database.Equal(database.Col(domain.UserTeamFieldStatus), status.String()))
	}

	teams, err := s.v2Pool.Statements().ListUserTeams(ctx, &database.ListOptions[domain.UserTeamField]{
		Filter: database.And(
			database.Equal(database.Col(domain.UserTeamFieldProjectID), input.ProjectID),
			database.Equal(database.Col(domain.UserTeamFieldUserID), input.UserID),
			database.Or(onRoster...),
		),
		Pagination: database.Page[domain.UserTeamField]{
			Limit:  uint32(normalizeLimit(input.Limit)),
			Cursor: []byte(input.PageToken),
			OrderBy: database.OrderBy[domain.UserTeamField]{
				Columns: []database.Column[domain.UserTeamField]{
					database.Col(domain.UserTeamFieldTeamName),
					database.Col(domain.UserTeamFieldTeamID),
				},
				Direction: database.OrderAsc,
			},
		},
	})
	if err != nil {
		return nil, mapListError(err, "failed to list user teams from database")
	}

	if len(teams.Items) == 0 {
		exists, err := s.v2Pool.Statements().UserExists(ctx, input.ProjectID, input.UserID)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to get user from database")
		}
		if !exists {
			return nil, domain.ErrUserNotFound()
		}
	}

	return &ListUserTeamsOutput{
		Items:         teams.Items,
		NextPageToken: string(teams.NextCursor),
	}, nil
}

func (s *userService) GetUserByID(ctx context.Context, input GetUserInput) (*domain.User, error) {
	user, err := s.v2Pool.Statements().GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), input.ProjectID),
		database.Equal(database.Col(domain.UserFieldID), input.UserID),
	), UserQueryOptions{MembershipTeamID: input.TeamID})
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrUserNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get user from database")
	}
	if err := s.attachUserRefs(ctx, input.ProjectID, user); err != nil {
		return nil, err
	}

	return user, nil
}

func (s *userService) SetPassword(ctx context.Context, input SetPasswordInput) (err error) {
	action := NewSetUserPasswordAction(input, s.hasher)
	return s.ApplyActions(ctx, action)
}

func (s *userService) GetMyUser(ctx context.Context, input GetMyUserInput) (*domain.User, error) {
	sessionToken := input.SessionToken
	if sessionToken == nil {
		return nil, domain.ErrSessionTokenInvalid()
	}
	if sessionToken.ExpiresAt != nil && time.Now().After(*sessionToken.ExpiresAt) {
		return nil, domain.ErrSessionTokenInvalid()
	}

	user, err := s.v2Pool.Statements().GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), sessionToken.ProjectID),
		database.Equal(database.Col(domain.UserFieldID), sessionToken.UserID),
	), UserQueryOptions{})
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrUserNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get user from database")
	}
	if err := s.attachUserRefs(ctx, sessionToken.ProjectID, user); err != nil {
		return nil, err
	}

	return user, nil
}

// ---- Create User ACTION -------------------------------------------------------------

type CreateUserAction struct {
	CreateUserInput

	schemaStore domain.JSONSchemaStore

	CreateUser *domain.CreateUser
	// schemaJSON is the user schema document used at create time for x-audit value filtering.
	schemaJSON []byte
}

func NewCreateUserAction(input CreateUserInput, schemaStore domain.JSONSchemaStore) *CreateUserAction {
	return &CreateUserAction{
		CreateUserInput: input,
		schemaStore:     schemaStore,
	}
}

func (o *CreateUserAction) Prepare(ctx context.Context) error {
	// Ahead of the lookup, which would otherwise report an empty schema as one
	// the project does not have.
	if o.SchemaURL == "" {
		return domain.ErrUserInvalid().
			WithMessage("No schema provided. A user must name the schema its attributes are validated against.")
	}

	schemaEntity, err := o.schemaStore.GetJSONSchemaByID(ctx, o.ProjectID, o.SchemaURL)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return domain.ErrUserInvalid().
				WithMessage("schema is not known to the system. First create a schema, then create users.").
				WithDetails(domain.UserSchemaUnknownDetails{Schema: o.SchemaURL})
		}
		return domain.ErrInternal(err).WithMessage("failed to get schema from database")
	}

	o.schemaJSON = schemaEntity.Schema
	o.CreateUser, err = domain.NewCreateUser(domain.CreateUserParams{
		ProjectID:  o.ProjectID,
		TeamID:     o.TeamID,
		ID:         o.ID,
		SchemaURL:  o.SchemaURL,
		Schema:     schemaEntity.Schema,
		Attributes: o.Attributes,
	})
	if err != nil {
		return err
	}

	return nil
}

func (o *CreateUserAction) Apply(ctx context.Context, stmts AllStatements) error {
	if err := applyCreateUser(ctx, stmts, o.CreateUser); err != nil {
		return err
	}
	attrKeys, attrValues := audit.UserAttributeAuditFields(o.Attributes, o.schemaJSON)
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeUserCreated,
		Category:   domain.EventCategoryEntity,
		ProjectID:  o.CreateUser.ProjectID,
		EntityType: "user",
		EntityID:   o.CreateUser.ID,
		Payload: domain.UserCreatedPayload{
			SchemaID:      o.CreateUser.SchemaURL,
			AttributeKeys: attrKeys,
			Attributes:    attrValues,
		},
	})
}

func applyCreateUser(ctx context.Context, stmts UserStatements, user *domain.CreateUser) error {
	err := stmts.CreateUser(ctx, user)
	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return domain.ErrUserAlreadyExists().WithParent(err)
		}
		return domain.ErrInternal(err).WithMessage("failed to create user in the database")
	}
	return nil
}

// ---- Set Password ACTION -------------------------------------------------------------

type SetPasswordUserAction struct {
	SetPasswordInput

	hasher crypto.Hasher

	hash string
}

func NewSetUserPasswordAction(input SetPasswordInput, hasher crypto.Hasher) *SetPasswordUserAction {
	return &SetPasswordUserAction{
		SetPasswordInput: input,
		hasher:           hasher,
	}
}

func (o *SetPasswordUserAction) Prepare(_ context.Context) (err error) {
	o.hash, err = domain.HashPassword(o.Password, o.hasher)
	return err
}

func (o *SetPasswordUserAction) Apply(ctx context.Context, stmts AllStatements) error {
	pw := &domain.SetUserPassword{
		ProjectID:      o.ProjectID,
		UserID:         o.UserID,
		EncodedHash:    o.hash,
		ChangeRequired: o.IsPasswordChangeRequired,
	}
	err := stmts.SetUserPassword(ctx, pw)
	if err != nil {
		if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
			return domain.ErrUserNotFound()
		}
		return domain.ErrInternal(err).WithMessage("failed to set password")
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeAuthFactorPasswordSet,
		Category:   domain.EventCategoryAuth,
		ProjectID:  o.ProjectID,
		EntityType: "user_password",
		EntityID:   pw.ID,
		Payload: domain.AuthFactorPayload{
			UserID:   o.UserID,
			FactorID: pw.ID,
		},
	})
}

// ---- Delete ACTION -------------------------------------------------------------

type DeleteUserAction struct {
	DeleteUserInput
}

func NewDeleteUserAction(input DeleteUserInput) *DeleteUserAction {
	return &DeleteUserAction{
		DeleteUserInput: input,
	}
}

func (o *DeleteUserAction) Prepare(_ context.Context) error {
	return nil
}

func (o *DeleteUserAction) Apply(ctx context.Context, stmts AllStatements) error {
	err := stmts.DeleteUserByID(ctx, o.ProjectID, o.UserID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil
		}
		return domain.ErrInternal(err).WithMessage("failed to delete user")
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeUserDeleted,
		Category:   domain.EventCategoryEntity,
		ProjectID:  o.ProjectID,
		EntityType: "user",
		EntityID:   o.UserID,
	})
}

// UserStatementsLookup adapts [UserStatements] to [UserLookup] for AuthAttemptService.
type UserStatementsLookup struct {
	Pool StatementPool
}

// GetByAttributes resolves a login identifier, so it matches only uniquely
// registered values: an equal value in a non-unique property of another user
// must not make the lookup ambiguous and reject the sign-in.
func (l UserStatementsLookup) GetByAttributes(ctx context.Context, projectID string, attrs []domain.Attribute) (*domain.User, error) {
	return l.Pool.Statements().GetUser(ctx,
		database.Equal(database.Col(domain.UserFieldProjectID), projectID),
		UserQueryOptions{Attributes: attrs, UniqueAttributesOnly: true},
	)
}
