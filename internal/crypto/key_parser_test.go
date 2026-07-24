package crypto

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func marshalJWK(t *testing.T, key any) string {
	t.Helper()
	jwk := jose.JSONWebKey{Key: key}
	bs, err := jwk.MarshalJSON()
	require.NoError(t, err)
	return string(bs)
}

func pkcs1PEM(t *testing.T, key *rsa.PrivateKey) string {
	t.Helper()
	return string(pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	}))
}

func pkcs8PEM(t *testing.T, key any) string {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)
	return string(pem.EncodeToMemory(&pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: der,
	}))
}

func TestParsePrivatePEMKey(t *testing.T) {
	t.Parallel()

	// A 2048-bit key keeps generation fast; reused across success cases so the
	// parsed result can be compared against the original.
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	ecKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)

	t.Run("parses an openssh generated key", func(t *testing.T) {
		t.Parallel()
		key := `-----BEGIN OPENSSH PRIVATE KEY-----
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
tKmiTgdlqX8AAAALd2ltQG9tYXJjaHk=
-----END OPENSSH PRIVATE KEY-----`
		got, err := ParsePrivatePEMKey(key)
		require.NoError(t, err)
		assert.NotNil(t, got)
	})

	t.Run("parses a PKCS#1 PEM key", func(t *testing.T) {
		t.Parallel()
		got, err := ParsePrivatePEMKey(pkcs1PEM(t, rsaKey))
		require.NoError(t, err)
		assert.True(t, got.Equal(rsaKey), "parsed key should equal the original")
	})

	t.Run("parses a PKCS#8 PEM key", func(t *testing.T) {
		t.Parallel()
		got, err := ParsePrivatePEMKey(pkcs8PEM(t, rsaKey))
		require.NoError(t, err)
		assert.True(t, got.Equal(rsaKey), "parsed key should equal the original")
	})

	t.Run("rejects a non-RSA (ECDSA) PKCS#8 key", func(t *testing.T) {
		t.Parallel()
		_, err := ParsePrivatePEMKey(pkcs8PEM(t, ecKey))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "RSA")
	})

	t.Run("returns an error for non-PEM input without panicking", func(t *testing.T) {
		t.Parallel()
		_, err := ParsePrivatePEMKey("this is not a pem file")
		require.Error(t, err)
	})

	t.Run("returns an error for empty input without panicking", func(t *testing.T) {
		t.Parallel()
		_, err := ParsePrivatePEMKey("")
		require.Error(t, err)
	})

	t.Run("returns an error for a PEM block with invalid DER", func(t *testing.T) {
		t.Parallel()
		badPEM := string(pem.EncodeToMemory(&pem.Block{
			Type:  "RSA PRIVATE KEY",
			Bytes: []byte("not-valid-der"),
		}))
		_, err := ParsePrivatePEMKey(badPEM)
		require.Error(t, err)
	})
}

func TestParsePrivateJWK(t *testing.T) {
	t.Parallel()

	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	ecKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)

	t.Run("parses an RSA private JWK", func(t *testing.T) {
		t.Parallel()
		got, err := ParsePrivateJWK(marshalJWK(t, rsaKey))
		require.NoError(t, err)
		assert.True(t, got.Equal(rsaKey), "parsed key should equal the original")
	})

	t.Run("parses a concrete RSA private JWK", func(t *testing.T) {
		t.Parallel()
		// A fixed, valid 2048-bit RSA private JWK (kty=RSA with private
		// parameters), independent of the runtime-generated keys above.
		const jwk = `{"use":"enc","kty":"RSA","kid":"test-kek","alg":"RSA-OAEP-256","n":"4OxkT5BP3Gv-l1UwG4UHSwb3i9cY2qoPXgWE9L4yMxfSsrK2X5wzo1uMV58kkh8kDCJ5E88n057P_ZNGh2RVkRyJpqnj9Jdj96NouqMjkRBoV_v9I05nxLtGKup06zRlUsuqfYQxvb71ZQ2g6IRl4AVNkguxPLDE4SWdTuKSHEWkjcJqXxMdJm-3taEQSgcOVtCXKlgYGtli4G6R2OtYgSFmk5A7KxmWkDo5N42i0eclRLL9S10wmUcUIZQHULQae2up93K22qw5791rdbJ4nRgqAlzekxj_u5wqLAvd30EGpiqJp9Usl8-HXA7KGKbTmk6zHfHsjuW9jUV1zUgNpw","e":"AQAB","d":"DVR1LXH0CbAsynM2AquDnyKukQ8SXgMuHfhdxNNwzi5fQk_tFwV-2fOXAapg1Hgb_swcONxSE-yZjwGncGa123_BeKsg42IFfqukjUsV1IcQaAZ7HhiLddFTez-h5j6Ysqt3UzD-caxbhr2kB6OxFfG6gylGO76OLHm6NO6gkiRB_0Dvvwy2-AHb5KjEVG6MdELMsUHoRZfJHcu8ZChXGK10NW2yMTKfWFSjNT46n7ccf1xsxQix71G_tc-NKUe9dnjonvFphl4hP61eZBGikKtiSJDeIbWGvZ5Cd5Xa-QGRRF-A9xljOYhEMFLVIlQ4Wdnz_QYrhWAiLWQtOvpUoQ","p":"5Rg5pbdvTdQ58XdmdfGAIY_QnopT8PHmvJVV9oTHXLF3PJ2eVZ-bb_BX60BmwmKOTTgbyCSH3KWg6ib13H5ebhQeSUyJwk9kJJCDiBq7llmow30OTXPQlP0dEw6aTfmgKbfW-rp9DfD-l7EKU5OGQoqCsZFfherx2nhOZfNygt0","q":"-1bCC5OSijLIGrUW8g-SNApHWzmM4mGgvadQ4f4k0uEHb6MI29zn1kgXU-fEBLCd57R44TdYsQSLEosk9T8pMz6LZOVOKhQi70nSw-MA_g7XWI0CMgo2uRpxYAX1N2MWkBUIEUKcQDSw6_AoOQOWgNfAjEtPIqZZKA57gL88IFM","dp":"JtRoUPI6Z1KlT4wRTcRVF1ss3PJNL_WQSj51h4cR02Aw-ZEtmQ2oZtyxyinsQN47iFMOQmoOrRNVptpbqbexga7fQ0U5xDl4m8nywUrmqKEhvaCgn_gVTmtoViaPeM_qmaeTRIP_VjGWtVdIjMngY77eUAJ30lb0Dzd88kLFEfE","dq":"P0NnNGLAz-hYVeCfFe61bkPoEh46SAEq5JHo2fmOa0YZCRCQekbwVA9xT71WqZeLJ3dVtdqoiGYMW26KrvBm_m8PxyWwtwa6hGCgnI3XAhvaOH_FvbK0c4MkZncZcgeO9lVU4oNRsReSMNESTseIaoXkAWwzTxVv-5UpoQ6Bo-E","qi":"sLIvz3EJzvFzXYuZynD3VdN7ftBn0tQvyoG0g0aCHzxoN3rp7EMTasBHm7brT9uAazxQyW3rtW9RdVZf5uFFdygdm8GmhmWFyBkS5v9BehiQdWgZlmMs2k31XVXIaYtwhc1bBLcMqg2huG4H9wiilOBp7vE-u3AfG1O2eVXlfcE"}`

		got, err := ParsePrivateJWK(jwk)
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.NoError(t, got.Validate(), "parsed key should be internally consistent")
	})

	t.Run("rejects a non-RSA (ECDSA) JWK", func(t *testing.T) {
		t.Parallel()
		_, err := ParsePrivateJWK(marshalJWK(t, ecKey))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "rsa")
	})

	t.Run("returns an error for invalid JSON without panicking", func(t *testing.T) {
		t.Parallel()
		_, err := ParsePrivateJWK("not json")
		require.Error(t, err)
	})

	t.Run("returns an error for empty input without panicking", func(t *testing.T) {
		t.Parallel()
		_, err := ParsePrivateJWK("")
		require.Error(t, err)
	})
}
