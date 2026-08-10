package database

type StringMatch uint8

const (
	StringMatchEqual StringMatch = iota
	StringMatchStartsWith
	StringMatchContains
	StringMatchEndsWith
)

type StringFilter[F ~uint8] struct {
	Column     Column[F]
	Match      StringMatch
	Value      string
	IgnoreCase bool
}

func newStringFilter[F ~uint8](col Column[F], match StringMatch, value string, ignoreCase bool) *StringFilter[F] {
	return &StringFilter[F]{
		Column:     col,
		Match:      match,
		Value:      value,
		IgnoreCase: ignoreCase,
	}
}

// StringEqual matches a string column with exact equality.
func StringEqual[F ~uint8](col Column[F], value string) *StringFilter[F] {
	return newStringFilter(col, StringMatchEqual, value, false)
}

// StringStartsWith matches when the column value starts with prefix.
func StringStartsWith[F ~uint8](col Column[F], prefix string) *StringFilter[F] {
	return newStringFilter(col, StringMatchStartsWith, prefix, false)
}

// StringContains matches when the column value contains substr.
func StringContains[F ~uint8](col Column[F], substr string) *StringFilter[F] {
	return newStringFilter(col, StringMatchContains, substr, false)
}

// StringEndsWith matches when the column value ends with suffix.
func StringEndsWith[F ~uint8](col Column[F], suffix string) *StringFilter[F] {
	return newStringFilter(col, StringMatchEndsWith, suffix, false)
}

// StringEqualFold matches a string column with case-insensitive equality.
func StringEqualFold[F ~uint8](col Column[F], value string) *StringFilter[F] {
	return newStringFilter(col, StringMatchEqual, value, true)
}

// StringStartsWithFold matches when the column value starts with prefix, ignoring case.
func StringStartsWithFold[F ~uint8](col Column[F], prefix string) *StringFilter[F] {
	return newStringFilter(col, StringMatchStartsWith, prefix, true)
}

// StringContainsFold matches when the column value contains substr, ignoring case.
func StringContainsFold[F ~uint8](col Column[F], substr string) *StringFilter[F] {
	return newStringFilter(col, StringMatchContains, substr, true)
}

// StringEndsWithFold matches when the column value ends with suffix, ignoring case.
func StringEndsWithFold[F ~uint8](col Column[F], suffix string) *StringFilter[F] {
	return newStringFilter(col, StringMatchEndsWith, suffix, true)
}

// Restricts implements [Filter].
func (f *StringFilter[F]) Restricts(column Column[F]) bool {
	return f.Column == column
}

func (f *StringFilter[F]) isFilter() {}

var _ Filter[uint8] = (*StringFilter[uint8])(nil)
