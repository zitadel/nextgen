package domain

// UserSearchRange is one designated property of one project whose search
// index a user search reads (ADR 058, ADR 087 §6).
type UserSearchRange struct {
	ProjectID string
	Key       AttributeKey
	// Hits are the users whose value of Key starts with the text, in index
	// order: by matched text, then by user id.
	Hits []UserSearchHit
	// Full says the range held as many rows as the read took, so more users
	// may match.
	Full bool
}

// UserSearchHit is one user a search index range found, and the text of
// theirs that matched.
type UserSearchHit struct {
	UserID      string
	MatchedText string
}
