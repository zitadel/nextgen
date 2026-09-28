---
"@zitadel/server": patch
---

The server no longer mistakes projected-volume metadata for a master key. Keys discovered in the master key directory are identified by file name, and the scan skipped only directories — but a Kubernetes-style projected secret volume (the shape Cloud Run and GKE mount secrets with) also contains `..data`, a *symlink* to a timestamped directory. Symlinks are not directories, so `..data` was adopted as a key named `..data` and startup failed with `failed to read encryption key file ".../..data": is a directory`.

Dot-prefixed entries are now skipped, and the scan follows symlinks so a linked directory is skipped like a real one and the modification time that picks the newest key is the key's rather than the link's. A stray `.DS_Store` or editor swap file no longer becomes the deployment's master key either.
