package service

import (
	"context"
	"encoding/json"
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
}

type UserAction interface {
	Prepare(ctx context.Context) error
	Apply(ctx context.Context, db database.QueryExecutor) error
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

type GetMyUserInput struct {
	SessionToken string
}

// ---- Implementation -------------------------------------------------------------

type UserService struct {
	pool         database.Pool
	userRepo     domain.UserRepository
	passwordRepo domain.UserPasswordRepository
	schemaRepo   domain.JSONSchemaRepository
	decrypter    crypto.Decrypter
	hasher       crypto.Hasher
}

func NewUserService(
	pool database.Pool,
	userRepo domain.UserRepository,
	passwordRepo domain.UserPasswordRepository,
	schemaRepo domain.JSONSchemaRepository,
	decrypter crypto.Decrypter,
	hasher crypto.Hasher,
) *UserService {
	return &UserService{
		pool:         pool,
		userRepo:     userRepo,
		passwordRepo: passwordRepo,
		schemaRepo:   schemaRepo,
		hasher:       hasher,
		decrypter:    decrypter,
	}
}

func (s *UserService) ApplyActions(ctx context.Context, actions ...UserAction) (err error) {
	for _, action := range actions {
		err = action.Prepare(ctx)
		if err != nil {
			return err
		}
	}

	tx, err := s.pool.Begin(ctx, nil)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to create transaction")
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	for _, action := range actions {
		err = action.Apply(ctx, tx)
		if err != nil {
			return err
		}
	}

	err = tx.Commit(ctx)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}
	return nil
}

func (s *UserService) CreateUser(ctx context.Context, input CreateUserInput) (_ map[string]any, err error) {
	// CreateUser does not need a transaction, so we don't wrap it in an `ApplyActions` call

	action := WithCreateUser(input, s.userRepo, s.schemaRepo, s.pool)
	err = action.Prepare(ctx)
	if err != nil {
		return nil, err
	}

	err = action.Apply(ctx, s.pool)
	if err != nil {
		return nil, err
	}

	return action.User, nil
}

func (s *UserService) GetUserByID(ctx context.Context, input GetUserInput) (map[string]any, error) {
	flatUser, err := s.userRepo.GetByID(ctx, s.pool, input.ProjectID, input.TeamID, input.UserID)
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
	action := WithSetUserPassword(input, s.hasher, s.passwordRepo)
	return s.ApplyActions(ctx, action)
}

func (s *UserService) GetMyUser(ctx context.Context, input GetMyUserInput) ([]byte, error) {
	sessionToken, err := domain.DecryptSessionTokenString(input.SessionToken, s.decrypter)
	if err != nil {
		return nil, domain.ErrSessionTokenInvalid()
	}
	if time.Now().After(sessionToken.ExpiresAt) {
		return nil, domain.ErrSessionTokenInvalid()
	}
	if sessionToken.UserID == nil {
		return nil, domain.ErrUserNotFound()
	}

	user, err := s.userRepo.GetByID(ctx, s.pool, sessionToken.ProjectID, nil, *sessionToken.UserID)
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

// ---- CreateUser opts -------------------------------------------------------------

type CreateUserAction struct {
	CreateUserInput

	userRepo   domain.UserRepository
	schemaRepo domain.JSONSchemaRepository
	db         database.Pool

	createUser *domain.CreateUser
}

func WithCreateUser(input CreateUserInput, userRepo domain.UserRepository, schemaRepo domain.JSONSchemaRepository, db database.Pool) *CreateUserAction {
	return &CreateUserAction{
		CreateUserInput: input,
		userRepo:        userRepo,
		schemaRepo:      schemaRepo,
		db:              db,
	}
}

func (o *CreateUserAction) Prepare(ctx context.Context) error {
	schemaURL, err := domain.SchemaFromUserMap(o.User)
	if err != nil {
		return err
	}

	schemaEntity, err := o.schemaRepo.GetByID(ctx, o.db, o.ProjectID, schemaURL)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return domain.ErrUserInvalid().WithDetails("$schema is not known to the system. First create a schema, then create users.")
		}
		return domain.ErrInternal(err).WithMessage("failed to get schema from database")
	}

	o.createUser, err = domain.NewCreateUser(o.ProjectID, o.TeamID, schemaEntity.Schema, o.User)
	if err != nil {
		return err
	}

	o.User["id"] = o.createUser.ID
	return nil
}
func (o *CreateUserAction) Apply(ctx context.Context, db database.QueryExecutor) error {
	err := o.userRepo.Create(ctx, db, o.createUser)
	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return domain.ErrUserAlreadyExists().WithParent(err)
		}
		return domain.ErrInternal(err).WithMessage("failed to create user in the database")
	}

	return nil
}

type SetPasswordUserAction struct {
	SetPasswordInput

	hasher       crypto.Hasher
	passwordRepo domain.UserPasswordRepository

	hash string
}

func WithSetUserPassword(input SetPasswordInput, hasher crypto.Hasher, passwordRepo domain.UserPasswordRepository) *SetPasswordUserAction {
	return &SetPasswordUserAction{
		SetPasswordInput: input,
		hasher:           hasher,
		passwordRepo:     passwordRepo,
	}
}
func (o *SetPasswordUserAction) Prepare(_ context.Context) (err error) {
	o.hash, err = domain.HashPassword(o.Password, o.hasher)
	return err
}

func (o *SetPasswordUserAction) Apply(ctx context.Context, db database.QueryExecutor) error {
	err := o.passwordRepo.DeleteByUserID(ctx, db, o.ProjectID, o.UserID)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to remove old password from database")
	}

	err = o.passwordRepo.Create(ctx, db, &domain.CreateUserPassword{
		ProjectID:      o.ProjectID,
		UserID:         o.UserID,
		EncodedHash:    o.hash,
		ChangeRequired: o.IsPasswordChangeRequired,
	})
	if err != nil {
		if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
			return domain.ErrUserNotFound()
		}
		return domain.ErrInternal(err).WithMessage("failed to set initial password")
	}
	return nil
}
