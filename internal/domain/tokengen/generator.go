package tokengen

//go:generate go tool mockgen -typed -package tokengenmock -destination ./mock/generator.mock.go . Generator

type Generator interface {
	Generate(data map[string]any) (string, error)
}
