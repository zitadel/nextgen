package crypto

// DefaultHashVerifiers are the verifiers a deployment registers when its
// configuration names none: argon2 and bcrypt, and the legacy formats an
// import may bring, so pre-existing hashes still validate. A successful
// sign-in stores a new hash written by the project's hasher.
func DefaultHashVerifiers() []HashName {
	return []HashName{
		HashNameArgon2,
		HashNameBcrypt,
		HashNameScrypt,
		HashNamePBKDF2,
		HashNameSha2,
		HashNameMd5,
		HashNameMd5Salted,
		HashNamePHPass,
		HashNameDrupal7,
	}
}

// DefaultHashLimits bound what a stored hash may cost when the configuration
// sets no limits: too cheap and it is not protecting anything, too dear and
// reading one back is a denial of service. They apply to hashes arriving from
// an import and to a hashing method a project picks for itself (ADR 029
// §Hashing) -- the deployment says what is acceptable, a project chooses
// inside it. An algorithm left at zero accepts nothing, which is why every
// algorithm with a verifier a project may hash with carries a range. Each
// spans passwap's recommended parameters: bcrypt 12, argon2id t=3/m=64MiB/p=4,
// scrypt ln=15, pbkdf2 290k rounds, sha2 5k rounds.
func DefaultHashLimits() HashLimitsConfig {
	return HashLimitsConfig{
		Bcrypt: BcryptLimitsConfig{MinCost: 10, MaxCost: 16},
		Argon2: Argon2LimitsConfig{
			MinTime: 1, MaxTime: 10,
			MinMemory: 8 * 1024, MaxMemory: 512 * 1024,
			MinThreads: 1, MaxThreads: 16,
		},
		Scrypt: ScryptLimitsConfig{
			MinLN: 12, MaxLN: 20,
			MinR: 8, MaxR: 8,
			MinP: 1, MaxP: 4,
		},
		PBKDF2: PBKDF2LimitsConfig{MinRounds: 100_000, MaxRounds: 5_000_000},
		Sha2: Sha2LimitsConfig{
			MinSha256Rounds: 5_000, MaxSha256Rounds: 1_000_000,
			MinSha512Rounds: 5_000, MaxSha512Rounds: 1_000_000,
		},
	}
}
