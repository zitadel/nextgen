package database

import (
	"context"
	"errors"
	"testing"
)

type testConnector struct{}

func (t *testConnector) Connect(_ context.Context) (Pool, error) {
	return nil, nil
}

func TestConfigBuild(t *testing.T) {
	t.Run("no dialect configured without default", func(t *testing.T) {
		prevDefault := defaultConnector
		defaultConnector = nil
		t.Cleanup(func() {
			defaultConnector = prevDefault
		})

		cfg := Config{}
		_, err := cfg.build(nil)
		if err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("no dialect configured uses default connector", func(t *testing.T) {
		expected := &testConnector{}
		prevDefault := defaultConnector
		defaultConnector = expected
		t.Cleanup(func() {
			defaultConnector = prevDefault
		})

		cfg := Config{}
		connector, err := cfg.build(nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if connector != expected {
			t.Fatal("expected default connector")
		}
	})

	t.Run("multiple dialects configured", func(t *testing.T) {
		cfg := Config{Raw: map[string]any{"postgres": "a", "spanner": "b"}}
		_, err := cfg.build(nil)
		if err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("unsupported dialect", func(t *testing.T) {
		cfg := Config{Raw: map[string]any{"mysql": "dsn"}}
		_, err := cfg.build(map[string]DialectDecoder{})
		if err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("decoder error", func(t *testing.T) {
		cfg := Config{Raw: map[string]any{"postgres": "dsn"}}
		_, err := cfg.build(map[string]DialectDecoder{
			"postgres": func(_ any) (Connector, error) {
				return nil, errors.New("boom")
			},
		})
		if err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("success", func(t *testing.T) {
		cfg := Config{Raw: map[string]any{"postgres": "dsn"}}
		connector, err := cfg.build(map[string]DialectDecoder{
			"postgres": func(v any) (Connector, error) {
				if v != "dsn" {
					t.Fatalf("unexpected value %v", v)
				}
				return &testConnector{}, nil
			},
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if connector == nil {
			t.Fatal("expected connector")
		}
	})
}
