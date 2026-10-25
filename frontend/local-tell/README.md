# LocalTell Web

Offline-first Angular 22 companion to the LocalTell Android app. Main use: someone reads you a
19-digit or 15-character LocalTell code over the phone, you decode it, see it on a map and open
Google Maps. The reverse also works: click the map or paste a Google Maps link to generate both
codes.

## Architecture

| Area | Location | Notes |
|---|---|---|
| Location codes | `src/app/core/location-code/` | Exact BigInt port of Android `LocalTellLocationCode.kt` (V1). |
| Input parsing | `src/app/core/location-input/`, `core/maps-links/` | Port of `LocationInputParser.kt`; strict Google Maps / `geo:` link parser. |
| Offline packs | `core/geographic-packs/`, `core/offline-resolver/` | Manifest/catalog port, SHA-256 + bounded gunzip, sql.js in Web Workers, Android resolver port. |
| Saved Places / backup | `core/saved-places/`, `core/backup/` | Android identity/merge rules, strict `.bklt` codec (schema 1). |
| Dropbox | `core/dropbox/` | Official SDK, OAuth code + PKCE, verified append-only uploads. |
| Storage | `core/storage/idb.ts` | Versioned IndexedDB with additive migrations. |
| Features | `src/app/features/*` | Lazy-loaded standalone routes. |

Configuration lives in `src/environments/` and `src/config/manifest-sources.json`. Nothing in browser
configuration is secret.

## Requirements

- Node.js `>=22.22.3` (CI uses `.nvmrc`, 24.16.0); npm 10+.
- Install with `npm ci` inside `frontend/local-tell` (not the repository root).

## Commands

```bash
npm run develop        # dev server on http://localhost:3041 (proxies /data-mirror to GitHub Releases)
npm run build          # production build
npm run build:gh       # production build + 404.html with base href /localtell-data/
                       # (cross-platform; override with BASE_HREF=/x/ or `npm run build:gh -- --base-href=/x/`)
npm run mirror:data    # copy manifests + SHA-256-verified packs into dist/.../data-mirror (add `-- --countries=LK` for a subset)
npm run serve:dist     # serve dist like GitHub Pages at http://localhost:4300/localtell-data/
npm run lint
npm run test:ci        # Vitest unit tests + Node script tests
npm run e2e            # Playwright browser tests against the served production build
```

Browser tests launch Playwright's Chromium (`npx playwright install chromium`). Where Linux browsers
cannot run (e.g. WSL1), start Windows Chrome with `--remote-debugging-port=9222` and set
`PW_CDP_ENDPOINT=http://localhost:9222`. Set `E2E_PACKS=1` after `npm run mirror:data` to include
the real pack download test.

### Android interoperability fixtures

`src/testing/fixtures/android/` holds `.bklt` files written by Android's own `AppBackupCodec.kt`
(JVM unit-test runtime) plus Android's decode result for a web-written file. The generator test is
kept as `WebFixtureGeneratorTest.kt.txt`; run it in a scratch copy of the Android repository, not in
the Android repository itself.

## Works offline vs needs internet

| Offline (after first load) | Needs internet |
|---|---|
| Encode/decode both LocalTell codes | Map tiles |
| Coordinate and Maps-link parsing | Pack catalog and downloads |
| Saved Places, recent lookups, comparisons history | IP location |
| Locality lookup from installed packs | Dropbox, opening Google Maps |

Decoding never depends on tiles, packs or the network.

## Geographic packs and hosting

GitHub Release download URLs send no CORS headers (verified with `curl`), so a browser cannot fetch
them directly. `downloadMirrors` rewrites the exact prefix
`https://github.com/actionanand/localtell-data/releases/download/` to `data-mirror/` relative to the
base href. In development `proxy.conf.mjs` serves that path and rewrites GitHub's signed-asset redirects to same-origin paths; on GitHub Pages the workflow runs
`npm run mirror:data`, which verifies each pack's SHA-256 against the manifest before publishing.
The client re-verifies SHA-256, decompresses with size bounds, runs `PRAGMA integrity_check` and the
schema-v3 contract, then activates the pack in one IndexedDB transaction, so a failed or cancelled
update keeps the previous version. Only schema-v3 (geographic) packs are usable in a browser.

Add a country by appending to `src/config/manifest-sources.json` (`layout` `FLAT`, or `REGIONS` for India).

## Map tiles

`environment.tiles` defaults to the public OpenStreetMap tile server with attribution. That server
is not for heavy production traffic ([tile usage policy](https://operations.osmfoundation.org/policies/tiles/));
configure your own provider for heavy production traffic. Attribution remains on the map, including
mobile and expanded views. The browser sends an origin Referer under
`strict-origin-when-cross-origin` and handles Cache-Control, Expires and ETag normally. No forced
no-cache headers, tile prefetch, bulk download or offline tile cache is added. The service worker
caches only application assets; downloaded locality SQLite packs are separate from map tiles.
Browser compliance tests use intercepted requests and a local cache fixture, not public OSM traffic.

## IP location

`environment.ipGeolocation.provider` is `ipapi-co`, `ipwho-is` or `none`. A request is sent only when
the user asks, after a disclosure that the provider sees their IP. Results are approximate, and the
comparison screen does not claim to detect a VPN.

## Dropbox

1. In the existing LocalTell app in the [Dropbox App Console](https://www.dropbox.com/developers/apps)
   (App Folder access), add the redirect URI, e.g.
   `https://actionanand.github.io/localtell-data/dropbox/callback` and `http://localhost:3041/dropbox/callback`.
2. Keep scopes `account_info.read`, `files.metadata.read`, `files.content.read`, `files.content.write`.
3. Set the GitHub Actions repository secret **`DROPBOX_APP_KEY`** to the public App key of that
  same Android App Folder registration, not a generated user token. Never add the App secret.
  Keep `environment.dropbox.appKey` as `DROPBOX_APP_KEY_PLACEHOLDER` in source.
4. CI runs `node scripts/inject-dropbox-key.mjs` before the production build, following
  [ping-metric's build-time injection approach](https://github.com/actionanand/ping-metric/blob/794a0da334ca40ce052b5e1ed2bde50d7c0c33ec/scripts/inject-env.js).
  It validates the key without logging it and replaces only the exact placeholder. A real
  `main-github` deployment fails if the key is missing. PR/manual validation without a secret
  builds with Dropbox disabled. `node scripts/inject-dropbox-key.mjs --verify` checks the built
  JavaScript for the configured public key and rejects unresolved placeholders before publishing.
5. Set `redirectUri` only if it differs from `<origin><base href>dropbox/callback`. It must be
  same-origin HTTPS (HTTP is allowed on localhost) and exactly registered with Dropbox.

Local development explicitly disables Dropbox; a production build left with the placeholder also
disables it at runtime. For a local production configuration check, provide the key via the process
environment and run injection, build, then verification. The injected source is a build artifact;
restore the placeholder before committing. The deployed App key is intentionally public JavaScript.

Backups go in `/localtell-managed-backups`, shown as *Apps / LocalTell / localtell-managed-backups*.
Dropbox owns the App Folder root, so it cannot be moved under *Apps / AR Apps*. Tokens are kept in
`sessionStorage` by default. "Remember on this browser" uses `localStorage`. Both are readable by
scripts on the origin and are not an encrypted token vault; persistent sign-in increases exposure.
OAuth uses the official SDK, authorization codes, PKCE and state verification; no App secret is used.
The existing refresh-token handling is preserved. This differs from Dropbox's
[pure-browser recommendation](https://docs.dropboxapi.com/dropbox-api/docs/oauth) of short-lived
tokens with PKCE and no refresh token. Use session-only sign-in on trusted browsers; a future
short-lived-only mode would reduce that risk. No browser scheduling guarantee is made.

The web app never deletes, renames or overwrites Dropbox files. Uploads use add mode with
`strict_conflict`, then download the exact revision to verify it. Retention cleanup is not
implemented, so backups created here are never removed by the web app. Restores show a preview
and need confirmation. When local and remote data differ, you choose what happens.

As on Android, a Dropbox merge keeps every unique Saved Place even past the configured limit
(`maxSavedPlaces`, 30). While Saved Places is over the limit, new saves and Dropbox sync/upload are
paused; the Dropbox page offers to remove only the oldest extra places after confirmation, or you
can delete places manually. If a merge commits locally but its follow-up upload fails or Dropbox
changes meanwhile, the app reports that the merge was applied and the upload is still pending.
Status is computed from a fresh local snapshot after each upload, so edits made during an upload
show as "changes not in Dropbox yet".

## `.bklt` compatibility

Android's `.bklt` envelope (`localtell-backup`, schema 1, string payload, SHA-256 of the UTF-8
payload, 12 MiB cap, strict JSON) is ported with Android's tests. It contains Saved Places and
Journey data only. 64-bit cell IDs are preserved as strings. Web-only data (comparisons, recent
lookups, packs, settings) is never written into `.bklt`. The format is checksummed, **not
encrypted**. Browser storage is also not equivalent to Android's encrypted storage.

## Supported Maps links

`/maps/search/?api=1&query=lat,lng`, `?q=` / `?q=loc:`, `/maps/place/lat,lng`, DMS place paths,
`!3d…!4d…` marker data, `/maps/dir/…` (last waypoint), `destination=` / `daddr=` and `geo:` URIs.
A viewport-only `/@lat,lng,z` link needs confirmation. Short `maps.app.goo.gl` links cannot be
resolved in a browser (CORS); open them, then paste the full link or the coordinates.

## Known limitations

- Browsers cannot run Android-style exact background schedules. Dropbox sync is manual, with
  optional checks when the app opens or the connection returns.
- Browser storage can be evicted. Request persistent storage from Offline Data.
- Device location may come from GPS, Wi-Fi or network data, depending on the browser.

## Cloning Guide

1.  Clone only the remote primary HEAD (default: origin/main)

```bash
git clone <url> --single-branch
```

2. Only specific branch

```bash
git clone <url> --branch <branch> --single-branch [<folder>]
```

```bash
git clone <url> --branch <branch>
```

3. Cloning repositories using degit
   - main branch is default.

```bash
npx degit github:user/repo#branch-name <folder-name>
```

4. Cloning repositories using **gitpick**

```bash
npx gitpick github_proj_url -b branch-name
```

5. Cloning this project with skeleton

```bash
git clone https://github.com/actionanand/local-tell.git --branch 1-skeleton new-proj-name
```

```bash
npx degit github:actionanand/local-tell#1-skeleton new-proj-name
```

```bash
npx gitpick https://github.com/actionanand/local-tell -b 1-skeleton
```

## Automate using `Prettier`, `Es Lint` and `Husky`

1. Install the compatible node version

```bash
  nvm install v24.16.0
```

2. Install and Configure Prettier
   - Install prettier as below:

   ```bash
     npm install prettier -D
   ```

   - Create a `.prettierrc.yml` file and write down the format as below: - [online ref](https://prettier.io/docs/en/options.html)

   ```yml
   trailingComma: 'all'
   tabWidth: 2
   useTabs: false
   semi: true
   singleQuote: true
   bracketSpacing: true
   bracketSameLine: true
   arrowParens: 'avoid'
   printWidth: 120
   overrides:
     - files:
         - '*.js'
         - '*.jsx'
       options:
         bracketSpacing: true
         jsxSingleQuote: true
         semi: true
         singleQuote: true
         tabWidth: 2
         useTabs: false
     - files:
         - '*.ts'
       options:
         tabWidth: 2
   ```

   - Create a `.prettierignore` file and write as below(sample)

   ```gitignore
   # Ignore artifacts:
   build
   coverage
   e2e
   node_modules
   dist
   dest
   reports

   # Ignore files
   *.lock
   package-lock.json
   yarn.lock
   ```

3. Install `Es Lint`, if not installed

```bash
ng add @angular-eslint/schematics
```

if error comes, use the below command

```shell
ng add @angular-eslint/schematics@22.1.0
# or
ng add @angular-eslint/schematics@next
```

4. Configure pre-commit hooks

Pre-commit hooks are a nice way to run certain checks to ensure clean code. This can be used to format staged files if for some reason they weren’t automatically formatted during editing. [husky](https://github.com/typicode/husky) can be used to easily configure git hooks to prevent bad commits. We will use this along with [pretty-quick](https://github.com/azz/pretty-quick) to run Prettier on our changed files. Install these packages, along with [npm-run-all](https://github.com/mysticatea/npm-run-all), which will make it easier for us to run npm scripts:

```bash
npm install -D husky pretty-quick npm-run-all
```

To configure the pre-commit hook, simply add a `precommit` npm script. We want to first run Prettier, then run TSLint on the formatted files. To make our scripts cleaner, I am using the npm-run-all package, which gives you two commands, `run-s` to run scripts in sequence, and `run-p` to run scripts in parallel:

```json
  "precommit": "run-s format:fix lint",
  "format:fix": "pretty-quick --staged",
  "format:check": "prettier --config ./.prettierrc --list-different \"src/{app,environments,assets}/**/*{.ts,.js,.json,.css,.scss}\"",
  "format:all": "prettier --config ./.prettierrc --write \"src/{app,environments,assets}/**/*{.ts,.js,.json,.css,.scss}\"",
  "lint": "ng lint",
```

5. Initialize husky
   - Run it once

   ```bash
     npx husky init
   ```

   - Add a hook

   ```bash
     echo "npm run precommit" > .husky/pre-commit
   ```

   - Make a commit

   ```bash
     git commit -m "Keep calm and commit"
     # `npm run precommit and npm test` will run every time you commit
   ```

6. How to skip prettier format only in particular file
   1. JS

   ```js
   matrix(1, 0, 0, 0, 1, 0, 0, 0, 1);

   // prettier-ignore
   matrix(
       1, 0, 0,
       0, 1, 0,
       0, 0, 1
     )
   ```

   2. JSX

   ```jsx
   <div>
     {/* prettier-ignore */}
     <span     ugly  format=''   />
   </div>
   ```

   3. HTML

   ```html
   <!-- prettier-ignore -->
   <div         class="x"       >hello world</div            >

   <!-- prettier-ignore-attribute -->
   <div
     (mousedown)="       onStart    (    )         "
     (mouseup)="         onEnd      (    )         "
   ></div>

   <!-- prettier-ignore-attribute (mouseup) -->
   <div (mousedown)="onStart()" (mouseup)="         onEnd      (    )         "></div>
   ```

   4. CSS

   ```css
   /* prettier-ignore */
   .my    ugly rule
     {
   
     }
   ```

   5. Markdown

   ```md
     <!-- prettier-ignore -->

   Do not format this
   ```

   6. YAML

   ```yml
   # prettier-ignore
   key  : value
     hello: world
   ```

   7. For more, please [check](https://prettier.io/docs/en/ignore.html)

## Generate environment files

```bash
ng generate environments
```

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
