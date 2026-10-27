# Design

## Shape of the program

A local HTTP server holds the workspace and the domain logic. A desktop shell starts that
server on a random loopback port, hands the window a per-launch session token in an
HttpOnly cookie, and owns the isolated browser sessions that read job sites. The same
server runs standalone in a browser, where everything except source reading works.

| Path | Responsibility |
| --- | --- |
| `src/server.js` | HTTP API and local-model status |
| `src/discovery.js` | One discovery run: batch selection, native readers, local-model screening, checkpoints |
| `src/domain/` | Resume redaction, role suggestion, search planning, deduplication, timeline, exports |
| `src/resume/` | PDF, DOCX, Markdown and plain-text extraction |
| `src/sources/` | The source catalog and the readers that scan them |
| `src/providers/` | The local model: an Ollama client, the model's search tools, and its tool-calling loop |
| `src/store/` | Atomic JSON workspace persistence, outside tracked source |
| `src/desktop/` | Electron shell, isolated source sessions, navigation policy |
| `public/` | The single-page workspace |

## Reading a job site

One generic reader drives every portal. A site's particulars live as a profile of CSS
selectors in `src/sources/adapters/portal-profiles.js`, and the reader turns a profile into a
snapshot script that runs inside that site's own window. LinkedIn has its own reader
because its card markup and pagination differ enough that selectors alone do not express
it. Its signed-in AI search page uses generated class names and puts no link on its list
cards; each card names its job id in a `componentkey` attribute, the link is built from that
id alone, and pages are reached through the address's `start` parameter, so reading needs
no clicks on the account.

The snapshot script returns job-card fields and page signals: a login form, a CAPTCHA, a
next page, the site's own no-results message. It never returns page HTML.

The reader reports three separate states:

- **authentication**: signed in, signed out, facing a challenge, or not required
- **extraction**: whether readable cards are present
- **coverage**: whether the scan reached a page the site confirmed as the last

## Deciding a scan is finished

A page is complete when three consecutive scroll rounds reach the end of the list and
reveal nothing new. A scan is complete only when a page reports no next page and the site
confirms the end. Any other stop (a page cap, a scroll cap, a login gate, a challenge, a
cancelled run) is recorded with its reason and a resume point, and the Excel export lists
it on a coverage sheet.

## Searching with a local model

A model running in Ollama on this computer has no web access of its own. The Ollama
provider gives it tools instead. The program runs each search through a source's job
API and shows the model the results as numbered listings. The model can search again
with other keywords, read one listing's full description, and save listings by number
with notes on why they fit and what they lack.

MyCareersFuture's search results leave out the description and the minimum experience,
which the screening depends on, so the search tool also reads each listing's own record,
a few at a time. A vacancy posted several times under new links, with the same title,
company and description, is shown to the model once.

The model's instructions put the cost of missing a suitable job above the cost of
keeping an extra one: it leaves a listing out only when the work belongs to a different
field or asks for several more years of experience than the resume shows. A listing it
tries to save without any reason in the candidate's favour is refused, because the model
has already judged it unsuitable.

The model never supplies a job's facts. A saved job's title, company, location and link
are copied from the listing the API returned for that number. A number that appeared in
no search result is refused, so the model cannot invent a link or misquote a company.
Its notes become the job's match reasons and missing requirements, shown in the job's
details and in the Excel export under AI headings so they are not mistaken for the
listing's own text.

Each search task is one short session. It ends when the model finishes or runs out of
steps. It also ends after three steps in a row that find nothing new, or after two
replies without a tool call. Requests ask Ollama for a 16k-token context window: its
2k default silently drops the start of a longer prompt, which holds the instructions
and the resume. Temperature is zero and the seed is fixed. Each finished task is saved
at once, so the job list and progress line move during a long run and a pause keeps
what was already found. Loading the model can take minutes from a cold disk, so it
starts loading when the interface opens rather than when the search begins.

The local model is the only AI the program uses. When its server is not answering at
Ollama's default address, the program starts the installed Ollama (the Windows tray app,
the macOS app, or `ollama serve`) detached, so it outlives Career Radar, and waits up to
30 seconds for it. A failed start is not retried for a minute. If the server still does
not answer, the AI tasks are recorded as `provider_search_failed` and stay queued for the
next search.

The provider searches only the sources it has a tool for, currently MyCareersFuture.
Tasks for other sources are recorded as `provider_source_unsupported`, not as empty
results. The Ollama address must be on this computer because every request carries the
redacted resume.

With `qwen3.5:9b` on an 8 GB laptop GPU, a search task takes 7 to 17 seconds once the
model is loaded; loading it the first time can take a few minutes.

## Isolation

Each source gets its own Electron session partition. A window opened for one source
cannot navigate off that source's domains, cannot see another source's cookies, and never
touches the user's ordinary browser. Disconnecting a source clears its partition.

The desktop shell exposes no Node to the renderer, runs it sandboxed and
context-isolated, and opens external links in the system browser.

## Distribution

electron-builder produces an NSIS installer and a portable executable for Windows x64,
with the application in an ASAR archive. The installer needs no administrator rights. The
build is unsigned, so Windows shows an unknown-publisher warning; SHA-256 sums let a
recipient detect a changed file, though they do not prove who built it. Where data is
stored is described in [Security and privacy](../SECURITY.md).

## What the program does not do

- No hosted accounts, cloud AI, cloud database or telemetry.
- No CAPTCHA solving or getting around a sign-in.
- No applications, emails or recruiter messages.
- No background scheduler or self-update.
