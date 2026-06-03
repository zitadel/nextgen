package secrets

import (
	"crypto/rand"
	"math/big"
)

type Generator interface {
	New() (string, error)
}

type RandomSecretGenerator struct {
}

func NewRandomSecretGenerator() *RandomSecretGenerator {
	return &RandomSecretGenerator{}
}

func (g *RandomSecretGenerator) New() (string, error) {
	return generateRandomString(32)
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
