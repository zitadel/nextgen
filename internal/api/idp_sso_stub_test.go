package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// These cover the guards the sso stub adds around an otherwise deliberately
// thin implementation. They are the parts that must not regress even while
// the rest is a placeholder: an endpoint the server will fetch, a claim it
// will provision an account from, and a store two requests share.

func TestCheckedEndpoint(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		ok   bool
	}{
		{"https is the normal case", "https://accounts.google.com/authorize", true},
		{"http on localhost is allowed for development", "http://localhost:9100/token", true},
		{"http on a loopback ip is allowed", "http://127.0.0.1:9100/token", true},
		{"plain http elsewhere is refused", "http://accounts.google.com/authorize", false},
		// The step's redirect_url reaches the browser, so a javascript: URL
		// here would be script execution on the login page's origin.
		{"javascript is refused", "javascript:alert(1)", false},
		{"file is refused", "file:///etc/passwd", false},
		{"a relative path is refused", "/authorize", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := checkedEndpoint(tc.raw)
			if tc.ok && err != nil {
				t.Fatalf("want %q accepted, got %v", tc.raw, err)
			}
			if !tc.ok && err == nil {
				t.Fatalf("want %q refused", tc.raw)
			}
		})
	}
}

func TestTokenEndpointDerivedFromIssuerIsChecked(t *testing.T) {
	// The issuer is tenant-authored and the server fetches whatever it names,
	// so the derived endpoint has to be held to the same rule as an explicit
	// one — otherwise the check is trivially bypassed by omitting the field.
	_, err := tokenEndpoint(api.IdpConnectionOidc{Issuer: "http://169.254.169.254"})
	if err == nil {
		t.Fatal("want a link-local issuer refused")
	}
}

func idToken(t *testing.T, claims map[string]any) string {
	t.Helper()
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	return "header." + base64.RawURLEncoding.EncodeToString(payload) + ".sig"
}

func TestEmailClaim(t *testing.T) {
	verified := map[string]any{"email": "a@example.com", "email_verified": true}
	got, err := emailClaim(idToken(t, verified))
	if err != nil || got.Email != "a@example.com" || !got.Verified {
		t.Fatalf("want the verified address, got %+v (%v)", got, err)
	}

	// An address the provider has not verified is one anyone could have typed
	// there. It is read, so the user can confirm it on the collection step,
	// but it is reported unverified so nothing provisions an account on it.
	for _, claims := range []map[string]any{
		{"email": "a@example.com", "email_verified": false},
		{"email": "a@example.com"},
		{"email": "a@example.com", "email_verified": "yes"},
	} {
		got, err := emailClaim(idToken(t, claims))
		if err != nil {
			t.Fatalf("want %v read, got %v", claims, err)
		}
		if got.Verified {
			t.Fatalf("want %v reported unverified", claims)
		}
	}

	// Structural problems are still refusals: there is nothing to collect
	// from a token that carries no address or has expired.
	for name, claims := range map[string]map[string]any{
		"no email": {"email_verified": true},
		"expired": {
			"email": "a@example.com", "email_verified": true,
			"exp": time.Now().Add(-time.Minute).Unix(),
		},
	} {
		if _, err := emailClaim(idToken(t, claims)); err == nil {
			t.Fatalf("want %s refused", name)
		}
	}
}

func TestSsoStubStorePendingIsCappedAndSwept(t *testing.T) {
	store := newSsoStubStore()
	for i := 0; i < maxPendingSSO; i++ {
		if _, err := store.put(ssoPending{createdAt: time.Now()}); err != nil {
			t.Fatalf("put %d: %v", i, err)
		}
	}
	// `POST /flow` is unauthenticated, so without a cap a loop of
	// create-flow/submit-sso grows this map at request rate.
	if _, err := store.put(ssoPending{createdAt: time.Now()}); err == nil {
		t.Fatal("want the cap to refuse the next authorization")
	}

	// An expired entry is swept, which frees the cap again.
	store.mu.Lock()
	for key := range store.pending {
		store.pending[key] = ssoPending{createdAt: time.Now().Add(-2 * ssoPendingTTL)}
	}
	store.mu.Unlock()
	if _, err := store.put(ssoPending{createdAt: time.Now()}); err != nil {
		t.Fatalf("want the sweep to free room, got %v", err)
	}
}

func TestSsoStubStorePeekDoesNotConsume(t *testing.T) {
	store := newSsoStubStore()
	state, err := store.put(ssoPending{binding: "nonce", createdAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}

	// A callback that fails the binding check must leave the authorization
	// redeemable: otherwise anyone who learns a state can cancel the sign-in
	// it belongs to.
	if _, ok := store.peek(state); !ok {
		t.Fatal("want peek to find the pending authorization")
	}
	if _, ok := store.peek(state); !ok {
		t.Fatal("want peek to leave it in place")
	}

	store.consume(state)
	if _, ok := store.peek(state); ok {
		t.Fatal("want a consumed state gone, so it cannot be replayed")
	}
}

func TestIdpStubStoreHandsOutCopies(t *testing.T) {
	store := newIdpStubStore()
	mint := func(prefix domain.ResourcePrefix) (string, error) {
		return fmt.Sprintf("%s_01TEST", prefix), nil
	}
	_, _, err := store.upsert("proj", api.IdpConnection{Slug: "google", DisplayName: "Google"},
		mint, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	got, ok := store.getBySlug("proj", "google")
	if !ok {
		t.Fatal("want the connection back")
	}
	// A revision mutates the stored record in place, so a caller holding a
	// pointer would read a half-updated connection.
	got.definition.DisplayName = "mutated"
	again, _ := store.getBySlug("proj", "google")
	if again.definition.DisplayName != "Google" {
		t.Fatalf("store handed out a shared record: %q", again.definition.DisplayName)
	}
}
