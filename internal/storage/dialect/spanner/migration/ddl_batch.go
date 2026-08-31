package migration

// DDL batching for Spanner migrations.
//
// On a real Cloud Spanner instance every DDL statement goose executes becomes
// its own UpdateDatabaseDdl long-running operation, costing tens of seconds
// (#973).
//
// go-sql-spanner accepts START BATCH DDL and RUN BATCH as client-side
// statements on an ordinary Exec, and sends everything buffered between them as
// a single UpdateDatabaseDdl. batchDDLFS brackets each *run of consecutive DDL*
// in a migration's Up section with that pair, so goose executes the pair without
// knowing it exists.
//
// Consecutive, not whole-file: 000011_user_team_lifecycle.sql interleaves an
// UPDATE and an INSERT between its ALTERs and CREATEs, and DML inside a DDL
// batch is rejected. A run ends at the first non-DDL statement and a new one
// opens after it.
//
// Batches are not atomic on Spanner: a failure applies the statements before it
// and abandons the rest. Runs stay inside one file, and goose writes its version
// row only after the whole file succeeds, which is the same exposure goose
// already had per statement.
//
// This cannot silently stop working. If a driver upgrade stopped recognising
// the two statements as client-side, they would be sent to Spanner as ordinary
// SQL and fail to parse, so migrations break loudly rather than quietly
// reverting to one operation per statement.
//
// Only the Up section is rewritten. Down migrations are not part of any
// automated path here, and leaving them alone keeps this to the case that has a
// measured cost.

import (
	"bytes"
	"io"
	"io/fs"
	"path"
	"strings"
	"time"
)

const (
	gooseUp        = "-- +goose Up"
	gooseDown      = "-- +goose Down"
	stmtBegin      = "-- +goose StatementBegin"
	stmtEnd        = "-- +goose StatementEnd"
	startBatchStmt = stmtBegin + "\nSTART BATCH DDL\n" + stmtEnd
	runBatchStmt   = stmtBegin + "\nRUN BATCH\n" + stmtEnd
)

// batchDDLFS wraps a migrations FS, rewriting .sql files as they are read.
// Directories and anything else are served unchanged so goose can still walk
// the tree.
type batchDDLFS struct{ inner fs.FS }

func (f batchDDLFS) Open(name string) (fs.File, error) {
	if path.Ext(name) != ".sql" {
		return f.inner.Open(name)
	}
	src, err := fs.ReadFile(f.inner, name)
	if err != nil {
		return nil, err
	}
	info, err := fs.Stat(f.inner, name)
	if err != nil {
		return nil, err
	}
	body := batchUpDDL(string(src))
	return &memFile{
		Reader: bytes.NewReader([]byte(body)),
		info:   rewrittenInfo{FileInfo: info, size: int64(len(body))},
	}, nil
}

// batchUpDDL brackets each run of consecutive DDL statements in src's Up
// section with START BATCH DDL / RUN BATCH. Input that does not look like a
// goose migration is returned unchanged.
func batchUpDDL(src string) string {
	if !strings.Contains(src, gooseUp) || !strings.Contains(src, stmtBegin) {
		return src
	}

	var out []string
	inUp, inBatch, inStatement := false, false, false
	statement := make([]string, 0, 16)

	closeBatch := func() {
		if inBatch {
			out = append(out, runBatchStmt)
			inBatch = false
		}
	}

	for _, line := range strings.Split(src, "\n") {
		trimmed := strings.TrimSpace(line)

		switch {
		case trimmed == gooseUp:
			inUp = true
			out = append(out, line)
			continue
		case trimmed == gooseDown:
			// Leaving the Up section: any open run ends here, before the marker.
			closeBatch()
			inUp = false
			out = append(out, line)
			continue
		}

		if !inUp {
			out = append(out, line)
			continue
		}

		switch {
		case trimmed == stmtBegin:
			inStatement = true
			statement = statement[:0]
			statement = append(statement, line)
		case trimmed == stmtEnd:
			inStatement = false
			statement = append(statement, line)
			if isDDLStatement(statement) {
				if !inBatch {
					out = append(out, startBatchStmt)
					inBatch = true
				}
			} else {
				closeBatch()
			}
			out = append(out, statement...)
		case inStatement:
			statement = append(statement, line)
		default:
			out = append(out, line)
		}
	}
	// A file whose Up section runs to EOF without a Down marker.
	closeBatch()

	return strings.Join(out, "\n")
}

// isDDLStatement reports whether a goose statement block is DDL, judged by the
// first keyword that is not a comment. Spanner's DDL verbs are a closed set
// here: these are our own migrations, not arbitrary user SQL.
func isDDLStatement(block []string) bool {
	for _, line := range block {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "--") {
			continue
		}
		upper := strings.ToUpper(trimmed)
		for _, verb := range []string{"CREATE ", "ALTER ", "DROP ", "RENAME ", "GRANT ", "REVOKE ", "ANALYZE"} {
			if strings.HasPrefix(upper, verb) {
				return true
			}
		}
		return false
	}
	return false
}

// memFile serves rewritten bytes as an fs.File.
type memFile struct {
	*bytes.Reader
	info fs.FileInfo
}

func (f *memFile) Stat() (fs.FileInfo, error) { return f.info, nil }
func (f *memFile) Close() error               { return nil }

var _ io.Reader = (*memFile)(nil)

// rewrittenInfo reports the rewritten length while keeping the original's other
// metadata, so callers that size a buffer from Stat read the whole file.
type rewrittenInfo struct {
	fs.FileInfo
	size int64
}

func (i rewrittenInfo) Size() int64        { return i.size }
func (i rewrittenInfo) ModTime() time.Time { return i.FileInfo.ModTime() }
