package crypto

import (
	"errors"
	"math"

	"github.com/zitadel/passwap/argon2"
	"github.com/zitadel/passwap/scrypt"
	"github.com/zitadel/passwap/verifier"
)

// The memory a hash takes is what decides how many can run side by side: CPU
// time is bounded by the operation count, but a memory-hard hash can be sized
// to hundreds of MiB each, and a handful of those at once is an OOM kill. The
// estimates here feed the limiter's weights. They are deliberately the
// algorithm's own cost formula and nothing more precise: argon2 fills Memory
// KiB, scrypt 128 * r * N bytes (N = 2^ln), and the bcrypt, pbkdf2 and sha2
// family work in a few KiB that the operation floor already covers.

// hashMemory estimates the bytes one hash with this configuration allocates.
// Zero means "nothing worth counting", which the limiter turns into the per
// operation floor.
func (c *HasherConfig) hashMemory() int64 {
	switch c.Algorithm {
	case HashNameArgon2i, HashNameArgon2id:
		p, err := c.argon2Params(argon2.Params{})
		if err != nil {
			return 0
		}
		return argon2Memory(int64(p.Memory))
	case HashNameScrypt:
		p, err := c.scryptParams()
		if err != nil {
			return 0
		}
		return scryptMemory(int64(p.LN), int64(p.R))
	default:
		return 0
	}
}

func argon2Memory(memoryKiB int64) int64 {
	return memoryKiB * 1024
}

// scryptMemory saturates rather than overflows: the limiter clamps any weight
// at the budget anyway.
func scryptMemory(ln, r int64) int64 {
	if ln < 0 || r < 0 {
		return 0
	}
	if ln > 55 || r > math.MaxInt64/(128<<ln) {
		return math.MaxInt64
	}
	return 128 * r * (1 << ln)
}

// worstArgon2Memory and worstScryptMemory are the most a stored hash of that
// algorithm may cost under the configured limits. A hash that names the
// algorithm but cannot be parsed is charged this, so an unreadable string
// cannot slip past the budget by being unreadable; a parseable one is charged
// its own cost, even above the limits, since verification does not enforce
// them.
func (l HashLimitsConfig) worstArgon2Memory() int64 {
	return argon2Memory(int64(l.Argon2.MaxMemory))
}

func (l HashLimitsConfig) worstScryptMemory() int64 {
	return scryptMemory(int64(l.Scrypt.MaxLN), int64(l.Scrypt.MaxR))
}

// encodedMemory estimates the bytes verifying encoded allocates, read from the
// cost parameters in the string itself by the algorithm's own parser. It never
// fails: a string in an algorithm's format that its parser cannot read ends
// in an error at the verifier, and the worst case under limits is what it is
// charged until then. A string in no memory-hard format counts nothing.
func encodedMemory(encoded string, limits HashLimitsConfig) int64 {
	if p, err := argon2.ParseParams(encoded); !errors.Is(err, verifier.ErrNoMatch) {
		if err != nil {
			return limits.worstArgon2Memory()
		}
		return argon2Memory(int64(p.Memory))
	}
	if p, err := scrypt.ParseParams(encoded); !errors.Is(err, verifier.ErrNoMatch) {
		if err != nil || p.LN < 0 || p.R < 0 {
			return limits.worstScryptMemory()
		}
		return scryptMemory(int64(p.LN), int64(p.R))
	}
	return 0
}
