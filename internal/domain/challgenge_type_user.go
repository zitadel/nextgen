package domain

type ChallengeTypeUser struct {
	Identifier UserIdentifier
}

type UserIdentifier struct {
	// Key of the identifier for example:
	// - email
	// - username
	// - phone
	// - idp
	// Not sure if this is needed at all.
	Key string
	// Value of the identifier, for example:
	// - joe@doe.com
	// - joe.doe
	// - +1234567890
	// - idp:google:1234567890
	// the value must be sanitized and normalized before being stored, for example:
	// - email and username should be lowercased and trimmed
	// - phone should be in E.164 format
	// - idp should be in the format of "idp:{provider}:{id}"
	Value string
}

// isChallengeType implements [ChallengeType].
func (c *ChallengeTypeUser) isChallengeType() {}

var _ ChallengeType = (*ChallengeTypeUser)(nil)
