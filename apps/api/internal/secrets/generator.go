package secrets

import (
	"crypto/rand"
	"math/big"
)

const (
	SecretKeyPrefix = "sk_"
)

type Generator interface {
	New(prefix string) (string, error)
}

type RandomSecretGenerator struct {
}

func NewRandomSecretGenerator() *RandomSecretGenerator {
	return &RandomSecretGenerator{}
}

func (g *RandomSecretGenerator) New(prefix string) (string, error) {
	s, err := generateRandomString(32)
	if err != nil {
		return "", err
	}
	return SecretKeyPrefix + prefix + "_" + s, nil
}

func generateRandomString(n int) (string, error) {
	const letters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	ret := make([]byte, n)
	for i := 0; i < n; i++ {
		num, err := rand.Int(rand.Reader, big.NewInt(int64(len(letters))))
		if err != nil {
			return "", err
		}
		ret[i] = letters[num.Int64()]
	}

	return string(ret), nil
}
