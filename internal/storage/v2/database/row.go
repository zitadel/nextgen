package database

// Scanner scans a single row of data into the destination.
type Scanner interface {
	Scan(dest ...any) error
}

// Row is an abstraction of sql.Row.
type Row interface {
	Scanner
}

// Rows is an abstraction of sql.Rows.
type Rows interface {
	Scanner
	Next() bool
	Close() error
	Err() error
}
