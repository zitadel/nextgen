package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

//go:generate go tool mockgen -typed -package mocks -destination ./mocks/statement.mock.go . StatementPool,Statements,AllStatements,ProjectStatements,FlowDefinitionStatements,CryptoKeyStatements,UserStatements

type StatementPool interface {
	Statementer[AllStatements]
	Transactioner[AllStatements]
}

type Statements interface {
	IsStatements()
}

type AllStatements interface {
	ProjectStatements
	FlowDefinitionStatements
	CryptoKeyStatements
	UserStatements
	UserPasswordStatements
	Statements
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type ProjectPool interface {
// 	Statementer[ProjectStatements]
// 	Transactioner[ProjectStatements]
// }

type ProjectStatements interface {
	Statements
	CreateProject(ctx context.Context, entity *domain.Project) error
	GetProjectByID(ctx context.Context, id string) (*domain.Project, error)
	UpdateProject(ctx context.Context, entity *domain.Project) error
	ListProjects(ctx context.Context, filter *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error)
	DeleteProjectByID(ctx context.Context, id string) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type FlowDefinitionPool interface {
// 	Statementer[FlowDefinitionStatements]
// 	Transactioner[FlowDefinitionStatements]
// }

type FlowDefinitionStatements interface {
	Statements
	CreateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error
	GetFlowDefinitionByID(ctx context.Context, id string) (*domain.FlowDefinition, error)
	ListFlowDefinitions(ctx context.Context, filter *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error)
	DeleteFlowDefinitionByID(ctx context.Context, id string) error
}

type CryptoKeyStatements interface {
	Statements
	GetEncryptionKey(ctx context.Context, filter database.Filter[domain.EncryptionKeyField]) (*domain.EncryptionKey, error)
	CreateEncryptionKey(ctx context.Context, dek *domain.EncryptionKey) error
}

type UserReadOptions struct {
	// AttributeKeys limits hydrated EAV keys; empty means all attributes.
	AttributeKeys []string
	// WithAuthMethods loads AvailableAuthMethods from credential tables.
	WithAuthMethods bool
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type UserPool interface {
// 	Statementer[UserStatements]
// 	Transactioner[UserStatements]
// }

type UserStatements interface {
	Statements
	CreateUser(ctx context.Context, user *domain.CreateUser) error
	GetUserByID(ctx context.Context, projectID string, membershipTeamID *string, userID string, opts UserReadOptions) (*domain.User, error)
	GetUserByAttributes(ctx context.Context, projectID string, attrs []domain.Attribute, opts UserReadOptions) (*domain.User, error)
	ListUsers(ctx context.Context, filter *database.ListOptions[domain.UserField], offset uint32, opts UserReadOptions) (*database.ListResult[*domain.User], error)
	ListUsersByAttributes(ctx context.Context, projectID string, teamScope *string, attrs []domain.Attribute, opts UserReadOptions) (*database.ListResult[*domain.User], error)
	DeactivateUser(ctx context.Context, projectID, userID string) error
	DeleteUserByID(ctx context.Context, projectID, userID string) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type UserPasswordPool interface {
// 	Statementer[UserPasswordStatements]
// 	Transactioner[UserPasswordStatements]
// }

// UserPasswordStatements is the storage v2 surface for the user_passwords table.
type UserPasswordStatements interface {
	Statements
	SetUserPassword(ctx context.Context, pw *domain.SetUserPassword) error
	GetUserPasswordByUserID(ctx context.Context, projectID, userID string) (*domain.UserPassword, error)
	ListUserPasswords(ctx context.Context, filter *database.ListOptions[domain.UserPasswordField]) (*database.ListResult[*domain.UserPassword], error)
	DeleteUserPasswordByUserID(ctx context.Context, projectID, userID string) error
}

