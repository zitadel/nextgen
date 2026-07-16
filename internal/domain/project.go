package domain

import (
	"context"
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
	// PreviewOrigins are the allowed origins for the preview secret.
	// Callers must set this field before the project is persisted.
	PreviewOrigins []string
}

func NewProject(ctx context.Context, previewOrigins []string) (*Project, error) {
	id, err := NewID(PrefixProject)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project id")
	}

	if previewOrigins == nil {
		previewOrigins = []string{}
	}

	return &Project{
		ID:             id,
		PreviewOrigins: previewOrigins,
	}, nil
}

func (p *Project) ProjectSecret(generator TokenGenerator) (string, error) {
	projectSecret, err := generator.Generate(&Token{
		ProjectID: p.ID,
		Scope:     []string{"project.write", "project.read"},
	})
	if err != nil {
		return "", ErrInternal(err).WithMessage("failed to generate project secret")
	}
	return projectSecret, nil
}

func (p *Project) PreviewSecret(generator TokenGenerator) (string, error) {
	projectSecret, err := generator.Generate(&Token{
		ProjectID: p.ID,
		Scope:     []string{"project.read"},
	})
	if err != nil {
		return "", ErrInternal(err).WithMessage("failed to generate preview secret")
	}
	return projectSecret, nil
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
