package domain

import (
	"strings"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/crypto"
)

const (
	PrefixProject ResourcePrefix = "proj"
)

// PlatformProjectID is the well-known id of the deployment's platform project.
// The server owns it: bootstrap (platform.bootstrap_project) creates this row
// and pins default-project resolution to it while the flag is set. Without
// that pin (or an explicit platform.project_id) the resolution heuristic
// skips this row — it is infrastructure, never the deployment's own product
// project. Readable body per ADR 047 §3.3; operators never author it.
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

// ErrProjectClaimWindowExpired covers a claim attempted after the project's
// ClaimWindow closed. Distinct from ErrProjectClaimExpired, which names a dead
// challenge and invites starting a new one; this refusal is final, so clients
// must not present it as retryable. The message spells out ClaimWindow's 14
// days as a literal because gen_error_schemas lifts it into the OpenAPI error
// component verbatim; keep the two in sync.
func ErrProjectClaimWindowExpired() Error {
	return newError(
		PrefixProject.ErrorCodePrefix("claim_window_expired"),
		"the project was not claimed within 14 days of creation and can no longer be claimed",
		nil, nil,
	)
}

// Project is a minimal representation of the object defined [here](https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#projects)
// It is hardly ever modified but read a lot therefore it should be stored in global tables.
type Project struct {
	ID        string
	Name      string
	CreatedAt time.Time
	UpdatedAt time.Time
	// AllowedOrigins is the origin allowlist: patterns with a kind. Nothing
	// here routes; a primary pattern admits requests and a preview pattern
	// bounds what a preview deploy may register.
	AllowedOrigins []AllowedOrigin
	// Class decides which patterns the allowlist accepts and whether a pinned
	// release must already be deployed to the matched target.
	Class ProjectClass
	// PasswordHashPolicy is the hashing method this project's passwords are
	// written with. Nil means the deployment default, which is what a project
	// runs on until an admin chooses otherwise. See [PasswordHashPolicy].
	PasswordHashPolicy *PasswordHashPolicy
}

// NewProject validates the name and normalises every allowlist pattern
// against the sandbox rules, which is the class a project starts in.
func NewProject(name string, allowedOrigins []AllowedOrigin) (*Project, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, ErrProjectNameInvalid()
	}

	origins, err := NormalizeAllowedOrigins(ProjectClassSandbox, allowedOrigins)
	if err != nil {
		return nil, err
	}

	return &Project{
		Name:           name,
		AllowedOrigins: origins,
		Class:          ProjectClassSandbox,
	}, nil
}

// NormalizeAllowedOrigins normalises and lints every entry for class, in
// order, and rejects a pattern listed twice. Never nil, so an empty allowlist
// is stored as an empty list.
func NormalizeAllowedOrigins(class ProjectClass, entries []AllowedOrigin) ([]AllowedOrigin, error) {
	origins := make([]AllowedOrigin, 0, len(entries))
	seen := make(map[string]bool, len(entries))
	for _, entry := range entries {
		pattern, err := NormalizeOrigin(entry.Pattern)
		if err != nil {
			return nil, err
		}
		if !entry.Kind.IsAOriginKind() {
			return nil, ErrOriginInvalid(map[string]string{"pattern": entry.Pattern, "reason": "unknown kind"})
		}
		entry.Pattern = pattern
		if _, err := LintOriginPattern(class, entry); err != nil {
			return nil, err
		}
		if seen[pattern] {
			return nil, ErrOriginInvalid(map[string]string{"pattern": pattern, "reason": "listed twice"})
		}
		seen[pattern] = true
		origins = append(origins, entry)
	}
	return origins, nil
}

func (p *Project) Token() *Token {
	return &Token{
		ProjectID: p.ID,
		Type:      TokenTypeProjectToken,
		Scope:     []string{"project.write", "project.read"},
	}
}

// PreviewToken is the publishable key: the public-plane credential a browser
// bundle ships with.
func (p *Project) PreviewToken() *Token {
	return &Token{
		ProjectID: p.ID,
		Type:      TokenTypeProjectPreview,
		Scope:     []string{"project.read"},
	}
}

// PreviewDeployToken is the credential a pull-request build holds: it may
// create releases and deploy to preview origins, and nothing else.
func (p *Project) PreviewDeployToken() *Token {
	return &Token{
		ProjectID: p.ID,
		Type:      TokenTypeProjectPreviewDeploy,
		Scope:     []string{"release.write", "release.read", "deployment.preview", "deployment.read", "allowed_origin.read", "project.read"},
	}
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
	ProjectFieldAllowedOrigins
	ProjectFieldClass
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
