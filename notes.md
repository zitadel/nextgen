# Error when running commands from readme

```bash
mkdir test
cd test

npx @zitadel/cli@alpha doctor
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --server local
```
```

The sequence of these commands yields an error: 
```bash
Error E_FRAMEWORK_NOT_DETECTED: Could not detect a supported app framework, and this directory is not empty
Directory is not empty (contains .gitignore, .zitadel). Pass --force to scaffold into this non-empty directory, run setup from an empty directory, or run setup from an existing supported app project.
```

Easily solved by adding the `--force` flag, but still.

