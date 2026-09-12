# Apps Script backend

`Code.gs` is the spreadsheet-backed API that `../app.js` talks to. It is kept in
this repository so the database layer is versioned alongside the front-end — a
redeployment that changes the `/exec` URL should never leave the server logic
unrecoverable.

This file is the deployed script as of 2026-09, with three additions: the admin
password gate, `rowNumbers` in `read`, and a `LockService` around writes.

> **`admin.html` does not work until this is deployed.** The live script has no
> `auth` action, so the login screen gets "Invalid GET action" and never
> unlocks — and until then writes are still accepted from anyone. Push this
> file, redeploy, and run `setAdminPassword()` before using the admin page.

## Spreadsheet layout

| Tab | Header row (row 1) |
| --- | --- |
| `Sheet3` | `nation`, `category`, `yr`, `item`, `info`, `link`, `cite` |
| `Sheet4` | `country`, `theme`, `begin`, `end`, `layer`, `title` |

Header names are matched case-insensitively, and the client lowercases them, so
`Nation` and `nation` behave identically. `sheet4.end` may be left empty or set
to `current` for an ongoing period. `sheet4.layer` is `1`–`31`.

The client asks for `sheet3` and `sheet4` in lower case. `getSheetByName()` is
case-sensitive, so `getSheet()` falls back to a case-insensitive scan to reach
the `Sheet3` and `Sheet4` tabs. Renaming a tab to something other than those two
names means updating the client's requests as well.

## API

All endpoints accept GET or POST. POST bodies must be
`application/x-www-form-urlencoded`.

| Action | Parameters | Response |
| --- | --- | --- |
| `read` | `sheet` | `{ status, data: { headers, rows, rowNumbers } }` |
| `create` | `token`, `sheet`, one parameter per column | `{ status, data }` |
| `update` | `token`, `sheet`, `_row`, the columns to change | `{ status, data }` |
| `delete` | `token`, `sheet`, `_row` | `{ status, data }` |
| `auth` | `token` | `{ status }` |

A refused write answers `{ status: "error", code, message }`, where `code` is
`unauthorized` or `not_configured` — the page branches on it to re-lock itself.

`rowNumbers[i]` is the real 1-based sheet row for `rows[i]`, and blank rows are
skipped. The client uses it for edits and deletes instead of inferring row
numbers from the array index, which silently targeted the wrong record for
everything below a blank row. Clients that predate `rowNumbers` still work —
they fall back to the index-based guess.

`update` is a partial write: only the columns present in the request are
touched, so dragging a `sheet4` label to a new layer sends `layer` alone
without blanking the rest of the record.

Write actions are serialised with `LockService` so concurrent edits cannot
shift row numbers underneath one another.

## The admin password

Reads are public — `index.html` needs them. Every write requires `token`, the
SHA-256 hash of `seohye-typo:` + the password, computed in the browser so the
password itself is never sent or written to the execution log. `admin.html`
collects the password, sends the hash once to `auth` to unlock, and attaches it
to every write after that.

This check has to live here rather than in the page, because the endpoint is
reachable directly: a password checked in `admin.js` would stop nobody from
POSTing to the `/exec` URL themselves.

To set it, open `setAdminPassword()` in the editor and type the password between
the quotes on the `const password = '';` line — that one line is the only thing
to edit. Run the function once, then empty the quotes again and save. The hash
lands in the script property `ADMIN_TOKEN_HASH`; the password is not stored
anywhere.

Both functions report through the execution list rather than only the log:
`setAdminPassword()` reads the hash back and throws if it did not stick, so a
run that ends without an error really did store it, and `checkAdminPassword()`
throws when no password is set. A green run of either means it is configured.
Until it is, every write is refused with `code: not_configured`.

If the editor reports a password is set but the web app still answers
`not_configured`, the URL is serving a different script project from the one
being edited. `?action=diag` reports what the deployment sees — its `scriptId`,
whether it finds the hash, which property keys exist and which tabs it reaches —
and `showAdminDiagnostics()` reports the same from the editor, throwing so the
answer lands in the execution list. Two different `scriptId` values confirm it;
paste the code into the project the URL actually serves, or redeploy from the
one being edited and update `API_URL`. Neither reports the password, the hash or
the spreadsheet.

What this is and is not: it is one shared password giving a real server-side
gate, and a wrong guess costs a round trip plus a half-second delay. It is not
an identity system — anyone holding the password, or the hash, can write, and
the log will not say who did. Rotate it when someone should no longer have
access.

## Deploying

With [clasp](https://github.com/google/clasp):

```bash
npm install -g @google/clasp
clasp login
cp ../.clasp.json.example ../.clasp.json   # then fill in your scriptId
clasp push
clasp deploy
```

Or paste `Code.gs` into the Apps Script editor by hand, then
**Deploy → New deployment → Web app** with *Execute as: Me* and
*Who has access: Anyone*. Put the resulting `/exec` URL into `API_URL` at the
top of `../app.js`.

Re-deploying to the **same** deployment keeps the URL stable; creating a new
deployment produces a new URL and requires updating `API_URL`.
