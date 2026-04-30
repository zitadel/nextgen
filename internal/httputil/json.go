package httputil

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type StatusError struct {
	StatusCode int
	Body       []byte
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("HTTP error: %d: %s", e.StatusCode, e.Body)
}

type ContentTypeError struct {
	accept string
	got    string
}

func (e *ContentTypeError) Error() string {
	return fmt.Sprintf("unexpected content type: %s, expected %s", e.got, e.accept)
}

func GetJSON(ctx context.Context, url string, client *http.Client, dst any) error {
	const (
		contentType = "Content-Type"
		accept      = "application/json"
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set(contentType, accept)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		return &StatusError{
			StatusCode: resp.StatusCode,
			Body:       body,
		}
	}
	contentTypeHeader := resp.Header.Get(contentType)
	if contentTypeHeader != accept {
		return &ContentTypeError{
			accept: accept,
			got:    contentTypeHeader,
		}
	}
	if err := json.NewDecoder(resp.Body).Decode(&dst); err != nil {
		return err
	}
	return nil
}
