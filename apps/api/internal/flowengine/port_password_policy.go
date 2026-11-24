package flowengine

import "context"

// FlowPasswordPolicy reads the password length bounds a project's password
// policy sets, for a step where the user chooses a password. Without a
// policy, or for a bound the policy leaves unset, the minimum is 0 and the
// maximum is [domain.MaxPasswordLength]; the maximum is never above it.
type FlowPasswordPolicy interface {
	PasswordLengthBounds(ctx context.Context, projectID string) (minLength, maxLength int, err error)
}
