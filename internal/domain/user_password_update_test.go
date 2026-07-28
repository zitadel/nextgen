package domain_test

import (
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestUserPasswordUpdate_implementsInterface(t *testing.T) {
	t.Parallel()

	var _ domain.UserPasswordUpdate = &domain.UserPasswordEncodedHashUpdate{EncodedHash: "h"}
	var _ domain.UserPasswordUpdate = &domain.UserPasswordChangeRequiredUpdate{ChangeRequired: true}
	var _ domain.UserPasswordUpdate = &domain.UserPasswordChangedAtUpdate{ChangedAt: time.Now()}
	var _ domain.UserPasswordUpdate = &domain.UserPasswordVerificationIDUpdate{VerificationID: "v"}
	var _ domain.UserPasswordUpdate = &domain.UserPasswordLastSuccessfulCheckUpdate{LastSuccessfulCheck: time.Now()}
	var _ domain.UserPasswordUpdate = &domain.UserPasswordIncrementFailedAttemptsUpdate{Delta: 1}
	var _ domain.UserPasswordUpdate = &domain.UserPasswordResetFailedAttemptsUpdate{}
}
