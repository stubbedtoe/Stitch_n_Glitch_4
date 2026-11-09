# Spike S4 — ATProto OAuth + custom Lexicon round trip

> **Spike ID:** S4 (Build Plan §3) · **Proves:** F-002 / PRD §7.3 auth + custom record path · **Date:** 2026-11-07
> **Question:** Can a Gleam browser client sign in with ATProto OAuth/DPoP against a Spaces-capable PDS and write/read a custom `online.stitchnglitch.*` Lexicon record?

## Verdict

## ✅ PASS

**Full OAuth + XRPC round trip passed against a local Spaces-alpha PDS.** The Gleam app used `atproto_browser` for WebCrypto DPoP, PKCE, PAR, authorization-code exchange, token verification, and DPoP-signed resource requests. It then wrote and read back:

```text
at://did:plc:go75jer5nwy72aqyr527bifh/online.stitchnglitch.spike/self
```

The write and read CIDs match (`bafyreid6335u7aufpyjuij4xoaokdbgmusa3edrauywnnl4gu3eiqijcby`), and the decoded record contains the expected name and seed.

| Build-plan bar | Result |
| --- | --- |
| Sign in with DPoP against a Spaces-enabled PDS | ✅ PASS |
| Auth isolated behind an adapter | ✅ PASS — `atproto_browser` OAuth/XRPC boundary |
| Write custom `online.stitchnglitch.*` record | ✅ PASS |
| Read same record back | ✅ PASS — URI and CID match |
| No token leakage into result artifact | ✅ PASS — result stores metadata only |

## Environment

| | |
| --- | --- |
| Machine | MacBook Air (Mac14,2), Apple M2, 8 GB RAM, fanless |
| PDS | `ghcr.io/bluesky-social/atproto:pds-spaces-alpha`, health version `0.5.32` |
| Browser | Google Chrome 156 (`HeadlessChrome/156.0.0.0`), CDP-driven |
| Gleam | 1.19.2 |
| ATProto client | `atproto_browser` 0.3.1 + `atproto_core` 0.2.2 |
| Node / Docker | v23.11.0 / Docker 29.4.3 |
| Test account | `spike4.test` (`did:plc:go75jer5nwy72aqyr527bifh`) — local sandbox only |

## What is wired together

```text
scripts/run-spike.mjs
  starts Spaces-alpha PDS in Docker
  creates/reuses local test account
  serves Gleam production bundle + callback relay

src/sng_spike4.gleam
  atproto_browser WebCrypto DPoP key + PKCE
  DID -> PDS -> authorization-server discovery
  PAR -> browser authorization -> code exchange
  VerifiedSession + DPoP resource client
  com.atproto.repo.putRecord
  com.atproto.repo.getRecord + typed decode/verify

src/sng_spike4_ffi.mjs
  tiny browser DOM renderer + Promise retention only
  no OAuth/XRPC logic in TypeScript/JavaScript
```

The local PDS accepted the loopback public-client convention:

```text
client_id = http://localhost?scope=atproto%20transition%3Ageneric
              &redirect_uri=http%3A%2F%2F127.0.0.1%3A4173%2Fcallback
```

## Recorded result

| Check | Result |
| --- | :-: |
| OAuth session verified as DPoP with expected scope | ✅ |
| Account DID/handle match the PDS test account | ✅ |
| PDS and issuer both identify the local Spaces PDS | ✅ |
| Custom Lexicon write URI | ✅ |
| Read URI/CID match write URI/CID | ✅ |
| Decoded record name/seed match | ✅ |

Raw artifact: `results/spike4-browser-result.json`.

## Key findings for M6 design

1. **Gleam libraries can own the whole auth boundary.** `atproto_browser` handled the protocol-critical pieces; no TypeScript OAuth client was needed.
2. **Use `flow.start_with` only for local dev.** The spike parses the local DID directory with `remote.AllowLocalDevelopment`. Production must use the strict public PLC path (`flow.start`) with HTTPS origins.
3. **Loopback OAuth clients are different from production web clients.** The local PDS accepted the ATProto loopback `client_id`; a production discoverable web client needs HTTPS client metadata and redirect URIs.
4. **Custom records do not need PDS registration for the round trip.** The Spaces-alpha PDS accepted `online.stitchnglitch.spike` and reported `validationStatus: unknown`; production still needs published Lexicons, schema versioning, and migration policy.
5. **Keep tokens out of diagnostics.** The gate records DIDs, record URIs/CIDs, scope, and pass/fail metadata only — never access or refresh tokens.
6. **S3 remains the Lustre/UI proof.** This spike deliberately keeps the S4 protocol harness small and renders status through a tiny FFI; M6 should wrap the verified `atproto_browser` boundary in the S3 Lustre architecture.

## Reproduce

```bash
npm install
gleam test
npm run spike
```

`npm run spike` starts the local PDS, builds the Gleam/Vite bundle, runs headless Chrome through the OAuth consent flow, writes/reads the record, validates the result, and stops the PDS container. The local `.pds/` state is ignored and can be deleted to reset the sandbox.

## Scope notes / known limitations

- **Alpha PDS, alpha Spaces.** The image is explicitly `pds-spaces-alpha`; production Spaces behavior remains GA-gated per the PRD.
- **Local DID trust policy.** The DID document is served by the spike harness so `http://localhost` can work; this is a devnet path, not a production identity-security proof.
- **One local account/browser measured.** The goal was protocol integration, not multi-account, multi-PDS, or browser-matrix coverage.
- **OAuth scope is transition-generic.** Future granular permission sets should be revisited when the permission system stabilizes.
- **No sync engine yet.** This proves F-002’s authenticated XRPC boundary and custom record round trip; F-016 sync/LWW logic remains M6 work.
