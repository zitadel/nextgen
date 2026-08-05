package domain

import "time"

type UserPasswordUpdate interface {
	userPasswordUpdate()
}

type UserPasswordEncodedHashUpdate struct {
	EncodedHash string
}

func (*UserPasswordEncodedHashUpdate) userPasswordUpdate() {}

type UserPasswordChangeRequiredUpdate struct {
	ChangeRequired bool
}

func (*UserPasswordChangeRequiredUpdate) userPasswordUpdate() {}

type UserPasswordChangedAtUpdate struct {
	ChangedAt time.Time
}

func (*UserPasswordChangedAtUpdate) userPasswordUpdate() {}

type UserPasswordVerificationIDUpdate struct {
	VerificationID string
}

func (*UserPasswordVerificationIDUpdate) userPasswordUpdate() {}

type UserPasswordLastSuccessfulCheckUpdate struct {
	LastSuccessfulCheck time.Time
}

func (*UserPasswordLastSuccessfulCheckUpdate) userPasswordUpdate() {}

type UserPasswordIncrementFailedAttemptsUpdate struct {
	Delta uint8
}

func (*UserPasswordIncrementFailedAttemptsUpdate) userPasswordUpdate() {}

type UserPasswordResetFailedAttemptsUpdate struct{}

func (*UserPasswordResetFailedAttemptsUpdate) userPasswordUpdate() {}
