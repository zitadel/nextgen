package helpers

import (
	"math/rand"

	"github.com/brianvoe/gofakeit/v6"
)

// appName private function to add a random string to the gofakeit.AppName function
func appName() string {
	return gofakeit.AppName() + "-" + RandString(5)
}

func ProjectName() string {
	return appName()
}

var letterRunes = []rune("abcdefghijklmnopqrstuvwxyz")

func RandString(n int) string {
	b := make([]rune, n)
	for i := range b {
		b[i] = letterRunes[rand.Intn(len(letterRunes))]
	}
	return string(b)
}
