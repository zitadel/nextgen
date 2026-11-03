package pow

import "errors"

const Protocol = "zitadel_pow_v1"

type Algorithm string

const DefaultAlgorithm Algorithm = "pbkdf2_sha256"

// Profile is an immutable value from the released registry. Its zero value is
// invalid. New algorithms must add a reviewed definition and client support;
// callers cannot construct profiles with arbitrary KDF parameters.
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

func (p Profile) Algorithm() Algorithm { return DefaultAlgorithm }
func (p Profile) Level() int           { return int(p.level) }
func (p Profile) Iterations() int      { return 5000 }
func (p Profile) MaxTrials() uint32 {
	if p.ID() == "" {
		return 0
	}
	return 256 << p.level
}

// ProfileForLevel resolves only released algorithm/level pairs. Level zero is
// handled by admission as "no puzzle"; it must never mint a zero-cost challenge.
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

// Availability is authoritative operational state, separate from the immutable
// registry. Its zero value fails closed. Admission must recheck it at consumption.
type Availability uint8

const (
	Enabled Availability = iota + 1
	VerifyOnly
	Disabled
)

var (
	ErrUnsupportedProfile = errors.New("pow: unsupported profile or algorithm")
	ErrUnavailableProfile = errors.New("pow: profile unavailable")
	ErrInvalidBinding     = errors.New("pow: invalid authoritative binding")
	ErrInvalidKeys        = errors.New("pow: invalid purpose keys")
	ErrInvalidChallenge   = errors.New("pow: invalid stored challenge")
	ErrInvalidProof       = errors.New("pow: invalid proof")
	ErrBindingMismatch    = errors.New("pow: challenge binding mismatch")
	ErrExpired            = errors.New("pow: challenge expired")
)
