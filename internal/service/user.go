package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

// ---- Input types -------------------------------------------------------------

type CreateUserInput struct {
	ProjectID string
	TeamID    *string
	User      map[string]any
	ID        string
}

type UserAction interface {
	Prepare(ctx context.Context, db database.QueryExecutor) error
	Apply(ctx context.Context, tx Statementer[AllStatements]) error
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

// ---- Implementation -------------------------------------------------------------

type UserService struct {
	pool         database.Pool
	v2Pool       StatementPool
	passwordRepo domain.UserPasswordRepository
	schemaRepo   domain.JSONSchemaRepository
	hasher       crypto.Hasher
}

func NewUserService(
	pool database.Pool,
	v2Pool StatementPool,
	passwordRepo domain.UserPasswordRepository,
	schemaRepo domain.JSONSchemaRepository,
	hasher crypto.Hasher,
) *UserService {
	return &UserService{
		pool:         pool,
		v2Pool:       v2Pool,
		passwordRepo: passwordRepo,
		schemaRepo:   schemaRepo,
		hasher:       hasher,
	}
}

func (s *UserService) ApplyActions(ctx context.Context, actions ...UserAction) (err error) {
	for _, action := range actions {
		err = action.Prepare(ctx, s.pool)
		if err != nil {
			return err
		}
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		for _, action := range actions {
			if err := action.Apply(ctx, tx); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		var de domain.Error
		if errors.As(err, &de) {
			return de
		}
		return domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}
	return nil
}

func (s *UserService) CreateUser(ctx context.Context, input CreateUserInput) (_ map[string]any, err error) {
	action := NewCreateUserAction(input, s.schemaRepo)
	err = action.Prepare(ctx, s.pool)
	if err != nil {
		return nil, err
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		return action.Apply(ctx, tx)
	})
	if err != nil {
		var de domain.Error
		if errors.As(err, &de) {
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
	result, err := s.v2Pool.Statements().ListUsers(ctx, &v2database.ListOptions[domain.UserField]{
		Filter: v2database.Equal(v2database.Col(domain.UserFieldProjectID), input.ProjectID),
		Pagination: v2database.Page[domain.UserField]{
			Limit: input.Limit,
			OrderBy: v2database.OrderBy[domain.UserField]{
				Columns: []v2database.Column[domain.UserField]{
					v2database.Col(domain.UserFieldCreatedAt),
					v2database.Col(domain.UserFieldID),
				},
				Direction: v2database.OrderAsc,
			},
		},
	}, input.Offset, UserReadOptions{})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list users from database")
	}

	users := make([]map[string]any, 0, len(result.Items))
	for _, flatUser := range result.Items {
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
	flatUser, err := s.v2Pool.Statements().GetUserByID(ctx, input.ProjectID, input.TeamID, input.UserID, UserReadOptions{})
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
	action := NewSetUserPasswordAction(input, s.hasher, s.passwordRepo)
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

	user, err := s.v2Pool.Statements().GetUserByID(ctx, sessionToken.ProjectID, nil, sessionToken.UserID, UserReadOptions{})
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

// ---- Create User ACTION -------------------------------------------------------------

type CreateUserAction struct {
	CreateUserInput

	schemaRepo domain.JSONSchemaRepository

	CreateUser *domain.CreateUser
}

func NewCreateUserAction(input CreateUserInput, schemaRepo domain.JSONSchemaRepository) *CreateUserAction {
	return &CreateUserAction{
		CreateUserInput: input,
		schemaRepo:      schemaRepo,
	}
}

func (o *CreateUserAction) Prepare(ctx context.Context, db database.QueryExecutor) error {
	schemaURL, err := domain.SchemaFromUserMap(o.User)
	if err != nil {
		return err
	}

	schemaEntity, err := o.schemaRepo.GetByID(ctx, db, o.ProjectID, schemaURL)
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

func (o *CreateUserAction) Apply(ctx context.Context, tx Statementer[AllStatements]) error {
	err := tx.Statements().CreateUser(ctx, o.CreateUser)
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

	hasher       crypto.Hasher
	passwordRepo domain.UserPasswordRepository

	hash string
}

func NewSetUserPasswordAction(input SetPasswordInput, hasher crypto.Hasher, passwordRepo domain.UserPasswordRepository) *SetPasswordUserAction {
	return &SetPasswordUserAction{
		SetPasswordInput: input,
		hasher:           hasher,
		passwordRepo:     passwordRepo,
	}
}

func (o *SetPasswordUserAction) Prepare(_ context.Context, _ database.QueryExecutor) (err error) {
	o.hash, err = domain.HashPassword(o.Password, o.hasher)
	return err
}

func (o *SetPasswordUserAction) Apply(ctx context.Context, tx Statementer[AllStatements]) error {
	db, ok := tx.(database.QueryExecutor)
	if !ok {
		return domain.ErrInternal(nil).WithMessage("transaction does not support password repository writes")
	}
	err := o.passwordRepo.Set(ctx, db, &domain.SetUserPassword{
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

type UserActionFactory = func(ctx context.Context, db database.QueryExecutor) (UserAction, error)

// LazyUserAction allows for lazy initialization of a user-action. It forwards
// the `Prepare` and `Apply` methods to the generated action. The UserAction is
// only right before it is used in those functions.
//
// This action can be wrapped around an action when the wrapped action requires
// an output of a previous action. It can then use a clojure to get the data
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

func (o *LazyUserAction) Prepare(ctx context.Context, db database.QueryExecutor) (err error) {
	action, err := o.Action(ctx, db)
	if err != nil {
		return err
	}
	return action.Prepare(ctx, db)
}

func (o *LazyUserAction) Apply(ctx context.Context, tx Statementer[AllStatements]) error {
	db, ok := tx.(database.QueryExecutor)
	if !ok {
		return domain.ErrInternal(nil).WithMessage("transaction does not support lazy user action")
	}
	action, err := o.Action(ctx, db)
	if err != nil {
		return err
	}
	return action.Apply(ctx, tx)
}

func (o *LazyUserAction) Action(ctx context.Context, db database.QueryExecutor) (UserAction, error) {
	if o.action == nil {
		action, err := o.factory(ctx, db)
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
	return l.Pool.Statements().GetUserByAttributes(ctx, projectID, attrs, UserReadOptions{})
}

// UserStatementsIdentityReader adapts [UserStatements] to [UserIdentityReader].
type UserStatementsIdentityReader struct {
	Pool StatementPool
}

func (r UserStatementsIdentityReader) GetIdentity(ctx context.Context, projectID, userID string, attributeKeys ...string) (*domain.User, error) {
	return r.Pool.Statements().GetUserByID(ctx, projectID, nil, userID, UserReadOptions{
		AttributeKeys: attributeKeys,
	})
}
