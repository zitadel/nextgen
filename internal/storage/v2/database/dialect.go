package database

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

type Dialect interface {
	// Name returns the name of the dialect. e.g. "postgres", "mysql", "sqlite".
	Name() string
	// Connect creates a new connection pool for the dialect.
	// The returned pool should be ready to use and connected to the database.
	Connect(ctx context.Context) (Pool, error)
	// Statements returns the available statements for the dialect.
	// These statements are used by the repositories to execute database operations.
	Statements() Statements
}

type Statements interface {
	ProjectStatements
}

type ProjectStatements interface {
	CreateProject(project domain.Project) Statement
	GetProjectByID(id string) Statement
	ListProjects(filter Filter) Statement
	DeleteProjectByID(id string) Statement
}

type ProjectColumn uint8

const (
	ProjectColumnID ProjectColumn = iota
	ProjectColumnCreatedAt
	ProjectColumnUpdatedAt
	ProjectColumnProjectSecret
	ProjectColumnPreviewSecret
	ProjectColumnPreviewOrigins
)

// func Service() {
// 	// map request to domain
// 	filter := Domain()
// 	var pool Pool
// 	Repo(context.Background(), pool, filter)
// }

// func Domain() Filter {
// 	return And(
// 		TextEquals(ProjectColumnID, "foo"),
// 		Or(
// 			TextIgnoreCaseEquals(ProjectColumnCreatedAt, "bar"),
// 			TextEquals(ProjectColumnUpdatedAt, "baz"),
// 		),
// 	)
// }

// func Repo(ctx context.Context, client QueryExecutor, filter Filter) ([]*domain.Project, error) {
// 	var dialect Dialect
// 	return dialect.Statements().ListProjects(filter)(ctx, client)
// }
