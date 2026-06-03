package tokengen

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/go-jose/go-jose/v4"
	pkgerrs "github.com/pkg/errors"
	"github.com/zitadel/nextgen/internal/domain"
)

func NewJWTGenerator(
	signer jose.Signer,
	supportedSigAlgs []jose.SignatureAlgorithm,
	webkey jose.JSONWebKey,
) *JWTGenerator {
	return &JWTGenerator{
		signer:           signer,
		supportedSigAlgs: supportedSigAlgs,
		webkey:           webkey,
	}
}

type JWTGenerator struct {
	signer           jose.Signer
	supportedSigAlgs []jose.SignatureAlgorithm
	webkey           jose.JSONWebKey
}

func (g *JWTGenerator) Generate(data *domain.Token) (string, error) {
	payload, err := json.Marshal(data)
	if err != nil {
		return "", pkgerrs.Wrap(err, "failed to marshal token payload")
	}

	signed, err := g.signer.Sign(payload)
	if err != nil {
		return "", pkgerrs.Wrap(err, "failed to sign token payload")
	}

	token, err := signed.CompactSerialize()
	if err != nil {
		return "", pkgerrs.Wrap(err, "failed to serialize token")
	}
	return token, nil
}

func (g *JWTGenerator) Verify(token string) (*domain.Token, error) {
	jws, err := jose.ParseSigned(token, g.supportedSigAlgs)
	if err != nil {
		if _, isUnexpected := errors.AsType[*jose.ErrUnexpectedSignatureAlgorithm](err); isUnexpected ||
			errors.Is(err, jose.ErrUnsupportedAlgorithm) {
			return nil, pkgerrs.Wrap(err, "signature algorithm is not supported")
		}
		return nil, pkgerrs.Wrap(err, "failed to parse signed token")
	}
	if len(jws.Signatures) == 0 {
		return nil, fmt.Errorf("signature is missing from token")
	}
	if len(jws.Signatures) > 1 {
		return nil, fmt.Errorf("multiple signatures on token")
	}

	signedPayload, err := jws.Verify(g.webkey)
	if err != nil {
		return nil, pkgerrs.Wrap(err, "failed to verify signature")
	}

	payload := new(domain.Token)
	err = json.Unmarshal(signedPayload, payload)
	if err != nil {
		return nil, pkgerrs.Wrap(err, "failed to unmarshal token payload")
	}

	return payload, nil
}
