package flow

// CookieCodec serializes, encrypts, authenticates, and version-checks the
// `_zflow` cookie payload. It enforces integrity and the issued-at +
// max-age window; everything else (session version, step version) is the
// state machine's responsibility.
//
// Wire format: version || nonce || ciphertext || tag, base64url-encoded.
// The leading version byte selects the active key + algorithm so keys
// can rotate without breaking in-flight cookies. Decode accepts current
// and one previous key; Encode uses current only.
type CookieCodec interface {
	Encode(s *State) (cookieValue string, err error)
	Decode(cookieValue string) (*State, error)
}
