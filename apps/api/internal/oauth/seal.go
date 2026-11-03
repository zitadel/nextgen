package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// sealedKind tells sealed values apart, so a refresh token can never be
// presented as a code, a registration or a parked request, and none of them
// as anything else the project's token key seals.
type sealedKind string

const (
	kindRequest sealedKind = "oauth_authorization_request"
	kindCode    sealedKind = "oauth_code"
	kindRefresh sealedKind = "oauth_refresh_token"
	kindClient  sealedKind = "oauth_registered_client"
)

// errSealed is a sealed value this server did not seal for this purpose, or
// one that expired: the caller answers it as the protocol's "invalid".
var errSealed = errors.New("oauth: not a valid sealed value")

// envelope is what a sealed value decrypts to.
type envelope struct {
	Kind    sealedKind      `json:"kind"`
	Project string          `json:"project_id"`
	Expires int64           `json:"exp,omitempty"`
	Body    json.RawMessage `json:"body"`
}

// seal encrypts body with the platform project's token key (ADR 037's opaque
// token: a JWE), for ttl, or for good when ttl is zero.
func (s *Server) seal(ctx context.Context, kind sealedKind, body any, ttl time.Duration) (string, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return "", domain.ErrInternal(err).WithMessage("failed to serialize sealed value")
	}
	env := envelope{Kind: kind, Project: s.projectID, Body: raw}
	if ttl > 0 {
		env.Expires = s.now().Add(ttl).Unix()
	}
	payload, err := json.Marshal(env)
	if err != nil {
		return "", domain.ErrInternal(err).WithMessage("failed to serialize sealed value")
	}
	crypter, err := s.keys.GetProjectCrypter(ctx, s.projectID, domain.EncryptionKeyPurposeToken)
	if err != nil {
		return "", err
	}
	sealed, err := crypter.Encrypt(string(payload))
	if err != nil {
		return "", domain.ErrInternal(err).WithMessage("failed to seal value")
	}
	return sealed, nil
}

// unseal decrypts a value seal made for kind into body. Anything that is not
// one is errSealed; a key store failure keeps its own error, so an outage is
// never answered as a client's mistake.
func (s *Server) unseal(ctx context.Context, kind sealedKind, sealed string, body any) error {
	header, err := domain.DecodeStoredKeyJWEHeader(sealed)
	if err != nil {
		return errSealed
	}
	key, err := s.keys.GetEncryptionKey(ctx, header.KeyID, header.EncryptionAlgorithm)
	if err != nil {
		if errors.Is(err, domain.ErrEncryptionKeyNotFound()) {
			return errSealed
		}
		return err
	}
	// Another project's token key decrypts its own values, never ours.
	if key.ProjectID != s.projectID || key.Purpose != domain.EncryptionKeyPurposeToken {
		return errSealed
	}
	crypter, err := s.keys.GetCrypter(ctx, header.KeyID, header.EncryptionAlgorithm)
	if err != nil {
		return err
	}
	decrypted, err := crypter.Decrypt(sealed)
	if err != nil {
		return errSealed
	}
	var env envelope
	if err := json.Unmarshal([]byte(decrypted), &env); err != nil {
		return errSealed
	}
	if env.Kind != kind || env.Project != s.projectID {
		return errSealed
	}
	if env.Expires != 0 && s.now().Unix() >= env.Expires {
		return errSealed
	}
	if err := json.Unmarshal(env.Body, body); err != nil {
		return errSealed
	}
	return nil
}
