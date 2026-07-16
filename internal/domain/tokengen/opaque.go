package tokengen

import (
	"context"
	"encoding/json"

	"github.com/pkg/errors"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func NewOpaqueTokenGenerator(
	crypter crypto.Crypter,
) *OpaqueTokenGenerator {
	return &OpaqueTokenGenerator{
		crypter: crypter,
	}
}

type OpaqueTokenGenerator struct {
	crypter crypto.Crypter
}

func (g *OpaqueTokenGenerator) Generate(data *domain.Token) (string, error) {
	payload, err := json.Marshal(data)
	if err != nil {
		return "", errors.Wrap(err, "failed to serialize token payload")
	}

	token, err := g.crypter.Encrypt(string(payload))
	if err != nil {
		return "", errors.Wrap(err, "failed to encrypt token payload")
	}

	return token, nil
}

func (g *OpaqueTokenGenerator) Verify(token string) (*domain.Token, error) {
	decrypted, err := g.crypter.Decrypt(token)
	if err != nil {
		return nil, errors.Wrap(err, "failed to decrypt token")
	}

	payload := new(domain.Token)
	err = json.Unmarshal([]byte(decrypted), payload)
	if err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal token payload")
	}

	return payload, nil
}

type OpaqueTokenGeneratorCreator struct {
	keys *service.KeyService
}

func NewOpaqueTokenGeneratorCreator(
	keys *service.KeyService,
) *OpaqueTokenGeneratorCreator {
	return &OpaqueTokenGeneratorCreator{
		keys: keys,
	}
}

func (c *OpaqueTokenGeneratorCreator) Create(ctx context.Context, projectID string) (domain.TokenGenerator, error) {
	crypter, err := c.keys.GetProjectDEKCrypter(ctx, service.GetProjectDEKInput{ProjectID: projectID})
	if err != nil {
		return nil, err
	}
	return NewOpaqueTokenGenerator(crypter), nil
}
