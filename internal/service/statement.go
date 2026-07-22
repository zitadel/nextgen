package service

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

//go:generate go tool mockgen -typed -package mocks -destination ./mocks/statement.mock.go . StatementPool,Statements,AllStatements,ProjectStatements,FlowDefinitionStatements,CryptoKeyStatements,TokenStatements,SessionStatements,AuthAttemptStatements

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
	TokenStatements
	SessionStatements
	AuthAttemptStatements
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

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type SessionPool interface {
// 	Statementer[SessionStatements]
// 	Transactioner[SessionStatements]
// }

type SessionStatements interface {
	Statements
	CreateSession(ctx context.Context, entity *domain.Session) error
	ExchangeSession(ctx context.Context, projectID, handoffToken string, idempotencyKey *string, ttl time.Duration) (*domain.Session, error)
	GetSessionByID(ctx context.Context, projectID, sessionID string) (*domain.Session, error)
	ListSessions(ctx context.Context, filter *database.ListOptions[domain.SessionField]) (*database.ListResult[*domain.Session], error)
	DeleteSessionByID(ctx context.Context, projectID, sessionID string) error
}

// TODO(adlerhurst): until go 1.27 only [StatementPool] and [Statements] are used, the rest is prepared for generic methods
// type AuthAttemptPool interface {
// 	Statementer[AuthAttemptStatements]
// 	Transactioner[AuthAttemptStatements]
// }

type AuthAttemptStatements interface {
	Statements
	CreateAuthAttempt(ctx context.Context, entity *domain.AuthAttempt) error
	GetAuthAttemptByID(ctx context.Context, projectID, authAttemptID string) (*domain.AuthAttempt, error)
	GetAuthAttemptByHandoffToken(ctx context.Context, projectID string, handoffToken []byte) (*domain.AuthAttempt, error)
	DeleteAuthAttemptByID(ctx context.Context, projectID, authAttemptID string) error
	HandoffAuthAttempt(ctx context.Context, attempt *domain.AuthAttempt) error
	SetAuthAttemptChallenge(ctx context.Context, projectID, authAttemptID string, challenge domain.AuthChallenge) error
	AuthAttemptChallengeSucceeded(ctx context.Context, projectID, authAttemptID string, factor domain.AuthFactor, challengeID string) error
	AuthAttemptChallengeFailed(ctx context.Context, projectID, authAttemptID string, challenge domain.AuthChallenge) error
}
