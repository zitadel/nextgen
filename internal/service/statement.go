package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

//go:generate go tool mockgen -typed -package mocks -destination ./mocks/statement.mock.go . StatementPool,Statements,AllStatements,ProjectStatements,FlowDefinitionStatements,CryptoKeyStatements,JSONSchemaStatements,TeamStatements,TokenStatements

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
	JSONSchemaStatements
	TeamStatements
	TokenStatements
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

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type JSONSchemaPool interface {
// 	Statementer[JSONSchemaStatements]
// 	Transactioner[JSONSchemaStatements]
// }

type JSONSchemaStatements interface {
	Statements
	CreateJSONSchema(ctx context.Context, entity *domain.JSONSchema) error
	GetJSONSchemaByID(ctx context.Context, projectID, schemaID string) (*domain.JSONSchema, error)
	ListJSONSchemas(ctx context.Context, filter *database.ListOptions[domain.JSONSchemaField]) (*database.ListResult[*domain.JSONSchema], error)
	DeleteJSONSchemaByID(ctx context.Context, projectID, schemaID string) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type TeamPool interface {
// 	Statementer[TeamStatements]
// 	Transactioner[TeamStatements]
// }

type TeamStatements interface {
	Statements
	CreateTeam(ctx context.Context, entity *domain.Team) error
	GetTeamByID(ctx context.Context, projectID, id string) (*domain.Team, error)
	// DeactivateTeam tombs the team and cascades membership/user lifecycle
	// updates. It wraps the multi-write steps in withTransaction (opens a tx
	// via Statements(), joins an outer pool.Transaction when already nested).
	DeactivateTeam(ctx context.Context, projectID, id string) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type TokenPool interface {
// 	Statementer[TokenStatements]
// 	Transactioner[TokenStatements]
// }

type TokenStatements interface {
	Statements
	CreateToken(ctx context.Context, entity *domain.Token) error
	GetTokenByID(ctx context.Context, projectID, tokenID string) (*domain.Token, error)
	ListTokens(ctx context.Context, filter *database.ListOptions[domain.TokenField]) (*database.ListResult[*domain.Token], error)
	DeleteTokenByID(ctx context.Context, projectID, tokenID string) error
}
