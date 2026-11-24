package domain

// ChoosesPassword reports whether a password field under purpose asks the
// user to choose a password, so the project's policy bounds it. Signing in
// verifies a password the user has, which may predate a stricter policy; an
// unlisted purpose does neither.
func ChoosesPassword(purpose FlowDefinitionPurpose) bool {
	return passwordPurposes[purpose].chooses
}
