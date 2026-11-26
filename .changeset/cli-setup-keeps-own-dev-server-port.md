---
"@zitadel/cli": patch
---

`setup` no longer warns about, or asks to move off, a dev port held by the app's own dev server: a process running in the app's folder is taken for it, so the app stays on the port it is running on. When another process holds the port, the warning now names it (`node (pid 4242)`) and suggests stopping it or running `setup --dev-port` with a free port.
