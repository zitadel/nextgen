package httputil

import (
	"context"
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

func Get(ctx context.Context, url string, client *http.Client, acceptContentType string) ([]byte, error) {
	const (
		contentType = "Content-Type"
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set(contentType, acceptContentType)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, &StatusError{
			StatusCode: resp.StatusCode,
			Body:       body,
		}
	}
	contentTypeHeader := resp.Header.Get(contentType)
	if contentTypeHeader != acceptContentType {
		return nil, &ContentTypeError{
			accept: acceptContentType,
			got:    contentTypeHeader,
		}
	}

	return body, err
}
