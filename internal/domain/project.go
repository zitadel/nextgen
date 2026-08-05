package domain

import (
	"strings"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/oidc/v3/pkg/op"
)

const (
	PrefixProject ResourcePrefix = "proj"
)

// PlatformProjectID is the well-known id of the deployment's platform project.
// The server owns it: bootstrap (platform.bootstrap_project) creates this row
// and default-project resolution pins to it. Readable body per ADR 047 §3.3;
// operators never author it.
var PlatformProjectID = PrefixProject.IDPrefix("platform") // "proj_platform"

func ErrProjectNameInvalid() Error {
	return newError(PrefixProject.ErrorCodePrefix("name_invalid"), "The project name is invalid. Expected a non-empty string.", nil, nil)
}

func ErrProjectMissingID() Error {
	return newError(PrefixProject.ErrorCodePrefix("missing_id"), "project: missing id", nil, nil)
}

func ErrProjectNotFound() Error {
	return newError(PrefixProject.ErrorCodePrefix("not_found"), "project not found", nil, nil)
}

func ErrProjectPermissionDenied() Error {
	return newError(PrefixProject.ErrorCodePrefix("permission_denied"), "the project management API requires the project secret", nil, nil)
}

func ErrProjectAlreadyClaimed() Error {
	return newError(PrefixProject.ErrorCodePrefix("already_claimed"), "the project is already claimed by a team", nil, nil)
}

func ErrProjectClaimExpired() Error {
	return newError(PrefixProject.ErrorCodePrefix("claim_expired"), "the claim challenge has expired", nil, nil)
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
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, ErrProjectNameInvalid()
	}

	if previewOrigins == nil {
		previewOrigins = []string{}
	}

	return &Project{
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

// GenerateNewKeySet creates the project's key encryption key, wrapped by the
// deployment's master key, and the purpose-scoped keys wrapped by that KEK.
// mintID must mint the KEK ID before wrapping — that ID is the JWE "kid" for
// purpose keys. Other key IDs stay empty for Create* Ensure.
func (p *Project) GenerateNewKeySet(masterKey crypto.Crypter, mintID func(ResourcePrefix) (string, error)) (*ProjectKeySet, error) {
	kek, err := NewEncryptionKey(p.ID, EncryptionKeyPurposeKEK, jose.A256GCM, masterKey)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project key encryption key")
	}
	kek.ID, err = mintID(PrefixEncryptionKey)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to mint project key encryption key id")
	}

	kekCrypter, err := kek.Crypter(masterKey)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to decrypt project key encryption key")
	}

	tek, err := NewEncryptionKey(p.ID, EncryptionKeyPurposeToken, jose.A256GCM, kekCrypter)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project token encryption key")
	}

	sek, err := NewEncryptionKey(p.ID, EncryptionKeyPurposeSecret, jose.A256GCM, kekCrypter)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project secret encryption key")
	}

	cek, err := NewEncryptionKey(p.ID, EncryptionKeyPurposeCookie, jose.A256GCM, kekCrypter)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project cookie encryption key")
	}

	tsk, err := NewSigningKey(p.ID, SigningKeyPurposeToken, jose.EdDSA, kekCrypter)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create project token signing key")
	}

	return &ProjectKeySet{
		KeyEncryptionKey:    kek,
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
	KeyEncryptionKey    *EncryptionKey
	TokenEncryptionKey  *EncryptionKey
	SecretEncryptionKey *EncryptionKey
	CookieEncryptionKey *EncryptionKey
	TokenSigningKey     *SigningKey
}

func (s *ProjectKeySet) Activate(oldKeys *ProjectKeySet) {
	if oldKeys != nil {
		s.KeyEncryptionKey.Activate(oldKeys.KeyEncryptionKey)
		s.TokenEncryptionKey.Activate(oldKeys.TokenEncryptionKey)
		s.SecretEncryptionKey.Activate(oldKeys.SecretEncryptionKey)
		s.CookieEncryptionKey.Activate(oldKeys.CookieEncryptionKey)
		s.TokenSigningKey.Activate(oldKeys.TokenSigningKey)
	} else {
		s.KeyEncryptionKey.Activate(nil)
		s.TokenEncryptionKey.Activate(nil)
		s.SecretEncryptionKey.Activate(nil)
		s.CookieEncryptionKey.Activate(nil)
		s.TokenSigningKey.Activate(nil)
	}
}
