package domain

import "time"

// UserPasswordUpdate is one typed mid-lifecycle change for user_passwords rows.
// Callers must pass pointers (e.g. &UserPasswordEncodedHashUpdate{...}).
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
	Delta int16
}

func (*UserPasswordIncrementFailedAttemptsUpdate) userPasswordUpdate() {}

type UserPasswordResetFailedAttemptsUpdate struct{}

func (*UserPasswordResetFailedAttemptsUpdate) userPasswordUpdate() {}
