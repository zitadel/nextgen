package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
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
	// Offset/Limit window the creation-ordered result; zero means
	// "from the start" / "server default applied at the API edge".
	Offset uint32
	Limit  uint32
}

type GetMyUserInput struct {
	// SessionToken is the parsed session token, already verified at the API
	// security boundary.
	SessionToken *domain.Token
}

type GetUserMetadataInput struct {
	ProjectID string
	UserID    string
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
	err = action.Prepare(ctx)
	if err != nil {
		return nil, err
	}

	err = applyCreateUser(ctx, s.v2Pool.Statements(), action.CreateUser)
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create user")
	}

	return action.User, nil
}

// ListUsers returns the project's users as attribute trees (the same
// shape CreateUser returns and GET /users/{id} serves), ordered by
// creation time so pagination windows are stable.
func (s *UserService) ListUsers(ctx context.Context, input ListUsersInput) ([]map[string]any, error) {
	limit := input.Limit
	if input.Offset > 0 {
		limit = input.Offset + input.Limit
	}
	result, err := s.v2Pool.Statements().ListUsers(ctx, &database.ListOptions[domain.UserField]{
		Filter: database.Equal(database.Col(domain.UserFieldProjectID), input.ProjectID),
		Pagination: database.Page[domain.UserField]{
			Limit: limit,
			OrderBy: database.OrderBy[domain.UserField]{
				Columns: []database.Column[domain.UserField]{
					database.Col(domain.UserFieldCreatedAt),
					database.Col(domain.UserFieldID),
				},
				Direction: database.OrderAsc,
			},
		},
	}, UserQueryOptions{})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list users from database")
	}

	items := result.Items
	if input.Offset > 0 {
		if int(input.Offset) >= len(items) {
			items = nil
		} else {
			items = items[input.Offset:]
		}
	}

	users := make([]map[string]any, 0, len(items))
	for _, flatUser := range items {
		user, err := domain.BuildAttributeTree(flatUser.Attributes)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to parse user attributes")
		}
		user["id"] = flatUser.ID
		users = append(users, user)
	}
	return users, nil
}

func (s *UserService) GetUserByID(ctx context.Context, input GetUserInput) (map[string]any, error) {
	flatUser, err := s.v2Pool.Statements().GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), input.ProjectID),
		database.Equal(database.Col(domain.UserFieldID), input.UserID),
	), UserQueryOptions{MembershipTeamID: input.TeamID})
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrUserNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get user from database")
	}

	user, err := domain.BuildAttributeTree(flatUser.Attributes)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to parse user attributes")
	}

	user["id"] = flatUser.ID
	return user, nil
}

func (s *UserService) SetPassword(ctx context.Context, input SetPasswordInput) (err error) {
	action := NewSetUserPasswordAction(input, s.hasher)
	return s.ApplyActions(ctx, action)
}

func (s *UserService) GetMyUser(ctx context.Context, input GetMyUserInput) ([]byte, error) {
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

	userbs, err := json.Marshal(user)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to serialize user")
	}

	return userbs, nil
}

func (s *UserService) GetUserMetadata(ctx context.Context, input GetUserMetadataInput) (*domain.UserMetadata, error) {
	user, err := s.v2Pool.Statements().GetUserMetadata(ctx, input.ProjectID, input.UserID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrUserNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get user metadata from database")
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

	o.User["id"] = o.CreateUser.ID
	return nil
}

func (o *CreateUserAction) Apply(ctx context.Context, stmts AllStatements) error {
	return applyCreateUser(ctx, stmts, o.CreateUser)
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

// ---- Lazy ACTION -------------------------------------------------------------

type UserActionFactory = func(ctx context.Context) (UserAction, error)

// LazyUserAction allows for lazy initialization of a user-action. It forwards
// the `Prepare` and `Apply` methods to the generated action. The UserAction is
// created right before it is used in those functions.
//
// This action can be wrapped around an action when the wrapped action requires
// an output of a previous action. It can then use a closure to get the data
// from the other action.
type LazyUserAction struct {
	factory UserActionFactory
	action  UserAction
}

func NewLazyUserAction(factory UserActionFactory) *LazyUserAction {
	return &LazyUserAction{
		factory: factory,
	}
}

func (o *LazyUserAction) Prepare(ctx context.Context) (err error) {
	action, err := o.Action(ctx)
	if err != nil {
		return err
	}
	return action.Prepare(ctx)
}

func (o *LazyUserAction) Apply(ctx context.Context, stmts AllStatements) error {
	action, err := o.Action(ctx)
	if err != nil {
		return err
	}
	return action.Apply(ctx, stmts)
}

func (o *LazyUserAction) Action(ctx context.Context) (UserAction, error) {
	if o.action == nil {
		action, err := o.factory(ctx)
		if err != nil {
			return nil, err
		}
		o.action = action
	}
	return o.action, nil
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
