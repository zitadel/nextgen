package domain

import (
	"time"
)

const (
	PrefixProject ResourcePrefix = "proj"
)

func ErrProjectNameInvalid() Error {
	return newError(PrefixProject.ErrorCodePrefix("name_invalid"), "The project name is invalid. Expected a non-empty string.", nil, nil)
}

func ErrProjectNotFound() Error {
	return newError(PrefixProject.ErrorCodePrefix("not_found"), "project not found", nil, nil)
}

// Project is a minimal representation of the object defined [here](https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#projects)
// It is hardly ever modified but read a lot therefore it should be stored in global tables.
type Project struct {
	ID        string
	Name      string
	CreatedAt time.Time
	UpdatedAt time.Time
	// ProjectSecret is a bearer token that authenticates API calls for this project.
	// Callers must set this field before the project is persisted; the storage
	// layer does not generate it.
	ProjectSecret string
	// PreviewSecret is an origin-scoped bearer token for preview/testing.
	// Callers must set this field before the project is persisted.
	PreviewSecret string
	// PreviewOrigins are the allowed origins for the preview secret.
	// Callers must set this field before the project is persisted.
	PreviewOrigins []string
}

func NewProject(name string, previewOrigins []string, tokenGenerator TokenGenerator) (*Project, error) {
	id, err := newID(PrefixProject)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project id")
	}

	if name == "" {
		return nil, ErrProjectNameInvalid()
	}

	if previewOrigins == nil {
		previewOrigins = []string{}
	}

	// secrets
	projectSecret, err := tokenGenerator.Generate(&Token{
		ProjectID: id,
		Scope:     []string{"project.write", "project.read"},
	})
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to generate project secret")
	}
	previewSecret, err := tokenGenerator.Generate(&Token{
		ProjectID: id,
		Scope:     []string{"project.read"},
	})
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to generate preview secret")
	}

	return &Project{
		ID:             id,
		Name:           name,
		ProjectSecret:  projectSecret,
		PreviewSecret:  previewSecret,
		PreviewOrigins: previewOrigins,
	}, nil
}

// ProjectField enumerates the fields of Project which can be used for ordering in list operations.
type ProjectField uint8

const (
	ProjectFieldUnspecified ProjectField = iota
	ProjectFieldID
	ProjectFieldName
	ProjectFieldCreatedAt
	ProjectFieldUpdatedAt
	ProjectFieldProjectSecret
	ProjectFieldPreviewSecret
	ProjectFieldPreviewOrigins
)
