package helpers

import (
	"math/rand"
)

// ProjectName returns a unique project name for integration tests.
func ProjectName() string {
	return "project-" + RandString(8)
}

// TeamName returns a unique team name for integration tests.
func TeamName() string {
	return "team-" + RandString(8)
}

var letterRunes = []rune("abcdefghijklmnopqrstuvwxyz")

func RandString(n int) string {
	b := make([]rune, n)
	for i := range b {
		b[i] = letterRunes[rand.Intn(len(letterRunes))]
	}
	return string(b)
}
