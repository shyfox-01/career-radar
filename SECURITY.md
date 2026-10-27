# Security and privacy

Career Radar is a single-user app for your own computer. Its server listens on
`127.0.0.1` only and has no login of its own; do not expose it to a network.

## What is stored

The redacted resume, preferences, search plan, jobs and application status are saved as
JSON in the local data folder (`.career-radar-data` from source, `CareerRadarData` beside
the portable app, or the user's app-data folder when installed; `CAREER_RADAR_DATA_DIR`
overrides it). An uploaded resume file is parsed in memory and not saved.

Each job site has its own isolated browser session. You type credentials into the site's
own page; Career Radar never reads them, and the sessions are separate from your normal
browser. **Disconnect** clears a site's session.

## What is sent where

- **Job sites** receive the searches made in their windows, as they would from any
  browser.
- **The local model** (Ollama) receives the redacted resume and the search plan after you
  confirm a search. The app refuses an Ollama address that is not on this computer.
- **MyCareersFuture** receives search keywords and the employment type, not the resume.

There is no cloud AI, account, API key or telemetry.

Redaction removes email addresses, phone numbers, profile links and lines that look like
a street address. Names, student numbers and unusual formats can survive it, so read the
preview before searching.

## Protections

- Site windows are sandboxed, context-isolated, and can navigate only within that site's
  own domains.
- The model refers to listings by number; a saved job's title, company and link are
  copied from the site's record, so it cannot invent a listing.
- The only program the app starts is the Ollama already installed, without a shell and
  with fixed arguments. Nothing is downloaded.
- CSV cells that start with a formula character are prefixed with an apostrophe, so a job
  title cannot run as a formula.
- Uploads are limited to 10 MB of PDF, DOCX, TXT or Markdown.

## Limits

- Anyone with access to your Windows account can read the data folder and site sessions.
- Site windows run each site's own code. A compromised job site is contained to its
  window, not made harmless.
- Text in a listing could try to steer the model. At worst it keeps the wrong jobs or
  writes wrong notes; it has no other tools.
- Three dependencies parse resumes (`pdf-parse`, `mammoth`, `jszip`). Their versions are
  pinned, not audited.
- Whether automated reading is allowed is up to each site's terms.

## Reporting a problem

Open an issue with the app version and steps to reproduce, using fictional data. Never
attach a real resume, export or data folder.
