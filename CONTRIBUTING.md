# Contributing

[Design](docs/design.md) explains how the program is put together. This page covers how to
run and check it, and the rules a source reader must follow.

## Commands

```powershell
npm install
npm test             # tests, no network
npm run format       # apply the Prettier style
npm run check        # syntax, formatting and tests; CI runs this on every push
npm start            # browser mode at http://127.0.0.1:4317 (no site readers)
npm run desktop      # the desktop app
npm run package:win  # Windows installer and portable build in dist/
```

Site readers need an Electron window, so test a reader change with `npm run desktop` or the
live check below. `package:win` keeps electron-builder's cache in `.build-cache/` because
Windows cannot rename a file across drives during extraction. After a build,
`scripts/smoke-packaged.ps1` (`-Target unpacked` or `portable`) starts the built app once
and checks that its server answered.

## Checking readers against live sites

```powershell
$env:PROBE_ROOT = Join-Path $env:TEMP "career-radar-probe"
$env:PROBE_SOURCES = "sg-jobstreet,cn-liepin"
npm run check:sources
```

Each source reads one page in its own session and writes counts and sample fields under
`PROBE_ROOT`. `PROBE_SHOW=1` shows the windows; `PROBE_PAGES` sets the page limit. For a
site that needs a sign-in, `scripts/interactive-login-queue.mjs` opens the site's login
window and waits for a person to sign in; the script never handles credentials.

Record results in `docs/source-verification.md`.

## Rules for readers

- **A missing field drops the card.** A card without a title, a link, or a company (unless
  its profile sets `allowMissingCompany`) is skipped, not guessed.
- **Never make up a link.** Build a job link only from an id the card itself shows, after
  checking its format. `portal.js` has three examples.
- **Reading a page is not finishing a search.** A scan is `complete` only on a page the
  site confirms is the last. A page cap, scroll cap, sign-in prompt or CAPTCHA leaves it
  incomplete and resumable.
- **Signed in and readable are separate facts.** Check and report each on its own.
- **An empty page is not "no jobs"** unless the site shows its own no-results message.
- **Only recorded evidence makes a default.** `readingEvidence` in `src/sources/catalog.js`
  decides `defaultEnabled`.
- **The model never supplies a job's facts.** Its tools show numbered listings, and a saved
  job's title, company and link come from the source's record for that number. A new
  source for the model is a search tool in `src/providers/local/` that follows the rules
  above.

## Adding or repairing a source

1. Inspect the live page and find selectors for what a person sees.
2. Put them in `src/sources/adapters/portal-profiles.js`. Change `portal.js` only for
   behaviour a selector cannot express, with a comment saying why.
3. Run the live check against the real site.
4. If it read real listings, add a `readingEvidence` entry and update
   `docs/source-verification.md`.

A site without a working reader gets a search link in the catalog.

## Conventions

- Node 22+, ES modules, no build step. Runtime dependencies are limited to resume parsing.
- Tests use `node:test` and never touch the network.
- Prettier formats the code (`.prettierrc.json`); Markdown and HTML are left as written.
- Code that runs inside a site's window is a plain function in the adapter, sent as text
  with `pageCall(fn, ...args)`. It can use only its arguments, which must survive
  `JSON.stringify`, and the page's own globals.
- The interface uses English headings with English/Chinese controls. The English and
  Chinese READMEs say the same thing.
- Comments explain why, not what.
