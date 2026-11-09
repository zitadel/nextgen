package oauth

import (
	"net/url"
	"strings"
)

// EndpointURLs are the absolute endpoint URLs of one issuer, as its
// metadata names them.
type EndpointURLs struct {
	Authorization string
	Token         string
	Revocation    string
	JWKS          string
	Userinfo      string
	EndSession    string
}

// EndpointFactory builds the endpoint URLs of an issuer. The endpoints a
// browser visits, authorization and end session, are under the issuer: the
// app proxy rewrites them onto the project ID path. The ones a client calls
// from its back channel, token, revocation, JWKS and userinfo, are on the
// server's own public host, at the same project ID path, so that no proxy
// sits in between and no forwarded header is needed.
type EndpointFactory struct {
	publicBase *url.URL
}

// NewEndpointFactory builds endpoint URLs whose back-channel host is the
// origin of publicBase.
func NewEndpointFactory(publicBase *url.URL) EndpointFactory {
	return EndpointFactory{publicBase: publicBase}
}

// For returns the endpoint URLs of issuer.
func (f EndpointFactory) For(issuer Issuer) EndpointURLs {
	front := strings.TrimSuffix(issuer.URL.String(), "/")
	back := f.publicBase.Scheme + "://" + f.publicBase.Host + Prefix
	if !issuer.Platform {
		back += "/" + issuer.ProjectID
	}
	return EndpointURLs{
		Authorization: front + AuthorizePath,
		EndSession:    front + EndSessionPath,
		Token:         back + TokenPath,
		Revocation:    back + RevokePath,
		JWKS:          back + JWKSPath,
		Userinfo:      back + UserinfoPath,
	}
}
