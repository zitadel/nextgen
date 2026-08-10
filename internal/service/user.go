package service

import (
	"context"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Input types -------------------------------------------------------------

type CreateUserInput struct {
	ProjectID string
	TeamID    *string
	User      map[string]any
	ID        string
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

// ---- Implementation -------------------------------------------------------------

type UserService struct {
	v2Pool      StatementPool
	schemaStore domain.JSONSchemaStore
	hasher      crypto.Hasher
}

func NewUserService(
	v2Pool StatementPool,
	schemaStore domain.JSONSchemaStore,
	hasher crypto.Hasher,
) *UserService {
	return &UserService{
		v2Pool:      v2Pool,
		schemaStore: schemaStore,
		hasher:      hasher,
	}
}

func (s *UserService) ApplyActions(ctx context.Context, actions ...UserAction) (err error) {
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

func (s *UserService) CreateUser(ctx context.Context, input CreateUserInput) (_ map[string]any, err error) {
	action := NewCreateUserAction(input, s.schemaStore)
	if err := s.ApplyActions(ctx, action); err != nil {
		return nil, err
	}
	return action.User, nil
}

func (s *UserService) DeleteUser(ctx context.Context, input DeleteUserInput) error {
	action := NewDeleteUserAction(input)
	return s.ApplyActions(ctx, action)
}

func (s *UserService) ListUsers(ctx context.Context, input ListUsersInput) (*ListUsersOutput, error) {
	result, err := s.v2Pool.Statements().ListUsers(ctx, &database.ListOptions[domain.UserField]{
		Filter: database.Equal(database.Col(domain.UserFieldProjectID), input.ProjectID),
		Pagination: database.Page[domain.UserField]{
			Limit:  uint32(normalizeLimit(input.Limit)),
			Cursor: []byte(input.PageToken),
			OrderBy: database.OrderBy[domain.UserField]{
				Columns: []database.Column[domain.UserField]{
					database.Col(domain.UserFieldCreatedAt),
					database.Col(domain.UserFieldID),
				},
				Direction: database.OrderDesc,
			},
		},
	}, UserQueryOptions{})
	if err != nil {
		return nil, mapListError(err, "failed to list users from database")
	}

	return &ListUsersOutput{
		Items:         result.Items,
		NextPageToken: string(result.NextCursor),
	}, nil
}

func (s *UserService) ListPasskeys(ctx context.Context, input ListPasskeysInput) (passkeys []*domain.UserPasskey, nextPage string, err error) {
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
func (s *UserService) ListUserTeams(ctx context.Context, input ListUserTeamsInput) (*ListUserTeamsOutput, error) {
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

func (s *UserService) GetUserByID(ctx context.Context, input GetUserInput) (*domain.User, error) {
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

	return user, nil
}

func (s *UserService) SetPassword(ctx context.Context, input SetPasswordInput) (err error) {
	action := NewSetUserPasswordAction(input, s.hasher)
	return s.ApplyActions(ctx, action)
}

func (s *UserService) GetMyUser(ctx context.Context, input GetMyUserInput) (*domain.User, error) {
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

	return user, nil
}

// ---- Create User ACTION -------------------------------------------------------------

type CreateUserAction struct {
	CreateUserInput

	schemaStore domain.JSONSchemaStore

	CreateUser *domain.CreateUser
}

func NewCreateUserAction(input CreateUserInput, schemaStore domain.JSONSchemaStore) *CreateUserAction {
	return &CreateUserAction{
		CreateUserInput: input,
		schemaStore:     schemaStore,
	}
}

func (o *CreateUserAction) Prepare(ctx context.Context) error {
	schemaURL, err := domain.SchemaFromUserMap(o.User)
	if err != nil {
		return err
	}

	schemaEntity, err := o.schemaStore.GetJSONSchemaByID(ctx, o.ProjectID, schemaURL)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return domain.ErrUserInvalid().WithDetails("$schema is not known to the system. First create a schema, then create users.")
		}
		return domain.ErrInternal(err).WithMessage("failed to get schema from database")
	}

	o.CreateUser, err = domain.NewCreateUser(o.ProjectID, o.TeamID, o.ID, schemaEntity.Schema, o.User)
	if err != nil {
		return err
	}

	return nil
}

func (o *CreateUserAction) Apply(ctx context.Context, stmts AllStatements) error {
	if err := applyCreateUser(ctx, stmts, o.CreateUser); err != nil {
		return err
	}
	o.User["id"] = o.CreateUser.ID
	return nil
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
	err := stmts.SetUserPassword(ctx, &domain.SetUserPassword{
		ProjectID:      o.ProjectID,
		UserID:         o.UserID,
		EncodedHash:    o.hash,
		ChangeRequired: o.IsPasswordChangeRequired,
	})
	if err != nil {
		if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
			return domain.ErrUserNotFound()
		}
		return domain.ErrInternal(err).WithMessage("failed to set password")
	}
	return nil
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
	return nil
}

// UserStatementsLookup adapts [UserStatements] to [UserLookup] for AuthAttemptService.
type UserStatementsLookup struct {
	Pool StatementPool
}

func (l UserStatementsLookup) GetByAttributes(ctx context.Context, projectID string, attrs []domain.Attribute) (*domain.User, error) {
	return l.Pool.Statements().GetUser(ctx,
		database.Equal(database.Col(domain.UserFieldProjectID), projectID),
		UserQueryOptions{Attributes: attrs},
	)
}

// UserStatementsIdentityReader adapts [UserStatements] to [UserIdentityReader].
type UserStatementsIdentityReader struct {
	Pool StatementPool
}

func (r UserStatementsIdentityReader) GetIdentity(ctx context.Context, projectID, userID string, attributeKeys ...string) (*domain.User, error) {
	return r.Pool.Statements().GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserFieldID), userID),
	), UserQueryOptions{AttributeKeys: attributeKeys})
}
