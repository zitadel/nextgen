// Package resty is a stand-in for the real module so the import rule can be
// exercised without a network dependency.
package resty

func New() any { return nil }
