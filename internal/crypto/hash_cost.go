package crypto

import (
	"strconv"
	"strings"

	"github.com/zitadel/passwap/argon2"
	"github.com/zitadel/passwap/scrypt"
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

func scryptMemory(ln, r int64) int64 {
	if ln < 0 || ln > 62 {
		return 0
	}
	return 128 * r * (1 << ln)
}

// worstArgon2Memory and worstScryptMemory are the most a stored hash of that
// algorithm may cost under the configured limits: what a hash that names the
// algorithm but cannot be parsed is charged, so an unreadable string cannot
// slip past the budget by being unreadable.
func (l HashLimitsConfig) worstArgon2Memory() int64 {
	return argon2Memory(int64(l.Argon2.MaxMemory))
}

func (l HashLimitsConfig) worstScryptMemory() int64 {
	return scryptMemory(int64(l.Scrypt.MaxLN), int64(l.Scrypt.MaxR))
}

// encodedMemory estimates the bytes verifying encoded allocates, read from the
// cost parameters in the string itself. It never fails: a hash the verifier
// cannot read ends in an error there, and the worst case under limits is what
// it is charged until then.
func encodedMemory(encoded string, limits HashLimitsConfig) int64 {
	switch {
	case strings.HasPrefix(encoded, argon2.Prefix):
		// $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
		if m, ok := encodedParam(encoded, "m="); ok {
			return argon2Memory(m)
		}
		return limits.worstArgon2Memory()
	case strings.HasPrefix(encoded, scrypt.Prefix), strings.HasPrefix(encoded, scrypt.Prefix_Linux):
		// $scrypt$ln=16,r=8,p=1$<salt>$<hash>
		ln, okLN := encodedParam(encoded, "ln=")
		r, okR := encodedParam(encoded, "r=")
		if okLN && okR {
			return scryptMemory(ln, r)
		}
		return limits.worstScryptMemory()
	default:
		return 0
	}
}

// encodedParam reads the integer of the key=value parameter named by prefix
// from a PHC or modular crypt string, where fields are separated by "$" and
// parameters inside a field by ",".
func encodedParam(encoded, prefix string) (int64, bool) {
	for field := range strings.SplitSeq(encoded, "$") {
		for param := range strings.SplitSeq(field, ",") {
			value, ok := strings.CutPrefix(param, prefix)
			if !ok {
				continue
			}
			n, err := strconv.ParseInt(value, 10, 64)
			if err != nil || n < 0 {
				return 0, false
			}
			return n, true
		}
	}
	return 0, false
}
