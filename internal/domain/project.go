package domain

import (
	"time"
)

const (
	PrefixProject ResourcePrefix = "proj"
)

// Project is a minimal representation of the object defined [here](https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#projects)
// It is hardly ever modified but read a lot therefore it should be stored in global tables.
type Project struct {
	ID        string
	CreatedAt time.Time
	UpdatedAt time.Time
	// ProjectSecret is a bearer token that authenticates API calls for this project.
	// Callers of [ProjectRepository.Create] must pre-populate this field; the
	// repository does not generate it.
	ProjectSecret string
	// PreviewSecret is an origin-scoped bearer token for preview/testing.
	// Callers of [ProjectRepository.Create] must pre-populate this field.
	PreviewSecret string
	// PreviewOrigins are the allowed origins for the preview secret.
	// Callers of [ProjectRepository.Create] must pre-populate this field.
	PreviewOrigins []string
}

func NewProject(previewOrigins []string, tokenGenerator TokenGenerator) (*Project, error) {
	id, err := newID(PrefixProject)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project id")
	}
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

	if previewOrigins == nil {
		previewOrigins = []string{}
	}

	return &Project{
		ID:             id,
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
	ProjectFieldCreatedAt
	ProjectFieldUpdatedAt
	ProjectFieldProjectSecret
	ProjectFieldPreviewSecret
	ProjectFieldPreviewOrigins
)
