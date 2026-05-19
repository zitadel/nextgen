package domain

import (
	"time"
)

type HandoffToken struct {
	EncryptedToken []byte
	expiration     time.Duration
	plainToken     string
}

//func (t *HandoffToken) Decrypt(keyManager *crypto.KeyManager) error {
//	plainToken, err := keyManager.Decrypt(t.EncryptedToken)
//	if err != nil {
//		return ErrInternal(err).WithMessage("failed to decrypt handoff token")
//	}
//	t.plainToken = string(plainToken)
//	return nil
//}

func (t *HandoffToken) Plain() string {
	return t.plainToken
}

func (t *HandoffToken) Expiration(handedOffAt *time.Time) time.Time {
	if handedOffAt == nil {
		return time.Time{}
	}
	return handedOffAt.Add(t.expiration)
}

func newHandoffToken() (*HandoffToken, error) {
	token, err := newID(PrefixHandoffToken)
	if err != nil {
		return nil, err
	}
	//encryptedToken, err := keyManager.Encrypt([]byte(token))
	//if err != nil {
	//	return nil, ErrInternal(err).WithMessage("failed to encrypt handoff token")
	//}
	return &HandoffToken{
		//EncryptedToken: encryptedToken,
		expiration: HandoffTokenExpiration,
		plainToken: token,
	}, nil
}
