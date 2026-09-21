package configfs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"
	slogctx "github.com/veqryn/slog-context"
)

// The tree `zitadel setup` scaffolds, relative to the project root. The paths
// double as the prefix of a state.json key, so they are spelled with forward
// slashes and joined per-OS only when touching the filesystem.
const (
	zitadelDir      = ".zitadel"
	zitadelJSONName = "zitadel.json"
	stateFileName   = "state.json"

	schemasDir  = zitadelDir + "/schemas"
	flowsDir    = zitadelDir + "/flows"
	brandingDir = zitadelDir + "/branding"
)

// Store is one project directory, read live.
//
// Two files describe the tree rather than being resources in it, and both are
// watched so the server follows the CLI without a restart:
//
//   - `zitadel.json` names the project every document here belongs to. The
//     documents carry no project of their own.
//   - `.zitadel/state.json` is the CLI's index: it maps each resource file to
//     the id the server minted for it. Reading ids from there is what lets a
//     file-backed resource keep the identity a release, a user record or an
//     RSI row already refers to, instead of inventing one that would not match.
type Store struct {
	root    string
	watcher *fsnotify.Watcher

	// mu guards the two watched documents. They are replaced by the watcher
	// goroutine while request goroutines read them, so every access goes
	// through it.
	mu        sync.RWMutex
	projectID string
	state     StateFile
}

// StateFile is `.zitadel/state.json` as the server reads it.
//
// The CLI writes more (hashes, the scaffold manifest, framework); this decodes
// only what the server needs, so a field the CLI adds later does not have to be
// mirrored here to keep parsing.
type StateFile struct {
	Resources map[string]StateResource `json:"resources"`
}

// StateResource is one entry of the index. The key it sits under is the
// resource file's path relative to the project root, exactly as the CLI records
// it (`.zitadel/schemas/default-human-user.json`).
type StateResource struct {
	ID string `json:"id"`
}

func NewStore(ctx context.Context, root string) (*Store, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("configfs: root directory is required")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("configfs: resolve root: %w", err)
	}

	store := &Store{root: abs}

	// The project must be known before the store can answer anything, so a
	// missing or unreadable zitadel.json fails construction. The index does
	// not: a tree authored by hand has no state.json, and every resource then
	// falls back to its handle.
	if err := store.reloadZitadelJSON(); err != nil {
		return nil, err
	}
	if err := store.reloadStateFile(); err != nil {
		return nil, err
	}

	if err := store.watchFileSystem(ctx); err != nil {
		return nil, err
	}

	return store, nil
}

// Close stops watching. The store stays readable afterwards — every read goes
// to disk regardless — it simply stops following changes to the two described
// files.
func (s *Store) Close() error {
	if s.watcher == nil {
		return nil
	}
	return s.watcher.Close()
}

func (s *Store) zitadelJSONPath() string {
	return filepath.Join(s.root, zitadelJSONName)
}

func (s *Store) stateFilePath() string {
	return filepath.Join(s.root, zitadelDir, stateFileName)
}

// watchFileSystem follows the two described files.
//
// It watches their *directories*, not the files. A watch on a file follows the
// inode, and both writers here replace rather than truncate: the CLI rewrites
// state.json, editors save through a temporary file, and this package's own
// write does CreateTemp+Rename. Watching the file would survive exactly one
// such save and then go quiet with no error — hot reload that stops working
// after the first change is worse than none, because nothing reports it.
//
// Watching a directory also means the files do not have to exist yet: a tree
// gains its state.json when `zitadel setup` first records an id.
func (s *Store) watchFileSystem(ctx context.Context) error {
	if s.watcher != nil {
		if err := s.watcher.Close(); err != nil {
			return fmt.Errorf("configfs: failed to close existing filewatch: %w", err)
		}
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("configfs: failed to watch the file-system: %w", err)
	}
	s.watcher = watcher

	// The project root always exists; .zitadel may not yet, because
	// `zitadel setup` creates it after the server is already running. Watching
	// the root means that mkdir is itself an event, and watchZitadelDir then
	// picks the index up — a store that only watched an existing .zitadel
	// would never follow a project that was set up underneath it.
	if err := s.watcher.Add(s.root); err != nil {
		_ = s.watcher.Close()
		return fmt.Errorf("configfs: watch %s: %w", s.root, err)
	}
	if err := s.watchZitadelDir(); err != nil {
		_ = s.watcher.Close()
		return err
	}

	reload := map[string]func() error{
		s.zitadelJSONPath(): s.reloadZitadelJSON,
		s.stateFilePath():   s.reloadStateFile,
	}

	go s.followChanges(ctx, reload)
	return nil
}

// watchZitadelDir adds the .zitadel directory to the watch set once it exists.
// It is idempotent: fsnotify treats a repeat Add as a no-op, so it can be
// called on every root event without tracking whether it already succeeded.
func (s *Store) watchZitadelDir() error {
	dir := filepath.Join(s.root, zitadelDir)
	if _, err := os.Stat(dir); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("configfs: stat %s: %w", dir, err)
	}
	if err := s.watcher.Add(dir); err != nil {
		return fmt.Errorf("configfs: watch %s: %w", dir, err)
	}
	return nil
}

// followChanges applies a reload for every event naming one of the described
// files, until the context ends or the watcher closes.
//
// A failed reload is logged and the previous value kept. The alternative is
// serving a half-written document: an editor's save is briefly visible as a
// truncated file, and dropping that parse is how the next, complete event wins.
func (s *Store) followChanges(ctx context.Context, reload map[string]func() error) {
	defer func() {
		if err := s.watcher.Close(); err != nil {
			slogctx.Error(ctx, "error while stopping filesystem watcher", slogctx.Err(err))
		}
	}()

	for {
		select {
		case event, ok := <-s.watcher.Events:
			if !ok {
				return
			}
			// Chmod alone changes no content; reloading on it would re-parse
			// the tree every time a tool touches permissions.
			if event.Op == fsnotify.Chmod {
				continue
			}
			// A project being set up creates .zitadel after this watch
			// started. Catch it on the event that creates it, then read the
			// index it now contains.
			if filepath.Clean(event.Name) == filepath.Join(s.root, zitadelDir) {
				if err := s.watchZitadelDir(); err != nil {
					slogctx.Error(ctx, "error while watching the .zitadel directory", slogctx.Err(err))
					continue
				}
				if err := s.reloadStateFile(); err != nil {
					slogctx.Error(ctx, "error while reloading the resource index", slogctx.Err(err))
				}
				continue
			}

			apply, watched := reload[filepath.Clean(event.Name)]
			if !watched {
				continue
			}
			if err := apply(); err != nil {
				slogctx.Error(ctx, "error while reloading a watched configuration file",
					slogctx.Err(err), "file", event.Name)
			}
		case err, ok := <-s.watcher.Errors:
			if err != nil {
				slogctx.Error(ctx, "error while watching filesystem", slogctx.Err(err))
			}
			if !ok {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

// reloadZitadelJSON re-reads the project this tree belongs to.
func (s *Store) reloadZitadelJSON() error {
	bs, err := os.ReadFile(s.zitadelJSONPath())
	if err != nil {
		return fmt.Errorf("configfs: read %s: %w", zitadelJSONName, err)
	}

	contents := struct {
		Project string `json:"project"`
	}{}
	if err := json.Unmarshal(bs, &contents); err != nil {
		return fmt.Errorf("configfs: parse %s: %w", zitadelJSONName, err)
	}
	if contents.Project == "" {
		return fmt.Errorf("configfs: %s declares no project", zitadelJSONName)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.projectID = contents.Project
	return nil
}

// reloadStateFile re-reads the resource index.
//
// A missing file is an empty index rather than an error: a hand-authored tree
// never had one, and a project gains it the first time the CLI records an id.
func (s *Store) reloadStateFile() error {
	bs, err := os.ReadFile(s.stateFilePath())
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.state = StateFile{}
			return nil
		}
		return fmt.Errorf("configfs: read %s: %w", stateFileName, err)
	}

	contents := StateFile{}
	if err := json.Unmarshal(bs, &contents); err != nil {
		return fmt.Errorf("configfs: parse %s: %w", stateFileName, err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = contents
	return nil
}

// Root reports the directory this store reads, for diagnostics.
func (s *Store) Root() string { return s.root }

// ProjectID reports the project whose configuration this tree holds, as
// zitadel.json most recently declared it.
func (s *Store) ProjectID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.projectID
}

// idFor returns the id the CLI recorded for a resource file, keyed by its path
// relative to the project root.
//
// Absent is not a failure. A document a developer added by hand has no index
// entry until the CLI syncs it, and the caller falls back to the resource's
// handle so the file is still readable in the meantime.
func (s *Store) idFor(relPath string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	resource, ok := s.state.Resources[filepath.ToSlash(relPath)]
	if !ok || resource.ID == "" {
		return "", false
	}
	return resource.ID, true
}

// serves reports whether a request for projectID addresses this tree. A read
// for any other project is empty rather than an error: the store is one
// project's configuration, and a caller scoped elsewhere simply has nothing
// here.
func (s *Store) serves(projectID string) bool {
	return projectID == "" || projectID == s.ProjectID()
}

// entry is one resource file on disk, already read.
type entry struct {
	// name is the file name without extension, the fallback handle for a kind
	// whose document carries no name of its own.
	name string
	// path is the absolute path, for diagnostics and mtime.
	path string
	// rel is the path relative to the project root, in slash form. It is the
	// key this file has in the index, and so how the entry finds its id.
	rel   string
	bytes []byte
}

// readDir returns every `.json` file in one kind's directory, ordered by name
// so a read is deterministic regardless of filesystem iteration order.
//
// A missing directory is an empty result: a project that authored no flows has
// no `flows/` directory, and that is not a failure.
func (s *Store) readDir(kind string) ([]entry, error) {
	dir := filepath.Join(s.root, kind)
	names, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("configfs: read %s: %w", dir, err)
	}

	entries := make([]entry, 0, len(names))
	for _, name := range names {
		if name.IsDir() || !strings.HasSuffix(name.Name(), ".json") {
			continue
		}
		path := filepath.Join(dir, name.Name())
		content, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("configfs: read %s: %w", path, err)
		}
		entries = append(entries, entry{
			name:  strings.TrimSuffix(name.Name(), ".json"),
			path:  path,
			rel:   kind + "/" + name.Name(),
			bytes: content,
		})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].name < entries[j].name })
	return entries, nil
}

// resourceID is the id a loaded file is served under: the one the CLI recorded
// in the index, or the resource's own handle when the index does not know it.
//
// Preferring the recorded id is what keeps a file-backed resource addressable
// by whatever already points at it — a release pointer, a user's schema
// reference, an RSI row — none of which would resolve against a handle the
// server never minted.
func (s *Store) resourceID(e entry, handle string) string {
	if id, ok := s.idFor(e.rel); ok {
		return id
	}
	return handle
}

// write puts content at kind/name.json, creating the directory if needed.
// The file is written whole via a temporary file and renamed, so a reader that
// walks the tree concurrently never observes a partial document.
func (s *Store) write(kind, name string, content []byte) error {
	dir := filepath.Join(s.root, kind)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("configfs: create %s: %w", dir, err)
	}
	final := filepath.Join(dir, name+".json")

	tmp, err := os.CreateTemp(dir, "."+name+".*.tmp")
	if err != nil {
		return fmt.Errorf("configfs: stage %s: %w", final, err)
	}
	staged := tmp.Name()
	// Best effort: after a successful rename there is nothing left to remove,
	// and on a failure path the error being returned is the useful one.
	defer func() { _ = os.Remove(staged) }()

	if _, err := tmp.Write(content); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("configfs: write %s: %w", staged, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("configfs: close %s: %w", staged, err)
	}
	if err := os.Chmod(staged, 0o600); err != nil {
		return fmt.Errorf("configfs: chmod %s: %w", staged, err)
	}
	if err := os.Rename(staged, final); err != nil {
		return fmt.Errorf("configfs: publish %s: %w", final, err)
	}
	return nil
}

// remove deletes kind/name.json. A file that is already gone is not an error,
// so a delete is idempotent the way the SQL dialects' delete-by-id is.
func (s *Store) remove(kind, name string) error {
	err := os.Remove(filepath.Join(s.root, kind, name+".json"))
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("configfs: remove %s: %w", name, err)
	}
	return nil
}

// fileName turns a resource handle into a file name safe to place in the tree.
//
// Handles reach this from documents and API calls, so a handle containing a
// separator or `..` must not be able to address a path outside the kind's
// directory. Anything outside a conservative set is percent-escaped rather
// than rejected, so a legal handle never fails to persist.
func fileName(handle string) string {
	var b strings.Builder
	for _, r := range handle {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			fmt.Fprintf(&b, "%%%02X", r)
		}
	}
	if b.Len() == 0 {
		return "_"
	}
	return b.String()
}

// indent re-encodes compact JSON so a written document stays readable to the
// person who will edit it next.
func indent(raw []byte) []byte {
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		return raw
	}
	return buf.Bytes()
}
