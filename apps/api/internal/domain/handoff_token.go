package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"time"
)

type HandoffToken struct {
	TokenHash  []byte
	plainToken string
}

func (t *HandoffToken) Plain() string {
	return t.plainToken
}

func (t *HandoffToken) ExpiresAt(handedOffAt *time.Time) time.Time {
	if handedOffAt == nil {
		return time.Time{}
	}
	return handedOffAt.Add(HandoffTokenExpiration)
}

func newHandoffToken() (*HandoffToken, error) {
	// generate random token
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to generate handoff token")
	}
	plainToken := PrefixHandoffToken.IDPrefix(base64.RawURLEncoding.EncodeToString(b))
	// hash the token
	hash := sha256.Sum256([]byte(plainToken))
	return &HandoffToken{
		TokenHash:  hash[:],
		plainToken: plainToken,
	}, nil
}
