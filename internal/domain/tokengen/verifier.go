package tokengen

import (
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
)

type AnyTokenTypeVerifier struct {
	jwtVerifier    *JWTGenerator
	opaqueVerifier *OpaqueTokenGenerator
}

func NewAnyTokenTypeVerifier(
	jwtVerifier *JWTGenerator,
	opaqueVerifier *OpaqueTokenGenerator,
) *AnyTokenTypeVerifier {
	return &AnyTokenTypeVerifier{
		jwtVerifier:    jwtVerifier,
		opaqueVerifier: opaqueVerifier,
	}
}

func (v *AnyTokenTypeVerifier) Verify(token string) (payload *domain.Token, err error) {
	var verifiers []domain.TokenVerifier

	if strings.HasPrefix(token, "ey") {
		// encoding `{"` as base64 starts with `ey`. If  the token starts with it, we prioritize jwt
		verifiers = []domain.TokenVerifier{v.jwtVerifier, v.opaqueVerifier}
	} else {
		// otherwise prioritize according to performance
		verifiers = []domain.TokenVerifier{v.opaqueVerifier, v.jwtVerifier}
	}

	var errs []error
	for _, verifier := range verifiers {
		payload, err := verifier.Verify(token)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		return payload, nil
	}

	// TODO do something with all the errors

	return nil, fmt.Errorf("failed to verify token")
}
