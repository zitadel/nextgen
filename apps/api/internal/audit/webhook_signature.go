package audit

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// The headers of a delivery to a project's webhook, as Standard Webhooks
// (https://www.standardwebhooks.com) names them (ADR 089 §2).
const (
	webhookIDHeader        = "webhook-id"
	webhookTimestampHeader = "webhook-timestamp"
	webhookSignatureHeader = "webhook-signature"
)

var errWebhookSecretMalformed = errors.New("webhook signing secret is not whsec_ followed by base64")

// signWebhook returns the webhook-signature of one delivery attempt as
// Standard Webhooks defines it: per secret, "v1," and the base64 of the
// HMAC-SHA256 of "{id}.{unix seconds of at}.{body}", keyed with the bytes the
// secret holds in base64 after its whsec_ prefix. Several signatures are
// separated by a space; a receiver accepts the delivery if one matches.
//
// It fails on no secret and on one it cannot decode, so that nothing is ever
// sent unsigned (ADR 089 §3).
func signWebhook(secrets []string, id string, at time.Time, body []byte) (string, error) {
	if len(secrets) == 0 {
		return "", errWebhookSecretMalformed
	}
	prefix := id + "." + strconv.FormatInt(at.Unix(), 10) + "."
	signatures := make([]string, len(secrets))
	for i, secret := range secrets {
		encoded, ok := strings.CutPrefix(secret, domain.WebhookSecretPrefix)
		if !ok {
			return "", errWebhookSecretMalformed
		}
		key, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(key) == 0 {
			return "", errWebhookSecretMalformed
		}
		mac := hmac.New(sha256.New, key)
		mac.Write([]byte(prefix))
		mac.Write(body)
		signatures[i] = "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	}
	return strings.Join(signatures, " "), nil
}
