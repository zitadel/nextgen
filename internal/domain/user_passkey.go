package domain

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/muhlemmer/gu"
)

type PasskeyChallenge struct {
	Challenge            string
	AllowedCredentialIDs [][]byte
	// UserVerification mirrors the WebAuthn UserVerificationRequirement enum:
	// "required", "preferred" or "discouraged" (or empty for unset).
	UserVerification string
	RPID             string
	// TODO: RPOrigins must be a subset of the project's allowed origins
	// once a unified project-level origin config (prod + preview) exists.
	RPOrigins []url.URL

	UserID  []byte    `json:"user_id,omitempty" msg:"u,omitempty"`
	Expires time.Time `json:"expires" msg:"exp"`

	Extensions map[string]any               `json:"extensions,omitempty" msg:"exts,omitempty"`
	CredParams []PasskeyCredentialParameter `json:"credParams,omitempty" msg:"params,omitempty"`
	// Mediation mirrors the WebAuthn CredentialMediationRequirement enum.
	Mediation string `json:"mediation,omitempty" msg:"cmr,omitempty"`
}

// PasskeyCredentialParameter mirrors a WebAuthn PublicKeyCredentialParameters
// entry as a plain-Go type so the persisted/transmitted domain model stays
// independent of go-webauthn. JSON shape matches the WebAuthn spec.
type PasskeyCredentialParameter struct {
	Type      string `json:"type"`
	Algorithm int    `json:"alg"`
}

type PasskeyVerification struct {
	CredentialID   []byte
	SignCount      uint32
	UserVerified   bool
	BackupEligible bool
	BackupState    bool
	UserID         string
}

type webAuthNUser struct {
	userID      string
	username    string
	displayName string
	creds       []webauthn.Credential
}

// WebAuthnCredentials implements [webauthn.User].
func (w *webAuthNUser) WebAuthnCredentials() []webauthn.Credential {
	return w.creds
}

// WebAuthnDisplayName implements [webauthn.User].
func (w *webAuthNUser) WebAuthnDisplayName() string {
	return w.displayName
}

// WebAuthnID implements [webauthn.User].
func (w *webAuthNUser) WebAuthnID() []byte {
	return []byte(w.userID)
}

// WebAuthnIcon implements [webauthn.User].
func (w *webAuthNUser) WebAuthnIcon() string {
	return ""
}

// WebAuthnName implements [webauthn.User].
func (w *webAuthNUser) WebAuthnName() string {
	return w.username
}

var _ webauthn.User = (*webAuthNUser)(nil)

func CreatePasskeyChallenge(id string, keys []*UserPasskey, verification string, rpID string, origins []url.URL) (*PasskeyChallenge, error) {
	w, err := webAuthNConfig(rpID, origins...)
	if err != nil {
		return nil, err
	}
	var sessionData *webauthn.SessionData
	opts := make([]webauthn.LoginOption, 0)
	if verification != "" {
		opts = append(opts, webauthn.WithUserVerification(protocol.UserVerificationRequirement(verification)))
	}
	// The discarded first return value is the *protocol.CredentialAssertion — the client-facing
	// "publicKey" options for navigator.credentials.get(). We don't persist it: the API rebuilds
	// the client payload from the typed PasskeyChallenge fields below, and only sessionData is
	// needed server-side to verify the assertion. Caveat: the assertion's `timeout` lives only on
	// CredentialAssertion and is not mirrored on PasskeyChallenge, so it is not forwarded to the
	// client. Add a Timeout field (here + in the API payload) if a server-chosen timeout is wanted.
	if len(keys) == 0 {
		_, sessionData, err = w.BeginDiscoverableLogin(opts...)
	} else {
		user := &webAuthNUser{
			userID: id,
			creds:  PasskeysToCredentials(keys),
		}
		_, sessionData, err = w.BeginLogin(user, opts...)
	}
	if err != nil {
		return nil, err
	}

	return &PasskeyChallenge{
		Challenge:            sessionData.Challenge,
		AllowedCredentialIDs: sessionData.AllowedCredentialIDs,
		UserVerification:     string(sessionData.UserVerification),
		RPID:                 sessionData.RelyingPartyID,
		RPOrigins:            origins,
		UserID:               sessionData.UserID,
		Expires:              sessionData.Expires,
		Extensions:           map[string]any(sessionData.Extensions),
		CredParams:           credParamsFromProtocol(sessionData.CredParams),
		Mediation:            string(sessionData.Mediation),
	}, nil
}

func credParamsFromProtocol(in []protocol.CredentialParameter) []PasskeyCredentialParameter {
	if in == nil {
		return nil
	}
	out := make([]PasskeyCredentialParameter, len(in))
	for i, p := range in {
		out[i] = PasskeyCredentialParameter{Type: string(p.Type), Algorithm: int(p.Algorithm)}
	}
	return out
}

func credParamsToProtocol(in []PasskeyCredentialParameter) []protocol.CredentialParameter {
	if in == nil {
		return nil
	}
	out := make([]protocol.CredentialParameter, len(in))
	for i, p := range in {
		out[i] = protocol.CredentialParameter{
			Type:      protocol.CredentialType(p.Type),
			Algorithm: webauthncose.COSEAlgorithmIdentifier(p.Algorithm),
		}
	}
	return out
}

func PasskeysToCredentials(passkeys []*UserPasskey) []webauthn.Credential {
	creds := make([]webauthn.Credential, 0)

	for _, pkey := range passkeys {
		creds = append(creds, webauthn.Credential{
			ID:              decodeCredentialID(pkey.CredentialID),
			PublicKey:       pkey.PublicKey,
			AttestationType: gu.Value(pkey.AttestationType),
			Authenticator: webauthn.Authenticator{
				AAGUID:    pkey.AAGUID,
				SignCount: uint32(pkey.SignCount),
			},
			Flags: webauthn.CredentialFlags{
				BackupEligible: pkey.BackupEligible,
				BackupState:    pkey.BackupState,
				// TODO: what to do with the missing flags
				//UserPresent:    false,
				//UserVerified:   false,
			},
		})
	}

	return creds
}

func sessionDataFromChallenge(challenge *PasskeyChallenge) webauthn.SessionData {
	return webauthn.SessionData{
		Challenge:            challenge.Challenge,
		RelyingPartyID:       challenge.RPID,
		UserID:               challenge.UserID,
		AllowedCredentialIDs: challenge.AllowedCredentialIDs,
		Expires:              challenge.Expires,
		UserVerification:     protocol.UserVerificationRequirement(challenge.UserVerification),
		Extensions:           protocol.AuthenticationExtensions(challenge.Extensions),
		CredParams:           credParamsToProtocol(challenge.CredParams),
		Mediation:            protocol.CredentialMediationRequirement(challenge.Mediation),
	}
}

func webAuthNConfig(rpID string, origins ...url.URL) (*webauthn.WebAuthn, error) {
	rpOrigins := make([]string, len(origins))
	for i, origin := range origins {
		rpOrigins[i] = origin.String()
	}
	c := &webauthn.Config{
		RPID:          rpID,
		RPDisplayName: rpID, // display name required for BeginRegistration; RPID is a valid default
		RPOrigins:     rpOrigins,
	}
	return webauthn.New(c)
}

func VerifyPasskeyChallenge(challenge *PasskeyChallenge, response []byte, userID string, passkeys []*UserPasskey, passkey func(userID string) ([]*UserPasskey, error)) (*PasskeyVerification, error) {
	w, err := webAuthNConfig(challenge.RPID, challenge.RPOrigins...)
	if err != nil {
		return nil, err
	}
	parsedResponse, err := protocol.ParseCredentialRequestResponseBytes(response)
	if err != nil {
		return nil, err
	}
	var credential *webauthn.Credential
	var user webauthn.User
	if userID != "" {
		credential, err = w.ValidateLogin(&webAuthNUser{
			userID:      userID,
			username:    "",
			displayName: "",
			creds:       PasskeysToCredentials(passkeys),
		}, sessionDataFromChallenge(challenge), parsedResponse)
	} else {
		disc := webauthn.DiscoverableUserHandler(func(rawID, userHandle []byte) (user webauthn.User, err error) {
			passkeys, err := passkey(string(userHandle))
			if err != nil {
				return nil, err
			}
			return &webAuthNUser{
				userID:      string(userHandle),
				username:    "",
				displayName: "",
				creds:       PasskeysToCredentials(passkeys),
			}, nil
		})
		user, credential, err = w.ValidatePasskeyLogin(disc, sessionDataFromChallenge(challenge), parsedResponse)
	}
	if err != nil {
		return nil, err
	}
	// For an identified login the user is already known; for a discoverable login it is
	// resolved from the authenticator's user handle during validation.
	discoveredUser := userID
	if user != nil {
		discoveredUser = string(user.WebAuthnID())
	}
	return &PasskeyVerification{
		CredentialID:   credential.ID,
		SignCount:      credential.Authenticator.SignCount,
		UserVerified:   credential.Flags.UserVerified,
		BackupEligible: credential.Flags.BackupEligible,
		BackupState:    credential.Flags.BackupState,
		UserID:         discoveredUser,
	}, nil
}

// PasskeyRegistrationChallenge holds server-side state for a BeginRegistration call.
// It must be persisted between the issue and verify legs of the registration ceremony.
type PasskeyRegistrationChallenge struct {
	Challenge   string
	RPID        string
	RPOrigins   []url.URL
	UserID      string
	Username    string
	DisplayName string
	ExcludeIDs  [][]byte // existing credential IDs excluded from this registration
	Expires     time.Time
	CredParams  []protocol.CredentialParameter
	Extensions  protocol.AuthenticationExtensions
}

// CreatePasskeyRegistrationChallenge calls webauthn.BeginRegistration and maps
// the returned SessionData to a PasskeyRegistrationChallenge.
func CreatePasskeyRegistrationChallenge(userID, username, displayName string, existing []*UserPasskey, rpID string, origins []url.URL) (*PasskeyRegistrationChallenge, error) {
	w, err := webAuthNConfig(rpID, origins...)
	if err != nil {
		return nil, err
	}
	user := &webAuthNUser{
		userID:      userID,
		username:    username,
		displayName: displayName,
		creds:       PasskeysToCredentials(existing),
	}
	_, sessionData, err := w.BeginRegistration(user)
	if err != nil {
		return nil, err
	}
	excludeIDs := make([][]byte, len(existing))
	for i, pk := range existing {
		excludeIDs[i] = decodeCredentialID(pk.CredentialID)
	}
	return &PasskeyRegistrationChallenge{
		Challenge:   sessionData.Challenge,
		RPID:        sessionData.RelyingPartyID,
		RPOrigins:   origins,
		UserID:      userID,
		Username:    username,
		DisplayName: displayName,
		ExcludeIDs:  excludeIDs,
		Expires:     sessionData.Expires,
		CredParams:  sessionData.CredParams,
		Extensions:  sessionData.Extensions,
	}, nil
}

// VerifyPasskeyRegistration parses the attestation response and calls
// webauthn.CreateCredential. Returns a CreateUserPasskey ready for storage.
// CredentialID is base64url-encoded to ensure valid UTF-8 in the TEXT column
// (valid for both Postgres and Spanner).
//
// name labels the new credential in passkey management surfaces. It is the
// caller's if supplied, otherwise derived from the credential — see
// [PasskeyCredentialName].
func VerifyPasskeyRegistration(challenge *PasskeyRegistrationChallenge, attestation []byte, name string) (*CreateUserPasskey, error) {
	w, err := webAuthNConfig(challenge.RPID, challenge.RPOrigins...)
	if err != nil {
		return nil, err
	}
	parsedResponse, err := protocol.ParseCredentialCreationResponseBytes(attestation)
	if err != nil {
		return nil, err
	}
	user := &webAuthNUser{
		userID:      challenge.UserID,
		username:    challenge.Username,
		displayName: challenge.DisplayName,
	}
	credential, err := w.CreateCredential(user, registrationSessionData(challenge), parsedResponse)
	if err != nil {
		return nil, err
	}
	attestationType := credential.AttestationType
	transports := make([]string, len(credential.Transport))
	for i, t := range credential.Transport {
		transports[i] = string(t)
	}
	now := time.Now()
	if name = strings.TrimSpace(name); name == "" {
		name = GeneratePasskeyCredentialName(transports, credential.Flags.BackupEligible)
	}
	return &CreateUserPasskey{
		UserID:          challenge.UserID,
		CredentialID:    EncodePasskeyCredentialID(credential.ID),
		PublicKey:       credential.PublicKey,
		AAGUID:          credential.Authenticator.AAGUID,
		AttestationType: &attestationType,
		Transports:      transports,
		SignCount:       int64(credential.Authenticator.SignCount),
		UserVerified:    credential.Flags.UserVerified,
		BackupEligible:  credential.Flags.BackupEligible,
		BackupState:     credential.Flags.BackupState,
		Name:            name,
		VerifiedAt:      &now,
	}, nil
}

// Fallback passkey names, used when registration carries no caller-supplied
// name. WebAuthn reports no human-readable label for the authenticator, so the
// fallback describes the credential itself.
const (
	PasskeyNameSecurityKey = "Security key"
	PasskeyNameSynced      = "Synced passkey"
	PasskeyNameDeviceBound = "Device-bound passkey"
)

// PasskeyCredentialName returns the name stored for a registered credential.
// A caller-supplied name always wins; otherwise the name is derived from the
// credential's transports and backup eligibility. It never returns an empty
// string: the passkey list is a user-facing management surface, so every
// credential needs something displayable — the user's display name is not a
// candidate, since it is identical for every credential they register.
func GeneratePasskeyCredentialName(transports []string, backupEligible bool) string {
	for _, t := range transports {
		switch protocol.AuthenticatorTransport(t) {
		case protocol.USB, protocol.NFC, protocol.BLE:
			return PasskeyNameSecurityKey
		}
	}
	// A backup-eligible credential is a multi-device credential: the
	// authenticator may sync it to the user's other devices.
	if backupEligible {
		return PasskeyNameSynced
	}
	return PasskeyNameDeviceBound
}

// registrationSessionData reconstructs a webauthn.SessionData from a stored
// PasskeyRegistrationChallenge for use with CreateCredential.
func registrationSessionData(c *PasskeyRegistrationChallenge) webauthn.SessionData {
	return webauthn.SessionData{
		Challenge:      c.Challenge,
		RelyingPartyID: c.RPID,
		UserID:         []byte(c.UserID),
		Expires:        c.Expires,
		CredParams:     c.CredParams,
		Extensions:     c.Extensions,
	}
}

// EncodePasskeyCredentialID returns the storage form for WebAuthn credential IDs.
// Credential IDs are arbitrary bytes, so TEXT database columns must store an
// ASCII-safe representation.
func EncodePasskeyCredentialID(id []byte) string {
	return base64.RawURLEncoding.EncodeToString(id)
}

// decodeCredentialID reverses the base64url encoding used when storing a
// credential ID. Falls back to a raw byte cast for legacy ASCII test fixtures.
func decodeCredentialID(s string) []byte {
	decoded, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return []byte(s)
	}
	return decoded
}

// BuildPasskeyRequestOptions renders the stored passkey challenge as the
// WebAuthn PublicKeyCredentialRequestOptions JSON (wrapped in the standard
// `{"publicKey": ...}` envelope) that the browser passes to
// navigator.credentials.get(). It reconstructs the options from the persisted
// challenge fields rather than the discarded ceremony output (see
// CreatePasskeyChallenge), so the flow engine and the auth-attempt REST API can
// share one mapping.
func BuildPasskeyRequestOptions(c *AuthChallengePasskey) ([]byte, error) {
	challenge, err := base64.RawURLEncoding.DecodeString(c.Challenge)
	if err != nil {
		return nil, err
	}
	allowed := make([]protocol.CredentialDescriptor, 0, len(c.AllowedCredentialIDs))
	for _, id := range c.AllowedCredentialIDs {
		allowed = append(allowed, protocol.CredentialDescriptor{
			Type:         protocol.PublicKeyCredentialType,
			CredentialID: protocol.URLEncodedBase64(id),
		})
	}
	assertion := protocol.PublicKeyCredentialRequestOptions{
		Challenge:          protocol.URLEncodedBase64(challenge),
		RelyingPartyID:     c.RPID,
		AllowedCredentials: allowed,
		UserVerification:   protocol.UserVerificationRequirement(c.UserVerification),
		Extensions:         c.Extensions,
	}
	return json.Marshal(assertion)
}

// BuildPasskeyCreationOptions renders the stored registration challenge as the
// WebAuthn PublicKeyCredentialCreationOptions JSON the browser passes to
// navigator.credentials.create(). Mirrors BuildPasskeyRequestOptions for the
// registration ceremony.
func BuildPasskeyCreationOptions(c *AuthChallengePasskeyRegistration) ([]byte, error) {
	challenge, err := base64.RawURLEncoding.DecodeString(c.Challenge)
	if err != nil {
		return nil, err
	}
	excluded := make([]protocol.CredentialDescriptor, 0, len(c.ExcludeIDs))
	for _, id := range c.ExcludeIDs {
		excluded = append(excluded, protocol.CredentialDescriptor{
			Type:         protocol.PublicKeyCredentialType,
			CredentialID: protocol.URLEncodedBase64(id),
		})
	}
	opts := protocol.PublicKeyCredentialCreationOptions{
		RelyingParty: protocol.RelyingPartyEntity{
			CredentialEntity: protocol.CredentialEntity{Name: c.RPID},
			ID:               c.RPID,
		},
		User: protocol.UserEntity{
			CredentialEntity: protocol.CredentialEntity{Name: c.Username},
			DisplayName:      c.DisplayName,
			ID:               protocol.URLEncodedBase64([]byte(c.UserID)),
		},
		Challenge:             protocol.URLEncodedBase64(challenge),
		Parameters:            c.CredParams,
		CredentialExcludeList: excluded,
		Attestation:           protocol.PreferNoAttestation,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementRequired,
			UserVerification: protocol.VerificationPreferred,
		},
		Extensions: c.Extensions,
	}
	return json.Marshal(opts)
}
