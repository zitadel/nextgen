package harness

import (
	"context"
	"fmt"
	"net/http"
	"time"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/ogenx"
)

// NewSessionLogin returns the SessionLogin for a target: the login journey as
// the fixture user, then the exchange of its handoff token for a session and
// its token. It uses plain net/http, not k6, on purpose — a refresh must not
// emit http_req_* samples, or its cost would land in the operation trends it
// is supposed to stay out of. ttl, when set, asks the exchange for that
// session lifetime instead of the server default; a run that wants to watch
// rotation within minutes asks for a short one.
func NewSessionLogin(t Target, ttl time.Duration) (SessionLogin, error) {
	//egress:allow benchmark harness establishing sessions on the server under test
	c, err := api.NewClient(t.Base, NewCredentials(t.ProjectSecret), api.WithClient(originDoer{origin: t.Origin, client: &http.Client{Timeout: 30 * time.Second}}))
	if err != nil {
		return nil, err
	}
	return func(ctx context.Context) (Session, error) {
		login, err := Login(ctx, c, t)
		if err != nil {
			return Session{}, err
		}
		req := &api.ExchangeRequest{HandoffToken: login.HandoffToken}
		if ttl > 0 {
			req.TTL = api.NewOptDuration(ogenx.ISODuration(ttl))
		}
		res, err := c.ExchangeHandoff(ctx, req, api.ExchangeHandoffParams{ProjectID: api.ProjectID(t.ProjectID)})
		if err != nil {
			return Session{}, fmt.Errorf("exchange handoff: %w", err)
		}
		ok, isOK := res.(*api.SessionWithTokenResponseHeaders)
		if !isOK {
			return Session{}, fmt.Errorf("exchange handoff: unexpected response %T", res)
		}
		return Session{
			Token:     ok.Response.SessionToken,
			ID:        string(ok.Response.Session.SessionID),
			ExpiresAt: ok.Response.Session.ExpiresAt,
		}, nil
	}, nil
}
