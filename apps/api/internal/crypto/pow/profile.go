package pow

import "errors"

const Protocol = "zitadel_pow_poc_v1"

type Algorithm string

const DefaultAlgorithm Algorithm = "pbkdf2_sha256"

// Profile fixes the POC's KDF parameters and search range. Its zero value is
// invalid. These experimental profiles are not a released compatibility contract.
type Profile struct {
	level uint8
}

func (p Profile) ID() string {
	switch p.level {
	case 1:
		return "pbkdf2_sha256_5000_l1"
	case 2:
		return "pbkdf2_sha256_5000_l2"
	case 3:
		return "pbkdf2_sha256_5000_l3"
	case 4:
		return "pbkdf2_sha256_5000_l4"
	default:
		return ""
	}
}

// DefaultProfile is level one, the only profile the browser solver enables.
func DefaultProfile() Profile { return Profile{level: 1} }

func (p Profile) Algorithm() Algorithm { return DefaultAlgorithm }
func (p Profile) Level() int           { return int(p.level) }
func (p Profile) Iterations() int      { return 5000 }
func (p Profile) MaxTrials() uint32 {
	if p.ID() == "" {
		return 0
	}
	return 256 << p.level
}

// ProfileForLevel accepts only the POC's PBKDF2 levels. Level zero means no
// puzzle and must be handled by the caller, without issuing a challenge.
func ProfileForLevel(algorithm Algorithm, level int) (Profile, error) {
	if algorithm != DefaultAlgorithm || level < 1 || level > 4 {
		return Profile{}, ErrUnsupportedProfile
	}
	return Profile{level: uint8(level)}, nil
}

func LookupProfile(id string) (Profile, error) {
	for level := uint8(1); level <= 4; level++ {
		p := Profile{level: level}
		if p.ID() == id {
			return p, nil
		}
	}
	return Profile{}, ErrUnsupportedProfile
}

var (
	ErrUnsupportedProfile = errors.New("pow: unsupported profile or algorithm")
	ErrInvalidBinding     = errors.New("pow: invalid authoritative binding")
	ErrInvalidKeys        = errors.New("pow: invalid purpose keys")
	ErrInvalidChallenge   = errors.New("pow: invalid stored challenge")
	ErrInvalidProof       = errors.New("pow: invalid proof")
	ErrBindingMismatch    = errors.New("pow: challenge binding mismatch")
	ErrExpired            = errors.New("pow: challenge expired")
)
