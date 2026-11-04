package oauth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"slices"
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

// signingKey is the platform project's active token key for algorithm and
// the key that wraps it, minted the first time the project signs with
// algorithm.
func (s *Server) signingKey(ctx context.Context, algorithm jose.SignatureAlgorithm) (*domain.SigningKey, crypto.Crypter, error) {
	key, err := s.keys.EnsureProjectSigningKey(ctx, s.projectID, domain.SigningKeyPurposeToken, algorithm)
	if err != nil {
		return nil, nil, err
	}
	kek, err := s.wrappingKey(ctx, key)
	if err != nil {
		return nil, nil, err
	}
	return key, kek, nil
}

// wrappingKey is the key that wraps key: the project's KEK.
func (s *Server) wrappingKey(ctx context.Context, key *domain.SigningKey) (crypto.Crypter, error) {
	header, err := domain.DecodeJWEHeader(key.Key)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to decode signing key")
	}
	return s.keys.GetCrypter(ctx, header.KeyID, header.EncryptionAlgorithm)
}

// publicJWK is key's public half, unwrapped and parsed once per key: parsing
// an RSA key takes a tenth of a millisecond and more, and Verify runs on
// every request a person's token carries. A key's material never changes,
// so an entry never goes stale.
func (s *Server) publicJWK(ctx context.Context, key *domain.SigningKey) (jose.JSONWebKey, error) {
	if public, ok := s.publicJWKs.Load(key.ID); ok {
		return public.(jose.JSONWebKey), nil
	}
	kek, err := s.wrappingKey(ctx, key)
	if err != nil {
		return jose.JSONWebKey{}, err
	}
	public, err := key.PublicJWK(kek)
	if err != nil {
		return jose.JSONWebKey{}, err
	}
	s.publicJWKs.Store(key.ID, public)
	return public, nil
}

// publicKeys is the JWKS: the public half of each active key a token may be
// signed with. RS256's is always there (ADR 082 §7), minted before the first
// token if need be, so a verifier that fetched the set early knows it;
// ES256's joins once an API chose it. The EdDSA key a project is created
// with signs no token here, so the set leaves it out.
func (s *Server) publicKeys(ctx context.Context) (jose.JSONWebKeySet, error) {
	if _, err := s.keys.EnsureProjectSigningKey(ctx, s.projectID, domain.SigningKeyPurposeToken, defaultSigningAlgorithm); err != nil {
		return jose.JSONWebKeySet{}, err
	}
	keys, err := s.keys.ListProjectSigningKeys(ctx, s.projectID, domain.SigningKeyPurposeToken)
	if err != nil {
		return jose.JSONWebKeySet{}, err
	}
	set := jose.JSONWebKeySet{Keys: make([]jose.JSONWebKey, 0, len(keys))}
	for _, key := range keys {
		if !slices.Contains(apiSigningAlgorithms, key.Algorithm) {
			continue
		}
		public, err := s.publicJWK(ctx, key)
		if err != nil {
			return jose.JSONWebKeySet{}, err
		}
		set.Keys = append(set.Keys, public)
	}
	return set, nil
}

// mintAccessToken signs an access token for one API.
func (s *Server) mintAccessToken(ctx context.Context, subject, clientID string, api domain.AppAPI, scope []string) (string, time.Time, error) {
	algorithm := signingAlgorithm(api)
	if !slices.Contains(apiSigningAlgorithms, algorithm) {
		return "", time.Time{}, domain.ErrInternal(nil).WithMessage("the API's signing algorithm is not supported").
			WithDetails(map[string]any{"algorithm": algorithm})
	}
	key, kek, err := s.signingKey(ctx, algorithm)
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
// active key for the token's algorithm, `typ`, issuer, audience and lifetime. A token it refuses is
// domain.ErrInvalidToken; a key store failure is passed on, so an outage is
// never answered as a dead token.
func (s *Server) Verify(ctx context.Context, raw, audience string) (*VerifiedToken, error) {
	signed, err := jose.ParseSigned(raw, apiSigningAlgorithms)
	if err != nil || len(signed.Signatures) != 1 {
		return nil, domain.ErrInvalidToken().WithDetails("not a signed token")
	}
	header := signed.Signatures[0].Protected
	if typ, _ := header.ExtraHeaders[jose.HeaderType].(string); !strings.EqualFold(typ, accessTokenType) {
		return nil, domain.ErrInvalidToken().WithDetails("not an access token")
	}
	// A project holds one active key per algorithm, so the token's algorithm
	// names the key that must have signed it. Nothing rotates a key yet, so
	// there is no retired one to accept (ADR 039 decides how long one stays).
	key, err := s.keys.GetProjectSigningKey(ctx, s.projectID, domain.SigningKeyPurposeToken, jose.SignatureAlgorithm(header.Algorithm))
	if err != nil {
		if errors.Is(err, domain.ErrSigningKeyNotFound()) {
			return nil, domain.ErrInvalidToken().WithDetails("unknown key")
		}
		return nil, err
	}
	if header.KeyID != key.ID {
		return nil, domain.ErrInvalidToken().WithDetails("unknown key")
	}
	public, err := s.publicJWK(ctx, key)
	if err != nil {
		return nil, err
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
	api, _ := s.api(PlatformAPISlug)
	return s.Verify(ctx, raw, api.Identifier)
}
