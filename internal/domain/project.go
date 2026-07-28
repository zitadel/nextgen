package domain

import (
	"strings"
	"time"

	"github.com/zitadel/oidc/v3/pkg/op"
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

func ErrProjectPermissionDenied() Error {
	return newError(PrefixProject.ErrorCodePrefix("permission_denied"), "the project management API requires the project secret", nil, nil)
}

// Project is a minimal representation of the object defined [here](https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#projects)
// It is hardly ever modified but read a lot therefore it should be stored in global tables.
type Project struct {
	ID        string
	Name      string
	CreatedAt time.Time
	UpdatedAt time.Time
	// PreviewOrigins are the allowed origins for the preview secret.
	// Callers must set this field before the project is persisted.
	PreviewOrigins []string
}

func NewProject(name string, previewOrigins []string) (*Project, error) {
	id, err := newID(PrefixProject)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project id")
	}

	name = strings.TrimSpace(name)
	if name == "" {
		return nil, ErrProjectNameInvalid()
	}

	if previewOrigins == nil {
		previewOrigins = []string{}
	}

	return &Project{
		ID:             id,
		Name:           name,
		PreviewOrigins: previewOrigins,
	}, nil
}

func (p *Project) ProjectSecret(encrypter op.Encrypter) (string, error) {
	projectSecret, err := (&Token{
		ProjectID: p.ID,
		Scope:     []string{"project.write", "project.read"},
	}).JWE(encrypter)
	if err != nil {
		return "", ErrInternal(err).WithMessage("failed to generate project secret")
	}
	return projectSecret, nil
}

func (p *Project) PreviewSecret(encrypter op.Encrypter) (string, error) {
	previewSecret, err := (&Token{
		ProjectID: p.ID,
		Scope:     []string{"project.read"},
	}).JWE(encrypter)
	if err != nil {
		return "", ErrInternal(err).WithMessage("failed to generate preview secret")
	}
	return previewSecret, nil
}

// ProjectField enumerates the fields of Project which can be used for ordering in list operations.
type ProjectField uint8

const (
	ProjectFieldUnspecified ProjectField = iota
	ProjectFieldID
	ProjectFieldName
	ProjectFieldCreatedAt
	ProjectFieldUpdatedAt
	ProjectFieldPreviewOrigins
)
