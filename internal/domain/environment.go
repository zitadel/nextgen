package domain

import (
	"regexp"
	"strings"
	"time"
)

const (
	PrefixEnvironment ResourcePrefix = "env"
)

const (
	EnvironmentNameMaxLength = 63
	EnvironmentNamePattern   = `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`
)

var environmentNameRegex = regexp.MustCompile(EnvironmentNamePattern)

var DefaultEnvironmentNames = []string{"dev", "staging", "prod"}

func ErrEnvironmentNameInvalid() Error {
	return newError(
		PrefixEnvironment.ErrorCodePrefix("name_invalid"),
		"The environment name is invalid. Expected 1-63 characters of lowercase letters, digits and hyphens, starting and ending with a letter or digit.",
		nil, nil,
	)
}

func ErrEnvironmentNotFound() Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("not_found"), "environment not found", nil, nil)
}

func ErrEnvironmentProjectNotFound() Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("project_not_found"), "project not found", nil, nil)
}

func ErrEnvironmentPermissionDenied() Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("permission_denied"), "the environment management API requires the project secret", nil, nil)
}

type Environment struct {
	ProjectID string
	ID        string
	Name      string
	CreatedAt time.Time
}

func NewEnvironment(projectID, name string) (*Environment, error) {
	name, err := ValidateEnvironmentName(name)
	if err != nil {
		return nil, err
	}
	return &Environment{
		ProjectID: projectID,
		Name:      name,
	}, nil
}

// ValidateEnvironmentName returns the trimmed name, or
// ErrEnvironmentNameInvalid.
func ValidateEnvironmentName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if len(name) > EnvironmentNameMaxLength || !environmentNameRegex.MatchString(name) {
		return "", ErrEnvironmentNameInvalid()
	}
	return name, nil
}

type EnvironmentField uint8

const (
	EnvironmentFieldUnspecified EnvironmentField = iota
	EnvironmentFieldProjectID
	EnvironmentFieldID
	EnvironmentFieldName
	EnvironmentFieldCreatedAt
)
