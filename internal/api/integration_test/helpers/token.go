package helpers

import (
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/nextgen/internal/domain/tokengen"
)

func (h *Harness) EnsureJWTGenerator(t *testing.T) *tokengen.JWTGenerator {
	t.Helper()
	if h.JWTGenerator == nil {
		h.JWTGenerator = tokengen.NewJWTGenerator(
			h.EnsureJoseSigner(t),
			[]jose.SignatureAlgorithm{jose.RS256},
			jose.JSONWebKey{
				Key:       h.EnsureSigningKey(t),
				Algorithm: string(jose.RS256),
				Use:       "sig",
			},
		)
	}
	return h.JWTGenerator
}

func (h *Harness) EnsureOpaqueTokenGenerator(t *testing.T) *tokengen.OpaqueTokenGenerator {
	t.Helper()
	if h.OpaqueTokenGenerator == nil {
		h.OpaqueTokenGenerator = tokengen.NewOpaqueTokenGenerator(
			h.EnsureCrypter(t),
		)
	}
	return h.OpaqueTokenGenerator
}

func (h *Harness) EnsureAnyTokenVerifier(t *testing.T) *tokengen.AnyTokenTypeVerifier {
	t.Helper()
	if h.TokenVerifier == nil {
		h.TokenVerifier = tokengen.NewAnyTokenTypeVerifier(
			h.EnsureJWTGenerator(t),
			h.EnsureOpaqueTokenGenerator(t),
		)
	}
	return h.TokenVerifier
}
