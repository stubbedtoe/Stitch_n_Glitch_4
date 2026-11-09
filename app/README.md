# sng

[![Package Version](https://img.shields.io/hexpm/v/sng)](https://hex.pm/packages/sng)
[![Hex Docs](https://img.shields.io/badge/hex-docs-ffaff3)](https://sng.hexdocs.pm/)

```sh
gleam add sng@1
```
```gleam
import sng

pub fn main() -> Nil {
  // TODO: An example of the project in use
}
```

Further documentation can be found at <https://sng.hexdocs.pm/>.

## Development

Two steps (from the repo root):
app/scripts/build_static.sh   # 1. gleam build + assemble the servable app into app/priv/static/
app/e2e/serve.sh              # 2. serve it at http://localhost:4719
Then open http://localhost:4719 — you get the library browser straight away (no sign-in wall). Use "Create blank document" (8×8 works well), draw with the pencil, try going offline in DevTools (offline indicator appears, everything keeps working), and reload to see persistence.
Notes:
- Re-run build_static.sh whenever you change Gleam sources; the serve step itself just serves whatever is in priv/static/.
- serve.sh is the e2e harness's server, but it's just python3 -m http.server 4719 --directory app/priv/static — you can use any static server you like.
- Service worker + installability need localhost (or HTTPS); it won't work from a raw file:// open.
- Run the test suites with cd app && gleam test and cd app/e2e && npx playwright test.

Future:
Lustre dev server — `gleam add --dev lustre_dev_tools`, then `gleam run -m lustre/dev start` gives you a hot-reloading dev server, nice for UI iteration. Two caveats: it serves its own generated HTML rather than priv_static_src/index.html, so the manifest/service-worker PWA chrome won't be there in dev mode; and it would add a dev dependency and config we don't currently have.
