package domain

import (
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/crypto"
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

func (p *Project) GenerateNewKeySet(kek crypto.Crypter) (*ProjectKeySet, error) {
	dek, err := NewEncryptionKey(p.ID, EncryptionKeyPurposeDEK, jose.A256GCM, kek)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project encryption key")
	}

	dekCrypter, err := dek.Crypter(kek)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to decrypt project encryption key")
	}

	tek, err := NewEncryptionKey(p.ID, EncryptionKeyPurposeToken, jose.A256GCM, dekCrypter)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project token encryption key")
	}

	sek, err := NewEncryptionKey(p.ID, EncryptionKeyPurposeSecret, jose.A256GCM, dekCrypter)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project secret encryption key")
	}

	cek, err := NewEncryptionKey(p.ID, EncryptionKeyPurposeCookie, jose.A256GCM, dekCrypter)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project cookie encryption key")
	}

	tsk, err := NewSigningKey(p.ID, SigningKeyPurposeToken, jose.EdDSA, dekCrypter)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project token signing key")
	}

	return &ProjectKeySet{
		DataEncryptionKey:   dek,
		TokenEncryptionKey:  tek,
		SecretEncryptionKey: sek,
		CookieEncryptionKey: cek,
		TokenSigningKey:     tsk,
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
	ProjectFieldPreviewOrigins
)

type ProjectKeySet struct {
	DataEncryptionKey   *EncryptionKey
	TokenEncryptionKey  *EncryptionKey
	SecretEncryptionKey *EncryptionKey
	CookieEncryptionKey *EncryptionKey
	TokenSigningKey     *SigningKey
}

func (s *ProjectKeySet) Activate(oldKeys *ProjectKeySet) {
	if oldKeys != nil {
		s.DataEncryptionKey.Activate(oldKeys.DataEncryptionKey)
		s.TokenEncryptionKey.Activate(oldKeys.TokenEncryptionKey)
		s.SecretEncryptionKey.Activate(oldKeys.SecretEncryptionKey)
		s.CookieEncryptionKey.Activate(oldKeys.CookieEncryptionKey)
		s.TokenSigningKey.Activate(oldKeys.TokenSigningKey)
	} else {
		s.DataEncryptionKey.Activate(nil)
		s.TokenEncryptionKey.Activate(nil)
		s.SecretEncryptionKey.Activate(nil)
		s.CookieEncryptionKey.Activate(nil)
		s.TokenSigningKey.Activate(nil)
	}
}
