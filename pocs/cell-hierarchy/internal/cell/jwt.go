package cell

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// TokenClaims are the inspectable JWT claims issued by a home cell.
type TokenClaims struct {
	Sub         string `json:"sub"`
	HomeCell    string `json:"home_cell"`
	HomeProject string `json:"home_project"`
	Aud         string `json:"aud"`
	Epoch       int    `json:"epoch"`
	Exp         int64  `json:"exp"`
	Iss         string `json:"iss"`
	Iat         int64  `json:"iat,omitempty"`
}

type JWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	Use string `json:"use"`
}

type JWKS struct {
	Keys []JWK `json:"keys"`
}

func PublicJWKS(key SigningKey) JWKS {
	return JWKS{Keys: []JWK{{
		Kty: "OKP",
		Crv: "Ed25519",
		X:   base64.RawURLEncoding.EncodeToString(key.PublicKey),
		Kid: key.Kid,
		Alg: "EdDSA",
		Use: "sig",
	}}}
}

func SignToken(key SigningKey, claims TokenClaims) (string, error) {
	header := map[string]string{
		"alg": "EdDSA",
		"typ": "JWT",
		"kid": key.Kid,
	}
	hb, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	pb, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	hEnc := base64.RawURLEncoding.EncodeToString(hb)
	pEnc := base64.RawURLEncoding.EncodeToString(pb)
	signingInput := hEnc + "." + pEnc
	sig := ed25519.Sign(key.PrivateKey, []byte(signingInput))
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// DecodeTokenClaims parses the JWT payload without verifying the signature.
func DecodeTokenClaims(token string) (TokenClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return TokenClaims{}, ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return TokenClaims{}, ErrInvalidToken
	}
	var claims TokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return TokenClaims{}, ErrInvalidToken
	}
	return claims, nil
}

func VerifyToken(token string, pub ed25519.PublicKey, now time.Time) (TokenClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return TokenClaims{}, ErrInvalidToken
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return TokenClaims{}, ErrInvalidToken
	}
	signingInput := parts[0] + "." + parts[1]
	if !ed25519.Verify(pub, []byte(signingInput), sig) {
		return TokenClaims{}, ErrTokenSignature
	}
	claims, err := DecodeTokenClaims(token)
	if err != nil {
		return TokenClaims{}, err
	}
	if claims.Exp > 0 && now.Unix() >= claims.Exp {
		return TokenClaims{}, ErrTokenExpired
	}
	return claims, nil
}

func PublicKeyFromJWK(k JWK) (ed25519.PublicKey, error) {
	if k.Kty != "OKP" || k.Crv != "Ed25519" {
		return nil, fmt.Errorf("unsupported_jwk")
	}
	raw, err := base64.RawURLEncoding.DecodeString(k.X)
	if err != nil {
		return nil, err
	}
	if len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("invalid_ed25519_x")
	}
	return ed25519.PublicKey(raw), nil
}

func FindJWK(jwks JWKS, kid string) (JWK, bool) {
	for _, k := range jwks.Keys {
		if kid == "" || k.Kid == kid {
			return k, true
		}
	}
	return JWK{}, false
}

func TokenKid(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return ""
	}
	hb, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return ""
	}
	var header struct {
		Kid string `json:"kid"`
	}
	_ = json.Unmarshal(hb, &header)
	return header.Kid
}
