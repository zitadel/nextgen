package domain

import (
	"net/url"
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
			ID:              []byte(pkey.CredentialID),
			PublicKey:       pkey.PublicKey,
			AttestationType: gu.Value(pkey.AttestationType),
			Authenticator: webauthn.Authenticator{
				AAGUID:    pkey.AAGUID,
				SignCount: uint32(pkey.SignCount),
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
		RPID:      rpID,
		RPOrigins: rpOrigins,
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
