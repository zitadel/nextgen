package cell

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type PeerClient struct {
	HTTP *http.Client
}

func NewPeerClient() *PeerClient {
	return &PeerClient{HTTP: &http.Client{Timeout: 5 * time.Second}}
}

type MeResponse struct {
	URL       string `json:"url"`
	Label     string `json:"label"`
	IsParent  bool   `json:"is_parent"`
	ParentURL string `json:"parent_url"`
	Status    string `json:"status"`
}

func (c *PeerClient) GetMe(ctx context.Context, baseURL string) (MeResponse, error) {
	var out MeResponse
	err := c.doJSON(ctx, http.MethodGet, NormalizeURL(baseURL)+"/v1/me", nil, "", &out)
	return out, err
}

type PrepareResponse struct {
	JoinToken string    `json:"join_token"`
	ParentURL string    `json:"parent_url"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (c *PeerClient) Prepare(ctx context.Context, parentURL string) (PrepareResponse, error) {
	var out PrepareResponse
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(parentURL)+"/v1/join/prepare", map[string]any{}, "", &out)
	return out, err
}

type AcceptRequest struct {
	ParentURL string `json:"parent_url"`
	JoinToken string `json:"join_token"`
}

type AcceptResponse struct {
	OK        bool   `json:"ok"`
	ParentURL string `json:"parent_url"`
}

func (c *PeerClient) Accept(ctx context.Context, childURL string, req AcceptRequest) (AcceptResponse, error) {
	var out AcceptResponse
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(childURL)+"/v1/join/accept", req, "", &out)
	return out, err
}

type CompleteRequest struct {
	ChildURL  string `json:"child_url"`
	JoinToken string `json:"join_token"`
}

type CompleteResponse struct {
	OK         bool   `json:"ok"`
	JoinSecret string `json:"join_secret"`
	ParentURL  string `json:"parent_url"`
}

func (c *PeerClient) Complete(ctx context.Context, parentURL string, req CompleteRequest) (CompleteResponse, error) {
	var out CompleteResponse
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(parentURL)+"/v1/join/complete", req, "", &out)
	return out, err
}

func (c *PeerClient) Heartbeat(ctx context.Context, parentURL, joinSecret string) error {
	return c.doJSON(ctx, http.MethodPost, NormalizeURL(parentURL)+"/v1/heartbeat", map[string]any{}, joinSecret, nil)
}

func (c *PeerClient) DoRaw(ctx context.Context, method, url string, body any, bearer string, out any) error {
	return c.doJSON(ctx, method, url, body, bearer, out)
}

func (c *PeerClient) doJSON(ctx context.Context, method, url string, body any, bearer string, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode >= 300 {
		var er struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &er)
		if er.Error != "" {
			return fmt.Errorf("%s", er.Error)
		}
		return fmt.Errorf("http %d: %s", res.StatusCode, string(data))
	}
	if out == nil || res.StatusCode == http.StatusNoContent || len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}
