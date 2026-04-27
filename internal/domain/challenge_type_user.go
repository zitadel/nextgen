package domain

type ChallengeTypeUser struct {
	Identifier UserIdentifier
}

// isChallengeType implements [ChallengeType].
func (c *ChallengeTypeUser) isChallengeType() {}

var _ ChallengeType = (*ChallengeTypeUser)(nil)
