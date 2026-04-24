package domain

type ChallengeTypePassword struct {
	// The value (mostly plaintext) provided by the user.
	Value string
	// Hash read from the database, used to compare with the hash of the provided value.
	Hash []byte
	// Salt is optional, but if provided, it should be used in the hashing process.
	Salt []byte
}

// isChallengeType implements [ChallengeType].
func (c *ChallengeTypePassword) isChallengeType() {}

var _ ChallengeType = (*ChallengeTypePassword)(nil)
