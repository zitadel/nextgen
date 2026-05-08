package domain

type UserPasskey struct{}

type PasskeyChallenge struct {
	Challenge            string
	AllowedCredentialIDs [][]byte
	UserVerification     uint8 // domain.UserVerificationRequirement
	RPID                 string
}

func CreatePasskeyChallenge(keys []*UserPasskey) (*PasskeyChallenge, error) {
	return &PasskeyChallenge{}, nil // TODO: implement
}

func VerifyPasskeyChallenge(challenge *PasskeyChallenge, response []byte, passkeys []*UserPasskey) (bool, error) {
	return false, nil // TODO: implement
}
