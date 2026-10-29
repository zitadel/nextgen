package oauth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/go-jose/go-jose/v4"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
)

// accessTokenType is RFC 9068's JOSE `typ` for a JWT access token. A
// verifier refuses a JWT without it, so an ID token or any other JWT signed
// with the same key is never taken for an access token.
const accessTokenType = "at+jwt"

// accessTokenLeeway absorbs clock skew between replicas on exp and iat.
const accessTokenLeeway = 30 * time.Second

// accessTokenClaims is an access token's payload, in RFC 9068's profile.
type accessTokenClaims struct {
	Issuer    string `json:"iss"`
	Subject   string `json:"sub"`
	Audience  string `json:"aud"`
	ClientID  string `json:"client_id"`
	Scope     string `json:"scope,omitempty"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
	JWTID     string `json:"jti"`
}

// VerifiedToken is what a verified access token says.
type VerifiedToken struct {
	// ProjectID is the issuer's project, the subject's home.
	ProjectID string
	Subject   string
	ClientID  string
	Audience  string
	Scope     []string
	ExpiresAt time.Time
}

// signingKey is the platform project's token signing key and the key that
// wraps it. The key signed nothing before this server: GenerateNewKeySet
// minted it with the project, unused.
func (s *Server) signingKey(ctx context.Context) (*domain.SigningKey, crypto.Crypter, error) {
	key, err := s.keys.GetProjectSigningKey(ctx, s.projectID, domain.SigningKeyPurposeToken)
	if err != nil {
		return nil, nil, err
	}
	header, err := domain.DecodeJWEHeader(key.Key)
	if err != nil {
		return nil, nil, domain.ErrInternal(err).WithMessage("failed to decode signing key")
	}
	kek, err := s.keys.GetCrypter(ctx, header.KeyID, header.EncryptionAlgorithm)
	if err != nil {
		return nil, nil, err
	}
	return key, kek, nil
}

// publicKeys is the JWKS: the active signing key's public half.
func (s *Server) publicKeys(ctx context.Context) (jose.JSONWebKeySet, error) {
	key, kek, err := s.signingKey(ctx)
	if err != nil {
		return jose.JSONWebKeySet{}, err
	}
	public, err := key.PublicJWK(kek)
	if err != nil {
		return jose.JSONWebKeySet{}, err
	}
	return jose.JSONWebKeySet{Keys: []jose.JSONWebKey{public}}, nil
}

// mintAccessToken signs an access token for one API.
func (s *Server) mintAccessToken(ctx context.Context, subject, clientID string, api API, scope []string) (string, time.Time, error) {
	key, kek, err := s.signingKey(ctx)
	if err != nil {
		return "", time.Time{}, err
	}
	signer, err := key.SignerWithOptions(kek, (&jose.SignerOptions{}).WithType(accessTokenType))
	if err != nil {
		return "", time.Time{}, err
	}
	jti := make([]byte, 16)
	if _, err := rand.Read(jti); err != nil {
		return "", time.Time{}, domain.ErrInternal(err).WithMessage("failed to mint token id")
	}
	now := s.now()
	expires := now.Add(s.cfg.AccessTokenTTL)
	payload, err := json.Marshal(accessTokenClaims{
		Issuer:    s.issuer,
		Subject:   subject,
		Audience:  api.Identifier,
		ClientID:  clientID,
		Scope:     strings.Join(scope, " "),
		IssuedAt:  now.Unix(),
		ExpiresAt: expires.Unix(),
		JWTID:     base64.RawURLEncoding.EncodeToString(jti),
	})
	if err != nil {
		return "", time.Time{}, domain.ErrInternal(err).WithMessage("failed to serialize access token")
	}
	signed, err := signer.Sign(payload)
	if err != nil {
		return "", time.Time{}, domain.ErrInternal(err).WithMessage("failed to sign access token")
	}
	compact, err := signed.CompactSerialize()
	if err != nil {
		return "", time.Time{}, domain.ErrInternal(err).WithMessage("failed to serialize access token")
	}
	return compact, expires, nil
}

// IsJWT reports whether a bearer has a JWS's three parts, unlike the JWEs
// (five parts) that are the project secret and the session token.
func IsJWT(token string) bool {
	return strings.Count(token, ".") == 2
}

// Verify checks an access token this authorization server issued for the
// API whose identifier is audience: the signature against the project's
// key, `typ`, issuer, audience and lifetime. A token it refuses is
// domain.ErrInvalidToken; a key store failure is passed on, so an outage is
// never answered as a dead token.
func (s *Server) Verify(ctx context.Context, raw, audience string) (*VerifiedToken, error) {
	signed, err := jose.ParseSigned(raw, []jose.SignatureAlgorithm{jose.EdDSA})
	if err != nil || len(signed.Signatures) != 1 {
		return nil, domain.ErrInvalidToken().WithDetails("not a signed token")
	}
	header := signed.Signatures[0].Protected
	if typ, _ := header.ExtraHeaders[jose.HeaderType].(string); !strings.EqualFold(typ, accessTokenType) {
		return nil, domain.ErrInvalidToken().WithDetails("not an access token")
	}
	key, kek, err := s.signingKey(ctx)
	if err != nil {
		if errors.Is(err, domain.ErrSigningKeyNotFound()) {
			return nil, domain.ErrInvalidToken().WithDetails("no signing key")
		}
		return nil, err
	}
	public, err := key.PublicJWK(kek)
	if err != nil {
		return nil, err
	}
	// Only the active key verifies: nothing rotates the signing key yet, so
	// there is no retired one to accept (ADR 039 decides how long one stays).
	if header.KeyID != key.ID {
		return nil, domain.ErrInvalidToken().WithDetails("unknown key")
	}
	payload, err := signed.Verify(public.Key)
	if err != nil {
		return nil, domain.ErrInvalidToken().WithDetails("bad signature")
	}
	var claims accessTokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, domain.ErrInvalidToken().WithDetails("bad claims")
	}
	now := s.now()
	switch {
	case claims.Issuer != s.issuer:
		return nil, domain.ErrInvalidToken().WithDetails("wrong issuer")
	case claims.Audience != audience:
		return nil, domain.ErrInvalidToken().WithDetails("wrong audience")
	case claims.Subject == "" || claims.ClientID == "":
		return nil, domain.ErrInvalidToken().WithDetails("no subject or client")
	case now.After(time.Unix(claims.ExpiresAt, 0).Add(accessTokenLeeway)):
		return nil, domain.ErrInvalidToken().WithDetails("expired")
	case time.Unix(claims.IssuedAt, 0).After(now.Add(accessTokenLeeway)):
		return nil, domain.ErrInvalidToken().WithDetails("issued in the future")
	}
	return &VerifiedToken{
		ProjectID: s.projectID,
		Subject:   claims.Subject,
		ClientID:  claims.ClientID,
		Audience:  claims.Audience,
		Scope:     strings.Fields(claims.Scope),
		ExpiresAt: time.Unix(claims.ExpiresAt, 0),
	}, nil
}

// VerifyPlatformAccessToken verifies a user bearer for the platform API: the
// credential ADR 053 §5 plans for the CLI.
func (s *Server) VerifyPlatformAccessToken(ctx context.Context, raw string) (*VerifiedToken, error) {
	api, _ := s.app.api(PlatformAPISlug)
	return s.Verify(ctx, raw, api.Identifier)
}
