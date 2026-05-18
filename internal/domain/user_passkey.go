package domain

import (
	"net/url"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

type UserPasskey struct {
	KeyID                        []byte
	PublicKey                    []byte
	AttestationType              string
	AuthenticatorAttestationGUID []byte
	SignCount                    uint32
}

type PasskeyChallenge struct {
	data                 []byte
	Challenge            string
	AllowedCredentialIDs [][]byte
	UserVerification     uint8 // domain.UserVerificationRequirement
	RPID                 string
	RPOrigin             url.URL

	UserID  []byte    `json:"user_id,omitempty" msg:"u,omitempty"`
	Expires time.Time `json:"expires" msg:"exp"`

	Extensions protocol.AuthenticationExtensions       `json:"extensions,omitempty" msg:"exts,omitempty"`
	CredParams []protocol.CredentialParameter          `json:"credParams,omitempty" msg:"params,omitempty"`
	Mediation  protocol.CredentialMediationRequirement `json:"mediation,omitempty" msg:"cmr,omitempty"`
}

type PasskeyVerification struct {
	CredentialID []byte
	SignCount    uint32
	UserVerified bool
	UserID       string
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
	var data any
	opts := make([]webauthn.LoginOption, 0)
	if verification != "" {
		opts = append(opts, webauthn.WithUserVerification(protocol.UserVerificationRequirement(verification)))
	}
	if len(keys) == 0 {
		data, sessionData, err = w.BeginDiscoverableLogin()
	} else {
		user := &webAuthNUser{
			userID: id,
			creds:  PasskeysToCredentials(keys),
		}
		data, sessionData, err = w.BeginLogin(user)
	}
	if err != nil {
		return nil, err
	}
	_ = data
	//data, err := json.Marshal(assertionData)

	return &PasskeyChallenge{
		//data:                 data,
		Challenge:            sessionData.Challenge,
		AllowedCredentialIDs: sessionData.AllowedCredentialIDs,
		//UserVerification:     sessionData.UserVerification,
		RPID: sessionData.RelyingPartyID,
	}, nil // TODO: implement
}

func PasskeysToCredentials(passkeys []*UserPasskey) []webauthn.Credential {
	creds := make([]webauthn.Credential, 0)

	for _, pkey := range passkeys {
		creds = append(creds, webauthn.Credential{
			ID:              pkey.KeyID,
			PublicKey:       pkey.PublicKey,
			AttestationType: pkey.AttestationType,
			Authenticator: webauthn.Authenticator{
				AAGUID:    pkey.AuthenticatorAttestationGUID,
				SignCount: pkey.SignCount,
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
		//UserVerification:     challenge.UserVerification,
		Extensions: nil,
		CredParams: nil,
		Mediation:  "",
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
	w, err := webAuthNConfig(challenge.RPID, challenge.RPOrigin) //TODO: !
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
	var discoveredUser string
	if user != nil {
		discoveredUser = string(user.WebAuthnID())
	}
	return &PasskeyVerification{
		CredentialID: credential.ID,
		SignCount:    credential.Authenticator.SignCount,
		UserVerified: credential.Flags.UserVerified,
		UserID:       discoveredUser,
	}, nil
}
