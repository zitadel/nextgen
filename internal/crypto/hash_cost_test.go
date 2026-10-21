package crypto

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHasherConfig_hashMemory(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		cfg  HasherConfig
		want int64
	}{
		{
			name: "argon2id counts its memory parameter, given in KiB",
			cfg:  HasherConfig{Algorithm: HashNameArgon2id, Params: map[string]any{"Time": 1, "Memory": 64 * 1024, "Threads": 1}},
			want: 64 << 20,
		},
		{
			name: "argon2i the same",
			cfg:  HasherConfig{Algorithm: HashNameArgon2i, Params: map[string]any{"Time": 1, "Memory": 8 * 1024, "Threads": 1}},
			want: 8 << 20,
		},
		{
			name: "scrypt is 128 * r * 2^ln",
			cfg:  HasherConfig{Algorithm: HashNameScrypt, Params: map[string]any{"Cost": 15}},
			want: 128 * 8 * (1 << 15),
		},
		{
			name: "bcrypt is not worth counting",
			cfg:  HasherConfig{Algorithm: HashNameBcrypt, Params: map[string]any{"Cost": 12}},
			want: 0,
		},
		{
			name: "parameters that do not decode count nothing; building the hasher reports them",
			cfg:  HasherConfig{Algorithm: HashNameArgon2id, Params: map[string]any{"Time": 1}},
			want: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, tt.cfg.hashMemory())
		})
	}
}

func TestEncodedMemory(t *testing.T) {
	t.Parallel()

	limits := HashLimitsConfig{
		Argon2: Argon2LimitsConfig{MaxMemory: 256 * 1024},
		Scrypt: ScryptLimitsConfig{MaxLN: 18, MaxR: 8},
	}
	tests := []struct {
		name    string
		encoded string
		want    int64
	}{
		{
			name:    "argon2 reads m= in KiB",
			encoded: "$argon2id$v=19$m=65536,t=3,p=4$cmFuZG9tc2FsdGlzaGFyZA$CB0Du96aj3fQVcVSqb0LIA6Z6fpStjzjVkaC3RlpK9A",
			want:    64 << 20,
		},
		{
			name:    "argon2i the same",
			encoded: "$argon2i$v=19$m=4096,t=3,p=1$cmFuZG9tc2FsdGlzaGFyZA$CB0Du96aj3fQVcVSqb0LIA6Z6fpStjzjVkaC3RlpK9A",
			want:    4 << 20,
		},
		{
			name:    "scrypt reads ln= and r=",
			encoded: "$scrypt$ln=16,r=8,p=1$cmFuZG9tc2FsdGlzaGFyZA$Rh+NnJNo1I6nRwaNqbDm6kmADswD1+7FTKZ7Ln9D8nQ",
			want:    128 * 8 * (1 << 16),
		},
		{
			name:    "the linux scrypt prefix the same",
			encoded: "$7$ln=10,r=8,p=1$cmFuZG9tc2FsdGlzaGFyZA$Rh+NnJNo1I6nRwaNqbDm6kmADswD1+7FTKZ7Ln9D8nQ",
			want:    128 * 8 * (1 << 10),
		},
		{
			name:    "an argon2 string without parameters is charged the worst the limits allow",
			encoded: "$argon2id$not-a-hash",
			want:    256 << 20,
		},
		{
			name:    "a negative parameter is not a parameter",
			encoded: "$argon2id$v=19$m=-5,t=3,p=4$salt$hash",
			want:    256 << 20,
		},
		{
			name:    "an scrypt string without parameters is charged the worst the limits allow",
			encoded: "$scrypt$garbage",
			want:    128 * 8 * (1 << 18),
		},
		{
			name:    "bcrypt is not worth counting",
			encoded: "$2y$12$hXUrnqdq1RIIYZ2HPytIIe5lXdIvbhqrTvdPsSF7o.jFh817Z6lwm",
			want:    0,
		},
		{
			name:    "nor is nothing",
			encoded: "",
			want:    0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, encodedMemory(tt.encoded, limits))
		})
	}
}

// A hasher reached through the factory, default or per project, draws on the
// factory's one budget; ValidateHash only parses and takes no slot.
func TestPasswapHasher_sharesTheFactoryLimiter(t *testing.T) {
	t.Parallel()

	cfg := HashConfig{
		Verifiers: []HashName{HashNameArgon2, HashNameBcrypt},
		Hasher: HasherConfig{
			Algorithm: HashNameBcrypt,
			Params:    map[string]any{"Cost": 10},
		},
		Limits: HashLimitsConfig{
			Bcrypt: BcryptLimitsConfig{MinCost: 10, MaxCost: 14},
			Argon2: Argon2LimitsConfig{MinTime: 1, MaxTime: 8, MinMemory: 8 * 1024, MaxMemory: 64 * 1024, MinThreads: 1, MaxThreads: 8},
		},
		Concurrency: HashConcurrencyConfig{MaxOperations: 1, MemoryBudget: 1000},
	}
	factory, err := cfg.NewHasherFactory()
	require.NoError(t, err)
	project, err := factory.New(HasherConfig{
		Algorithm: HashNameArgon2id,
		Params:    map[string]any{"Time": 1, "Memory": 8 * 1024, "Threads": 1},
	})
	require.NoError(t, err)
	assert.Equal(t, int64(8<<20), project.hashMemory)
	assert.Same(t, factory.Default().limiter, project.limiter)

	encoded, err := factory.Default().Hash(t.Context(), "Passw0rd!")
	require.NoError(t, err)

	// Take the whole budget: everything that hashes is now refused at once,
	// whichever hasher it goes through.
	release, err := factory.limiter.acquire(t.Context(), factory.limiter.budget)
	require.NoError(t, err)

	_, err = factory.Default().Hash(t.Context(), "Passw0rd!")
	assert.ErrorIs(t, err, ErrHashingBusy)
	_, err = project.Hash(t.Context(), "Passw0rd!")
	assert.ErrorIs(t, err, ErrHashingBusy)
	assert.ErrorIs(t, factory.Default().VerifyHash(t.Context(), encoded, "Passw0rd!"), ErrHashingBusy)
	assert.ErrorIs(t, project.VerifyHash(t.Context(), encoded, "Passw0rd!"), ErrHashingBusy)
	assert.NoError(t, factory.Default().ValidateHash(encoded), "validation parses and takes no slot")

	release()
	assert.NoError(t, factory.Default().VerifyHash(t.Context(), encoded, "Passw0rd!"))
	assert.ErrorIs(t, project.VerifyHash(t.Context(), encoded, "wrong"), ErrHashMismatch)
}
