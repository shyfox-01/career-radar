# Privacy

Career Radar is a single-user app for your own computer. It has no account, cloud AI,
cloud database or telemetry.

## What is stored

The redacted resume, preferences, search plan, jobs and application status are saved as
files on your computer: in `%APPDATA%\Career Radar\data` for the installed app, or in the
`CareerRadarData` folder beside the portable app. An uploaded resume file is read in memory
and not saved.

Each job site has its own browser session, separate from your normal browser. You type
credentials into the site's own page; Career Radar never reads them. The sessions are kept
in `%APPDATA%\Career Radar`, for the portable app too. **Disconnect** clears a site's
session.

## What is sent where

- **Job sites** receive the searches made in their windows, as they would from any
  browser.
- **The local model** (Ollama, on your computer) receives the redacted resume and the
  search plan after you confirm a search. The app refuses an Ollama address that is not on
  your computer.
- **MyCareersFuture** receives search keywords and the employment type, not the resume.
- **GitHub** receives an update check each time the installed app starts, which shows it
  your IP address. The check carries no ID of your computer. The portable app does not
  check.

Redaction removes email addresses, phone numbers, profile links and lines that look like a
street address. Names, student numbers and unusual formats can survive it, so read the
preview before searching.

## Limits

- Anyone with access to your Windows account can read the data folder and site sessions.
- Text in a listing could try to steer the AI. At worst it keeps the wrong jobs or writes
  wrong notes.
- Updates are checked against the SHA-512 in each release, but the installers are not
  code-signed yet.
- Whether automated reading is allowed is up to each site's terms.

## Reporting a problem

Open an issue in this repository with the app version and the steps that led to the
problem, using fictional data. Never attach a real resume, export or data folder.
