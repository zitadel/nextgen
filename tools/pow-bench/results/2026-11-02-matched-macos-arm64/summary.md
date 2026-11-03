# Matched PoW measurements

Environment: {"node":"v24.22.0","platform":"darwin","os_release":"27.2.0","arch":"arm64","cpu":"Apple M5 Max","logical_cpus":18,"memory_bytes":38654705664,"esbuild":"0.28.1","worker_bytes":34078,"altcha_go":"2.4.1","altcha_js":"2.8.0","hash_wasm":"4.12.0","playwright":"1.64.1"}; Go go1.26.9.

Solve milliseconds: nearest-rank p50 / p95 / p99. At n=32 p99 is the maximum, not a stable population tail. Own/ALTCHA ratios use paired samples, not ratios of percentiles. A ratio below 1 favors own code. Cold solves are excluded. Families use different trial ranges: compare within a matched profile, not as equal-security or equal-work algorithms.

| Profile | Trials | Implementation | Go solve | Chromium solve | WebKit solve |
|---|---:|---|---:|---:|---:|
| pbkdf2_5000_l1 | 512 | own | 92.35 / 190.50 / 193.65 | 70.60 / 146.20 / 148.90 | 127.00 / 269.00 / 279.00 |
| pbkdf2_5000_l1 | 512 | altcha | 92.74 / 191.18 / 194.23 | 70.70 / 146.20 / 149.00 | 135.00 / 275.00 / 283.00 |
| pbkdf2_5000_l2 | 1024 | own | 184.51 / 381.95 / 388.35 | 141.90 / 294.00 / 297.50 | 260.00 / 532.00 / 633.00 |
| pbkdf2_5000_l2 | 1024 | altcha | 185.43 / 382.03 / 388.30 | 142.20 / 294.10 / 301.90 | 257.00 / 532.00 / 575.00 |
| pbkdf2_5000_l3 | 2048 | own | 375.89 / 763.57 / 775.90 | 284.50 / 587.10 / 594.70 | 512.00 / 1068.00 / 1102.00 |
| pbkdf2_5000_l3 | 2048 | altcha | 371.18 / 766.83 / 776.74 | 284.10 / 587.80 / 598.20 | 526.00 / 1075.00 / 1087.00 |
| pbkdf2_5000_l4 | 4096 | own | 737.89 / 1528.08 / 1549.07 | 568.70 / 1188.30 / 1189.70 | 1067.00 / 2168.00 / 2207.00 |
| pbkdf2_5000_l4 | 4096 | altcha | 741.34 / 1527.74 / 1557.61 | 567.60 / 1190.80 / 1194.00 | 1044.00 / 2168.00 / 2174.00 |
| argon2id_4m_l1 | 32 | own | 22.34 / 45.99 / 46.10 | 29.00 / 59.10 / 60.10 | 41.00 / 83.00 / 84.00 |
| argon2id_4m_l1 | 32 | altcha | 22.27 / 46.15 / 46.27 | 25.80 / 58.10 / 59.60 | 42.00 / 84.00 / 87.00 |
| argon2id_4m_l2 | 64 | own | 44.48 / 90.71 / 92.38 | 52.10 / 111.90 / 112.20 | 85.00 / 170.00 / 174.00 |
| argon2id_4m_l2 | 64 | altcha | 44.44 / 90.90 / 91.94 | 56.80 / 113.70 / 113.80 | 85.00 / 170.00 / 173.00 |
| argon2id_4m_l3 | 128 | own | 87.56 / 181.07 / 185.08 | 104.90 / 217.50 / 219.10 | 159.00 / 331.00 / 340.00 |
| argon2id_4m_l3 | 128 | altcha | 87.49 / 180.54 / 182.85 | 104.10 / 220.20 / 221.30 | 161.00 / 333.00 / 335.00 |
| argon2id_4m_l4 | 256 | own | 173.86 / 359.55 / 364.95 | 211.60 / 443.40 / 444.00 | 324.00 / 658.00 / 665.00 |
| argon2id_4m_l4 | 256 | altcha | 174.05 / 359.28 / 365.31 | 212.40 / 445.60 / 448.40 | 320.00 / 656.00 / 672.00 |
| argon2id_16m_l1 | 8 | own | 22.97 / 45.95 / 46.01 | 27.60 / 58.10 / 61.10 | 32.00 / 64.00 / 64.00 |
| argon2id_16m_l1 | 8 | altcha | 22.93 / 46.01 / 46.14 | 27.80 / 54.50 / 54.50 | 33.00 / 64.00 / 64.00 |
| argon2id_16m_l2 | 16 | own | 46.01 / 92.11 / 92.83 | 54.80 / 108.70 / 112.10 | 62.00 / 127.00 / 127.00 |
| argon2id_16m_l2 | 16 | altcha | 46.02 / 92.09 / 94.94 | 56.60 / 115.10 / 117.00 | 63.00 / 128.00 / 128.00 |
| argon2id_16m_l3 | 32 | own | 86.29 / 178.24 / 178.26 | 104.20 / 220.40 / 221.30 | 116.00 / 244.00 / 244.00 |
| argon2id_16m_l3 | 32 | altcha | 86.16 / 178.24 / 179.06 | 105.50 / 220.80 / 223.10 | 118.00 / 245.00 / 245.00 |
| argon2id_16m_l4 | 64 | own | 173.38 / 356.61 / 359.95 | 210.30 / 437.50 / 442.70 | 234.00 / 480.00 / 482.00 |
| argon2id_16m_l4 | 64 | altcha | 173.23 / 350.91 / 356.16 | 211.40 / 430.90 / 433.30 | 238.00 / 484.00 / 485.00 |
| argon2id_64m_l1 | 2 | own | 26.33 / 51.24 / 52.55 | 31.50 / 62.50 / 62.60 | 32.00 / 63.00 / 63.00 |
| argon2id_64m_l1 | 2 | altcha | 25.31 / 50.94 / 52.34 | 34.00 / 63.80 / 67.70 | 32.00 / 63.00 / 63.00 |
| argon2id_64m_l2 | 4 | own | 51.19 / 100.15 / 100.22 | 67.40 / 127.30 / 140.10 | 63.00 / 124.00 / 125.00 |
| argon2id_64m_l2 | 4 | altcha | 50.06 / 100.16 / 100.34 | 61.00 / 134.90 / 143.40 | 63.00 / 125.00 / 126.00 |
| argon2id_64m_l3 | 8 | own | 100.06 / 211.65 / 216.71 | 121.20 / 249.40 / 259.80 | 123.00 / 248.00 / 249.00 |
| argon2id_64m_l3 | 8 | altcha | 99.89 / 201.88 / 227.98 | 131.60 / 246.90 / 261.60 | 124.00 / 247.00 / 248.00 |
| argon2id_64m_l4 | 16 | own | 199.86 / 402.25 / 407.80 | 258.50 / 500.20 / 500.60 | 247.00 / 505.00 / 508.00 |
| argon2id_64m_l4 | 16 | altcha | 200.47 / 402.67 / 433.03 | 238.80 / 493.10 / 503.20 | 247.00 / 501.00 / 505.00 |

Paired median own/ALTCHA solve ratios and browser/Go ratios for own code:

| Profile | Go own/ALTCHA | Chromium own/ALTCHA | WebKit own/ALTCHA | Chromium/Go own | WebKit/Go own |
|---|---:|---:|---:|---:|---:|
| pbkdf2_5000_l1 | 0.998 | 1.000 | 0.991 | 0.769 | 1.396 |
| pbkdf2_5000_l2 | 0.999 | 1.000 | 0.993 | 0.768 | 1.399 |
| pbkdf2_5000_l3 | 0.997 | 1.000 | 1.000 | 0.768 | 1.405 |
| pbkdf2_5000_l4 | 0.998 | 1.000 | 0.999 | 0.769 | 1.409 |
| argon2id_4m_l1 | 1.000 | 1.002 | 1.000 | 1.207 | 1.823 |
| argon2id_4m_l2 | 1.000 | 0.979 | 1.000 | 1.198 | 1.839 |
| argon2id_4m_l3 | 1.001 | 0.998 | 1.000 | 1.208 | 1.830 |
| argon2id_4m_l4 | 0.999 | 1.001 | 1.002 | 1.211 | 1.831 |
| argon2id_16m_l1 | 1.000 | 1.002 | 1.000 | 1.188 | 1.384 |
| argon2id_16m_l2 | 1.000 | 1.000 | 1.000 | 1.189 | 1.375 |
| argon2id_16m_l3 | 1.000 | 1.000 | 1.000 | 1.206 | 1.372 |
| argon2id_16m_l4 | 1.001 | 0.990 | 0.994 | 1.209 | 1.360 |
| argon2id_64m_l1 | 1.000 | 0.994 | 1.000 | 1.190 | 1.243 |
| argon2id_64m_l2 | 0.999 | 1.003 | 1.000 | 1.194 | 1.242 |
| argon2id_64m_l3 | 0.996 | 1.005 | 1.000 | 1.168 | 1.207 |
| argon2id_64m_l4 | 0.999 | 1.000 | 1.000 | 1.192 | 1.238 |

Server microseconds/op: median of three repeated batch means. Decode includes strict parsing of the stored challenge, not proof parsing or database/HTTP admission. Bytes/allocations are Go allocations per issuance; not live memory.

| Profile | Implementation | Issue | Verify | Bad work | Decode + verify | Issue bytes / allocations |
|---|---|---:|---:|---:|---:|---:|
| pbkdf2_5000_l1 | own | 398.41 | 1.64 | 1.67 | 10.24 | 4128 / 40 |
| pbkdf2_5000_l1 | altcha | 411.32 | 16.92 | 16.85 | 32.33 | 18477 / 474 |
| pbkdf2_5000_l2 | own | 397.74 | 1.74 | 1.59 | 10.21 | 4127 / 40 |
| pbkdf2_5000_l2 | altcha | 409.75 | 16.79 | 16.95 | 32.41 | 18477 / 474 |
| pbkdf2_5000_l3 | own | 397.08 | 1.75 | 1.70 | 10.03 | 4127 / 40 |
| pbkdf2_5000_l3 | altcha | 412.46 | 16.79 | 16.56 | 32.40 | 18477 / 474 |
| pbkdf2_5000_l4 | own | 398.06 | 1.77 | 1.74 | 10.35 | 4127 / 40 |
| pbkdf2_5000_l4 | altcha | 410.15 | 16.80 | 16.65 | 32.61 | 18477 / 474 |
| argon2id_4m_l1 | own | 1489.80 | 1.84 | 1.74 | 10.15 | 4201124 / 47 |
| argon2id_4m_l1 | altcha | 1505.56 | 17.50 | 17.35 | 33.43 | 4217877 / 513 |
| argon2id_4m_l2 | own | 1487.16 | 1.81 | 1.78 | 10.17 | 4201124 / 47 |
| argon2id_4m_l2 | altcha | 1504.36 | 17.45 | 17.22 | 33.33 | 4217877 / 513 |
| argon2id_4m_l3 | own | 1492.25 | 1.88 | 1.79 | 10.26 | 4201264 / 48 |
| argon2id_4m_l3 | altcha | 1509.37 | 18.09 | 17.85 | 34.28 | 4221067 / 516 |
| argon2id_4m_l4 | own | 1490.29 | 1.91 | 1.78 | 10.47 | 4201168 / 47 |
| argon2id_4m_l4 | altcha | 1509.62 | 18.23 | 18.30 | 34.57 | 4220853 / 515 |
| argon2id_16m_l1 | own | 5785.04 | 1.96 | 1.84 | 10.52 | 16784238 / 48 |
| argon2id_16m_l1 | altcha | 5810.85 | 18.77 | 18.08 | 34.80 | 16803641 / 512 |
| argon2id_16m_l2 | own | 5810.75 | 1.93 | 1.82 | 11.73 | 16784222 / 48 |
| argon2id_16m_l2 | altcha | 5830.39 | 18.61 | 18.34 | 34.82 | 16803808 / 515 |
| argon2id_16m_l3 | own | 5776.24 | 2.00 | 1.88 | 10.64 | 16784138 / 47 |
| argon2id_16m_l3 | altcha | 5801.62 | 18.57 | 18.41 | 34.96 | 16803949 / 516 |
| argon2id_16m_l4 | own | 5780.46 | 1.94 | 1.83 | 10.51 | 16784215 / 48 |
| argon2id_16m_l4 | altcha | 5804.32 | 18.61 | 18.39 | 35.22 | 16804096 / 517 |
| argon2id_64m_l1 | own | 25101.86 | 1.87 | 1.82 | 10.85 | 67116854 / 46 |
| argon2id_64m_l1 | altcha | 25512.20 | 19.02 | 18.69 | 35.34 | 67138237 / 516 |
| argon2id_64m_l2 | own | 27216.74 | 1.88 | 1.86 | 11.33 | 67117094 / 48 |
| argon2id_64m_l2 | altcha | 26026.39 | 20.69 | 20.30 | 38.33 | 67137647 / 513 |
| argon2id_64m_l3 | own | 25283.35 | 1.93 | 1.84 | 11.13 | 67116994 / 47 |
| argon2id_64m_l3 | altcha | 25259.29 | 19.21 | 19.28 | 35.96 | 67138150 / 516 |
| argon2id_64m_l4 | own | 25130.14 | 1.87 | 1.87 | 11.12 | 67116854 / 46 |
| argon2id_64m_l4 | altcha | 25086.30 | 19.32 | 19.03 | 36.33 | 67137604 / 515 |

Separate issuer processes; three issuance calls per worker, synchronized starts. Sampled heap is a 200 µs observation, RSS is the process high-water mark including runtime. GC and scheduling make these illustrative, not capacity bounds.

| Profile | Implementation | Concurrency | Peak heap MiB | Max RSS MiB |
|---|---|---:|---:|---:|
| pbkdf2_5000_l1 | own | 1 | 0.38 | 11.08 |
| pbkdf2_5000_l1 | own | 4 | 0.42 | 11.50 |
| pbkdf2_5000_l1 | own | 8 | 0.50 | 12.08 |
| pbkdf2_5000_l1 | altcha | 1 | 0.43 | 11.14 |
| pbkdf2_5000_l1 | altcha | 4 | 0.60 | 11.78 |
| pbkdf2_5000_l1 | altcha | 8 | 0.83 | 12.59 |
| argon2id_4m_l1 | own | 1 | 12.39 | 23.73 |
| argon2id_4m_l1 | own | 4 | 40.43 | 52.50 |
| argon2id_4m_l1 | own | 8 | 64.47 | 77.66 |
| argon2id_4m_l1 | altcha | 1 | 12.42 | 23.86 |
| argon2id_4m_l1 | altcha | 4 | 32.49 | 45.16 |
| argon2id_4m_l1 | altcha | 8 | 60.58 | 81.84 |
| argon2id_16m_l1 | own | 1 | 32.37 | 43.69 |
| argon2id_16m_l1 | own | 4 | 128.42 | 141.19 |
| argon2id_16m_l1 | own | 8 | 256.47 | 270.42 |
| argon2id_16m_l1 | altcha | 1 | 32.41 | 44.06 |
| argon2id_16m_l1 | altcha | 4 | 128.50 | 142.28 |
| argon2id_16m_l1 | altcha | 8 | 272.67 | 302.48 |
| argon2id_64m_l1 | own | 1 | 128.37 | 139.88 |
| argon2id_64m_l1 | own | 4 | 512.42 | 525.56 |
| argon2id_64m_l1 | own | 8 | 1088.47 | 1102.55 |
| argon2id_64m_l1 | altcha | 1 | 128.40 | 141.25 |
| argon2id_64m_l1 | altcha | 4 | 512.50 | 526.14 |
| argon2id_64m_l1 | altcha | 8 | 1024.62 | 1038.89 |

Browser checks and limitations:

- chromium 156.0.8078.4: 1024 proofs verified in Go, 0 timeouts; largest 10 ms main-thread timer interval 12.90 ms. No-WASM CSP probe: blocked as expected.
  - pbkdf2_5000: observed peak linear memory instantiated within one KDF call 0.00 MiB, not total browser RSS. Cold own/ALTCHA solve 108.20 / 103.10 ms; worker startup 7.10 / 1.90 ms.
  - argon2id_4m: observed peak linear memory instantiated within one KDF call 4.44 MiB, not total browser RSS. Cold own/ALTCHA solve 45.30 / 42.00 ms; worker startup 2.60 / 2.00 ms.
  - argon2id_16m: observed peak linear memory instantiated within one KDF call 16.44 MiB, not total browser RSS. Cold own/ALTCHA solve 43.50 / 43.80 ms; worker startup 2.60 / 1.80 ms.
  - argon2id_64m: observed peak linear memory instantiated within one KDF call 64.44 MiB, not total browser RSS. Cold own/ALTCHA solve 63.10 / 62.90 ms; worker startup 2.60 / 1.70 ms.
- firefox: unavailable; launch error recorded in raw JSON.
- webkit 27.2: 1024 proofs verified in Go, 0 timeouts; largest 10 ms main-thread timer interval 16.00 ms. No-WASM CSP probe: blocked as expected.
  - pbkdf2_5000: observed peak linear memory instantiated within one KDF call 0.00 MiB, not total browser RSS. Cold own/ALTCHA solve 200.00 / 192.00 ms; worker startup 8.00 / 2.00 ms.
  - argon2id_4m: observed peak linear memory instantiated within one KDF call 4.44 MiB, not total browser RSS. Cold own/ALTCHA solve 61.00 / 64.00 ms; worker startup 3.00 / 2.00 ms.
  - argon2id_16m: observed peak linear memory instantiated within one KDF call 16.44 MiB, not total browser RSS. Cold own/ALTCHA solve 50.00 / 52.00 ms; worker startup 3.00 / 2.00 ms.
  - argon2id_64m: observed peak linear memory instantiated within one KDF call 64.44 MiB, not total browser RSS. Cold own/ALTCHA solve 65.00 / 67.00 ms; worker startup 4.00 / 2.00 ms.
