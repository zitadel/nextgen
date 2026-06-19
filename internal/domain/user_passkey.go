package domain

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/muhlemmer/gu"
)

type PasskeyVerification struct {
	CredentialID   []byte
	SignCount      uint32
	UserVerified   bool
	BackupEligible bool
	BackupState    bool
	UserID         string
}

// PasskeyCeremony holds ephemeral WebAuthn ceremony state between issue and
// verify. SessionData is the serialized webauthn.SessionData go-webauthn needs
// to validate the client response. clientOptions is the serialized
// PublicKeyCredentialRequestOptions or PublicKeyCredentialCreationOptions the
// browser passes to navigator.credentials; it is kept in memory at issue time
// only and is not persisted. RPOrigins is ceremony metadata not carried in
// SessionData but required to build webauthn.Config on verify.
type PasskeyCeremony struct {
	SessionData   json.RawMessage `json:"session_data"`
	clientOptions json.RawMessage
	RPOrigins     []url.URL `json:"rp_origins"`
}

// ClientOptions returns the serialized WebAuthn options for the browser. The
// value is available only on the in-memory ceremony returned from an issue
// call; it is not stored when the ceremony is JSON-marshaled for persistence.
func (c *PasskeyCeremony) ClientOptions() []byte {
	if c == nil {
		return nil
	}
	return c.clientOptions
}

// CreatePasskeyChallenge starts a WebAuthn authentication ceremony and returns
// the persisted challenge state. When keys are empty, the challenge is discoverable
// (usernameless); otherwise it is scoped to the given user.
func CreatePasskeyChallenge(id string, keys []*UserPasskey, verification string, rpID string, origins []url.URL) (*PasskeyCeremony, error) {
	w, err := webAuthNConfig(rpID, origins...)
	if err != nil {
		return nil, ErrInternal(err)
	}
	opts := make([]webauthn.LoginOption, 0)
	if verification != "" {
		opts = append(opts, webauthn.WithUserVerification(protocol.UserVerificationRequirement(verification)))
	}

	var (
		assertion   *protocol.CredentialAssertion
		sessionData *webauthn.SessionData
	)
	if len(keys) == 0 {
		assertion, sessionData, err = w.BeginDiscoverableLogin(opts...)
	} else {
		user := &webAuthNUser{
			userID: id,
			creds:  PasskeysToCredentials(keys),
		}
		assertion, sessionData, err = w.BeginLogin(user, opts...)
	}
	if err != nil {
		return nil, ErrInternal(err)
	}
	if assertion == nil {
		return nil, ErrInternal(nil)
	}
	return newPasskeyCeremony(sessionData, assertion.Response, origins)
}

// VerifyPasskeyChallenge validates an assertion against a challenge created by
// [CreatePasskeyChallenge]. userID is empty for discoverable login; the user is
// resolved from the assertion user handle via lookup when needed.
func VerifyPasskeyChallenge(ceremony *PasskeyCeremony, response []byte, userID string, passkeys []*UserPasskey, lookup func(userID string) ([]*UserPasskey, error)) (*PasskeyVerification, error) {
	session, rpID, err := ceremony.loginSession()
	if err != nil {
		return nil, err
	}
	w, err := webAuthNConfig(rpID, ceremony.RPOrigins...)
	if err != nil {
		return nil, ErrInternal(err)
	}
	parsedResponse, err := protocol.ParseCredentialRequestResponseBytes(response)
	if err != nil {
		return nil, err
	}

	var (
		credential *webauthn.Credential
		user       webauthn.User
	)
	if userID != "" {
		credential, err = w.ValidateLogin(&webAuthNUser{
			userID: userID,
			creds:  PasskeysToCredentials(passkeys),
		}, session, parsedResponse)
	} else {
		disc := webauthn.DiscoverableUserHandler(func(rawID, userHandle []byte) (webauthn.User, error) {
			keys, err := lookup(string(userHandle))
			if err != nil {
				return nil, err
			}
			return &webAuthNUser{
				userID: string(userHandle),
				creds:  PasskeysToCredentials(keys),
			}, nil
		})
		user, credential, err = w.ValidatePasskeyLogin(disc, session, parsedResponse)
	}
	if err != nil {
		return nil, err
	}

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

// CreatePasskeyRegistrationChallenge starts a WebAuthn registration ceremony
// for userID and returns persisted challenge state.
func CreatePasskeyRegistrationChallenge(userID, username, displayName string, existing []*UserPasskey, rpID string, origins []url.URL) (*PasskeyCeremony, error) {
	w, err := webAuthNConfig(rpID, origins...)
	if err != nil {
		return nil, ErrInternal(err)
	}
	user := &webAuthNUser{
		userID:      userID,
		username:    username,
		displayName: displayName,
		creds:       PasskeysToCredentials(existing),
	}
	creation, sessionData, err := w.BeginRegistration(user)
	if err != nil {
		return nil, ErrInternal(err)
	}
	if creation == nil {
		return nil, ErrInternal(nil)
	}
	return newPasskeyCeremony(sessionData, creation.Response, origins)
}

// VerifyPasskeyRegistrationChallenge validates an attestation against a
// challenge created by [CreatePasskeyRegistrationChallenge] and returns a
// CreateUserPasskey ready for storage.
func VerifyPasskeyRegistrationChallenge(ceremony *PasskeyCeremony, attestation []byte) (*CreateUserPasskey, error) {
	session, rpID, err := ceremony.loginSession()
	if err != nil {
		return nil, err
	}
	user, err := ceremony.registrationUser()
	if err != nil {
		return nil, err
	}
	w, err := webAuthNConfig(rpID, ceremony.RPOrigins...)
	if err != nil {
		return nil, ErrInternal(err)
	}
	parsedResponse, err := protocol.ParseCredentialCreationResponseBytes(attestation)
	if err != nil {
		return nil, err
	}
	credential, err := w.CreateCredential(user, session, parsedResponse)
	if err != nil {
		return nil, err
	}

	attestationType := credential.AttestationType
	transports := make([]string, len(credential.Transport))
	for i, t := range credential.Transport {
		transports[i] = string(t)
	}
	now := time.Now()
	return &CreateUserPasskey{
		UserID:          string(user.WebAuthnID()),
		CredentialID:    EncodePasskeyCredentialID(credential.ID),
		PublicKey:       credential.PublicKey,
		AAGUID:          credential.Authenticator.AAGUID,
		AttestationType: new(attestationType),
		Transports:      transports,
		SignCount:       int64(credential.Authenticator.SignCount),
		BackupEligible:  credential.Flags.BackupEligible,
		BackupState:     credential.Flags.BackupState,
		VerifiedAt:      &now,
	}, nil
}

func newPasskeyCeremony(session *webauthn.SessionData, clientOptions any, origins []url.URL) (*PasskeyCeremony, error) {
	sessionJSON, err := json.Marshal(session)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to marshal passkey session")
	}
	clientJSON, err := json.Marshal(clientOptions)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to marshal passkey client options")
	}
	originsCopy := append([]url.URL(nil), origins...)
	return &PasskeyCeremony{
		SessionData:   sessionJSON,
		clientOptions: clientJSON,
		RPOrigins:     originsCopy,
	}, nil
}

func (c *PasskeyCeremony) loginSession() (webauthn.SessionData, string, error) {
	if c == nil {
		return webauthn.SessionData{}, "", ErrAuthAttemptInvalidState()
	}
	var session webauthn.SessionData
	if err := json.Unmarshal(c.SessionData, &session); err != nil {
		return webauthn.SessionData{}, "", ErrAuthAttemptInvalidState().WithParent(err)
	}
	if session.RelyingPartyID == "" {
		return webauthn.SessionData{}, "", ErrAuthAttemptInvalidState()
	}
	return session, session.RelyingPartyID, nil
}

func (c *PasskeyCeremony) registrationUser() (*webAuthNUser, error) {
	if c == nil {
		return nil, ErrAuthAttemptInvalidState()
	}
	session, _, err := c.loginSession()
	if err != nil {
		return nil, err
	}
	userID := string(session.UserID)
	username := userID
	displayName := userID
	if optsJSON := c.ClientOptions(); len(optsJSON) > 0 {
		var opts protocol.PublicKeyCredentialCreationOptions
		if err := json.Unmarshal(optsJSON, &opts); err != nil {
			return nil, ErrInternal(err).WithMessage("failed to unmarshal passkey creation options")
		}
		if opts.User.Name != "" {
			username = opts.User.Name
		}
		if opts.User.DisplayName != "" {
			displayName = opts.User.DisplayName
		}
	}
	return &webAuthNUser{
		userID:      userID,
		username:    username,
		displayName: displayName,
	}, nil
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

// WebAuthnName implements [webauthn.User].
func (w *webAuthNUser) WebAuthnName() string {
	return w.username
}

var _ webauthn.User = (*webAuthNUser)(nil)

func PasskeysToCredentials(passkeys []*UserPasskey) []webauthn.Credential {
	creds := make([]webauthn.Credential, 0, len(passkeys))

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
			},
		})
	}

	return creds
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
