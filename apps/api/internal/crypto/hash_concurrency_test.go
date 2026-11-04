package crypto

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestHashConcurrencyConfig_validate(t *testing.T) {
	t.Parallel()

	assert.Error(t, HashConcurrencyConfig{MaxOperations: -1}.validate())
	assert.Error(t, HashConcurrencyConfig{MemoryBudget: -1}.validate())
	assert.Error(t, HashConcurrencyConfig{MaxWait: -time.Second}.validate())
	assert.NoError(t, HashConcurrencyConfig{}.validate())
}

// The factory is where the configuration is read, so a bound that cannot be
// honoured is reported there, with the rest of the hashing configuration.
func TestHashConfig_NewHasherFactory_rejectsInvalidConcurrency(t *testing.T) {
	t.Parallel()

	cfg := HashConfig{
		Verifiers: []HashName{HashNameBcrypt},
		Hasher:    HasherConfig{Algorithm: HashNameBcrypt, Params: map[string]any{"Cost": 10}},
		Limits:    HashLimitsConfig{Bcrypt: BcryptLimitsConfig{MinCost: 10, MaxCost: 14}},
	}
	_, err := cfg.NewHasherFactory()
	assert.NoError(t, err)

	cfg.Concurrency = HashConcurrencyConfig{MaxWait: -time.Second}
	_, err = cfg.NewHasherFactory()
	assert.ErrorContains(t, err, "password hash config invalid")
	assert.ErrorContains(t, err, "max_wait")
}
