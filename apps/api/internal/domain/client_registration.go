package domain

import (
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// PrefixClientRegistration namespaces clients that registered themselves
// through dynamic client registration (RFC 7591). The id is the client_id:
// the server mints it ("dcr_01KWH3B..."), and nothing else names the client.
const PrefixClientRegistration ResourcePrefix = "dcr"

// ClientRegistrationLifetime is how long a registration lives before a
// consent has to name it. POST /register is unauthenticated, so a
// registration nobody consented to goes; an hour covers the browser round
// trip of the authorization that follows it.
const ClientRegistrationLifetime = time.Hour

// MaxClientRegistrationRedirectURIs bounds what one registration may list.
const MaxClientRegistrationRedirectURIs = 10

const (
	maxClientRegistrationText = 256
	maxClientRegistrationURI  = 2048
)

// ErrClientRegistrationNotFound reports a client_id no registration holds:
// never registered, purged after its lifetime, or deleted.
func ErrClientRegistrationNotFound() Error {
	return newError(PrefixApp.ErrorCodePrefix("client_registration_not_found"), "app: no registered client has the client_id", nil, nil)
}

// ErrClientRegistrationInvalid refuses metadata a client may not register
// with. details lists each violation with the path of the field. The
// authorization server answers invalid_redirect_uri for a path under
// /redirect_uris and invalid_client_metadata otherwise (RFC 7591 §3.2.2).
func ErrClientRegistrationInvalid(details any) Error {
	return newError(PrefixApp.ErrorCodePrefix("client_registration_invalid"), "app: the client metadata is invalid", details, nil)
}

// ClientRegistrationMetadata is what a client says about itself when it
// registers (RFC 7591 §2), as the server keeps it: where a browser may be
// sent, how the client authenticates, and the display fields. The consent
// step shows those as the client's own claims, beside the redirect host,
// which is the one part the server checked.
type ClientRegistrationMetadata struct {
	ClientName      string           `json:"client_name,omitempty"`
	ClientURI       string           `json:"client_uri,omitempty"`
	LogoURI         string           `json:"logo_uri,omitempty"`
	PolicyURI       string           `json:"policy_uri,omitempty"`
	TOSURI          string           `json:"tos_uri,omitempty"`
	SoftwareID      string           `json:"software_id,omitempty"`
	SoftwareVersion string           `json:"software_version,omitempty"`
	RedirectURIs    []string         `json:"redirect_uris"`
	GrantTypes      []GrantType      `json:"grant_types"`
	AuthMethod      ClientAuthMethod `json:"token_endpoint_auth_method"`
}

// ClientRegistration is a client that registered itself. It belongs to the
// project, not to an app: the app is the one whose API a request names, and
// that app must open dynamic registration (AccessTo). It is transient data,
// purged once past ExpiresAt unless a live consent names it.
type ClientRegistration struct {
	ProjectID string
	// ID is the client_id.
	ID       string
	Metadata ClientRegistrationMetadata
	// SecretHash is "sha256:<hex>" of the secret the server generated for a
	// registration that authenticates with one, and empty otherwise.
	SecretHash string
	CreatedAt  time.Time
	// ExpiresAt is the earliest the registration may be purged: past it, the
	// registration goes unless a live consent names it, and one that a
	// consent names is checked again a lifetime later.
	ExpiresAt time.Time
}

// ClientRegistrationField enumerates the fields of ClientRegistration that
// list operations filter and order by.
type ClientRegistrationField uint8

const (
	ClientRegistrationFieldUnspecified ClientRegistrationField = iota
	ClientRegistrationFieldProjectID
	ClientRegistrationFieldID
	ClientRegistrationFieldCreatedAt
	ClientRegistrationFieldExpiresAt
)

// WithDefaults fills in what RFC 7591 §2 lets a client leave out: it
// authenticates with none and uses the code and refresh grants.
func (m ClientRegistrationMetadata) WithDefaults() ClientRegistrationMetadata {
	if m.AuthMethod == "" {
		m.AuthMethod = ClientAuthNone
	}
	if len(m.GrantTypes) == 0 {
		m.GrantTypes = []GrantType{GrantAuthorizationCode, GrantRefreshToken}
	}
	return m
}

// ClientType is public for a registration that authenticates with none, and
// confidential for one the server gave a secret.
func (m ClientRegistrationMetadata) ClientType() ClientType {
	if m.AuthMethod.UsesSecret() {
		return ClientTypeConfidential
	}
	return ClientTypePublic
}

// HasGrant reports whether the client registered for grant.
func (m ClientRegistrationMetadata) HasGrant(grant GrantType) bool {
	return slices.Contains(m.GrantTypes, grant)
}

// Validate checks metadata after WithDefaults. A registered client acts for
// users only: it authenticates with none or a secret the server generates,
// uses the code grant with refresh, and lists redirect URIs a browser may be
// sent to, as a public or confidential app client's would be. It returns
// ErrClientRegistrationInvalid listing every violation, or nil.
func (m ClientRegistrationMetadata) Validate() error {
	var v []AppViolation
	add := func(path, format string, args ...any) {
		v = append(v, AppViolation{Path: path, Message: fmt.Sprintf(format, args...)})
	}

	for _, field := range []struct{ path, text string }{
		{"/client_name", m.ClientName},
		{"/software_id", m.SoftwareID},
		{"/software_version", m.SoftwareVersion},
	} {
		if err := checkRegistrationText(field.text); err != nil {
			add(field.path, "%s", err)
		}
	}
	for _, field := range []struct{ path, uri string }{
		{"/client_uri", m.ClientURI},
		{"/logo_uri", m.LogoURI},
		{"/policy_uri", m.PolicyURI},
		{"/tos_uri", m.TOSURI},
	} {
		if err := checkDisplayURI(field.uri); err != nil {
			add(field.path, "%s", err)
		}
	}

	switch m.AuthMethod {
	case ClientAuthNone, ClientAuthClientSecretBasic, ClientAuthClientSecretPost:
	default:
		add("/token_endpoint_auth_method", "a registered client authenticates with none, client_secret_basic or client_secret_post")
	}

	for i, grant := range m.GrantTypes {
		path := fmt.Sprintf("/grant_types/%d", i)
		switch {
		case grant != GrantAuthorizationCode && grant != GrantRefreshToken:
			add(path, "a registered client acts for users: authorization_code and refresh_token only")
		case slices.Index(m.GrantTypes, grant) != i:
			add(path, "grant type %q is listed twice", grant)
		}
	}
	if !m.HasGrant(GrantAuthorizationCode) {
		add("/grant_types", "a registered client needs authorization_code")
	}

	switch {
	case len(m.RedirectURIs) == 0:
		add("/redirect_uris", "a registered client needs at least one redirect URI")
	case len(m.RedirectURIs) > MaxClientRegistrationRedirectURIs:
		add("/redirect_uris", "a registered client lists at most %d redirect URIs", MaxClientRegistrationRedirectURIs)
	}
	for i, uri := range m.RedirectURIs {
		path := fmt.Sprintf("/redirect_uris/%d", i)
		switch {
		case len(uri) > maxClientRegistrationURI:
			add(path, "a redirect URI is at most %d bytes", maxClientRegistrationURI)
		case slices.Index(m.RedirectURIs, uri) != i:
			add(path, "redirect URI %q is listed twice", uri)
		default:
			if err := checkRedirectURI(uri, m.ClientType()); err != nil {
				add(path, "%s", err)
			}
		}
	}

	if len(v) > 0 {
		return ErrClientRegistrationInvalid(map[string]any{"violations": v})
	}
	return nil
}

// AccessTo says what the registered client may get for api, an API of
// apiApp: a third_party API of an app that opens dynamic registration, with
// any of its scopes, each with the user's consent.
func (r *ClientRegistration) AccessTo(apiApp *ResolvedApp, api AppAPI) ClientAPIAccess {
	if !apiApp.Document.Registration.Dynamic || !api.ThirdParty {
		return ClientAPIAccess{}
	}
	return ClientAPIAccess{Allowed: true, Scopes: api.ScopeNames()}
}

// checkRegistrationText accepts display text the consent step can show as
// written: short, without control characters, and without the bidi controls
// that would make a name read differently from what it is.
func checkRegistrationText(text string) error {
	if utf8.RuneCountInString(text) > maxClientRegistrationText {
		return fmt.Errorf("at most %d characters", maxClientRegistrationText)
	}
	if strings.ContainsFunc(text, func(r rune) bool { return unicode.IsControl(r) || unicode.Is(unicode.Bidi_Control, r) }) {
		return fmt.Errorf("control and bidi control characters are not allowed")
	}
	return nil
}

// checkDisplayURI accepts an empty value or an absolute https URL without
// userinfo, as the app document's display fields are.
func checkDisplayURI(uri string) error {
	if uri == "" {
		return nil
	}
	if len(uri) > maxClientRegistrationURI {
		return fmt.Errorf("at most %d bytes", maxClientRegistrationURI)
	}
	u, err := url.Parse(uri)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return fmt.Errorf("an https URL without userinfo")
	}
	return nil
}
