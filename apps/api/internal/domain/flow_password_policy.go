package domain

import "context"

// FlowPasswordPolicy reads the password length bounds a project's password
// policy sets, for a step where the user chooses a password. Without a
// policy, or for a bound the policy leaves unset, the minimum is 0 and the
// maximum is [MaxPasswordLength]; the maximum is never above it.
type FlowPasswordPolicy interface {
	PasswordLengthBounds(ctx context.Context, projectID string) (minLength, maxLength int, err error)
}

// choosesPassword reports whether a password field under purpose asks the
// user to choose a password, so the project's policy bounds it. Signing in
// verifies a password the user has, which may predate a stricter policy; an
// unlisted purpose does neither.
func choosesPassword(purpose FlowDefinitionPurpose) bool {
	return passwordPurposes[purpose].chooses
}

// withPasswordBounds sets the policy's length bounds on a password field's
// validation, keeping every other rule it carries.
func withPasswordBounds(v *FlowFieldValidation, minLength, maxLength int) *FlowFieldValidation {
	out := FlowFieldValidation{}
	if v != nil {
		out = *v
	}
	out.MinLength, out.MaxLength = minLength, maxLength
	return &out
}
