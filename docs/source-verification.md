# Source verification

Live-site checks for the default readers, and why the other sources are not defaults.
Only sources with a recorded check are enabled by default. To re-run a
check, see [Contributing](../CONTRIBUTING.md#checking-readers-against-live-sites).

## Latest checks

Rows marked "Signed in" used the operator's own account.

| Source | Market | Checked | Records read | Pagination | Notes |
| --- | --- | --- | --- | --- | --- |
| LinkedIn Jobs | SG | 2026-10-16 | 50 over 2 pages | confirmed | Signed in, on LinkedIn's AI search page. Links are built from the job id each card carries; the region is set by `geoId`. |
| JobStreet Singapore | SG | 2026-10-16 | 60 over 2 pages | confirmed | |
| Indeed Singapore | SG | 2026-10-16 | 16 | first page only | Later pages redirect to an Indeed sign-in, reported as sign-in required. |
| eFinancialCareers Singapore | SG | 2026-10-16 | 30 over 2 pages | confirmed | |
| BOSS直聘 | CN | 2026-10-16 | 270 on one scrolled page | not reached | Signed in. Signed out, the first 15 are readable. |
| 智联招聘 | CN | 2026-10-16 | 780 on one scrolled page | scroll limit, resumable | Signed in. The list loads more about a second after reaching the end, so the reader waits three seconds before stopping. Signed out, the first 20 are readable. |
| 前程无忧 | CN | 2026-10-16 | 40 over 2 pages | confirmed | Job URL uses the id exposed by the card. |
| 猎聘 | CN | 2026-10-16 | 52 over 2 pages | confirmed | The site renamed its card classes; the reader accepts both spellings. |
| 实习僧 | CN | 2026-10-16 | 40 over 2 pages | confirmed | No sign-in needed. The page never finishes loading, so the reader stops it once parsed. Some place names use a custom font. |
| 牛客校招 | CN | 2026-10-16 | 39 over 2 pages | confirmed | Keyword search only; excludes the recommendation feed. |
| JobsDB Hong Kong | HK | 2026-10-16 | 60 over 2 pages | confirmed | |
| Indeed Hong Kong | HK | 2026-10-16 | 16 | first page only | Later pages redirect to an Indeed sign-in, reported as sign-in required. |
| eFinancialCareers Hong Kong | HK | 2026-10-16 | 30 over 2 pages | confirmed | |
| Labour Department iES | HK | 2026-10-16 | 3 | terminal page reached | The list view has no employer column, so company stays blank until a job card is opened. |

## Searched by the local model

| Source | Checked | Result | Notes |
| --- | --- | --- | --- |
| MyCareersFuture | 2026-10-16 | 4 Data Analyst internships, each with its description and minimum experience | Read through the site's public job search API and each listing's own record, not a page reader. Select it in the source list to include it. |

## Not enabled by default

| Source | Why |
| --- | --- |
| LinkedIn Jobs (HK) | Its session is separate from the Singapore one and was not signed in during this check. The reader itself is the same one Singapore verified. |
| Glints Singapore | Reads cards, but its list never settles at an end, so a scan cannot report coverage. |
| 拉勾 | Reads cards with complete fields, but the site's class names are build hashes that change on every deploy. |
| InternSG, GradSingapore, Careers@Gov, JobsCentral, 应届生求职网, 脉脉, CTgoodjobs, CPJobs, JIJIS | No reader. Career Radar gives you a search link and you browse them yourself. |

## Scope of the checks

A count shows that reading worked on that date, on that network, with that account. It
is not a promise of complete coverage: sites change their pages, limit request rates and
show different results to different accounts.
