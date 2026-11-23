---
"@zitadel/cli": minor
---

A command line the CLI refuses, including a flag typed twice, is one coded failure with the command's help as its next step, like every other failure, and no longer repeats the framework's own error text in the `--json` envelope.

**Breaking:** a script that read `details.original` from such a failure no longer finds it.
