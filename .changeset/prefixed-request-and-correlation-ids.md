---
"@zitadel/server": patch
---

Request and correlation IDs now say what they are. A new correlation ID is `corr_` and 32 hex digits, and the console's Events search takes `corr_…` straight to its chain. A request ID taken from a proxy (`server.request_id_header`) is now `req_` and the proxy's ID, as a minted one is: on the hosted cloud, search Vercel's logs for the part after `req_`.
