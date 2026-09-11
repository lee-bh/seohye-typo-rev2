# Apps Script backend

`Code.gs` is the spreadsheet-backed API that `../app.js` talks to. It is kept in
this repository so the database layer is versioned alongside the front-end — a
redeployment that changes the `/exec` URL should never leave the server logic
unrecoverable.

> **Check this against your live deployment.** This file was reconstructed from
> the request/response contract the front-end relies on. If the currently
> deployed script differs, copy the live source over this file (or apply your
> changes here and redeploy) so the two stay in sync.

## Spreadsheet layout

| Sheet | Header row (row 1) |
| --- | --- |
| `sheet3` | `nation`, `category`, `yr`, `item`, `info`, `link`, `cite` |
| `sheet4` | `country`, `theme`, `begin`, `end`, `layer`, `title` |

Header names are matched case-insensitively, and the client lowercases them, so
`Nation` and `nation` behave identically. `sheet4.end` may be left empty or set
to `current` for an ongoing period. `sheet4.layer` is `1`–`31`.

## API

All endpoints accept GET or POST. POST bodies must be
`application/x-www-form-urlencoded`.

| Action | Parameters | Response |
| --- | --- | --- |
| `read` | `sheet` | `{ status, data: { headers, rows, rowNumbers } }` |
| `create` | `token`, `sheet`, one parameter per column | `{ status, _row }` |
| `update` | `token`, `sheet`, `_row`, the columns to change | `{ status, _row, updated }` |
| `delete` | `token`, `sheet`, `_row` | `{ status, _row }` |
| `auth` | `token` | `{ status }` |

`rowNumbers[i]` is the real 1-based sheet row for `rows[i]`. The client uses it
for edits and deletes instead of inferring row numbers from the array index,
which silently targeted the wrong record whenever the sheet contained a blank
row. Clients that predate `rowNumbers` still work — they fall back to the
index-based guess.

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

To set it, open `setAdminPassword()` in the editor, replace `CHANGE-ME` with the
password, run the function once, then clear the literal and save again. The hash
lands in the script property `ADMIN_TOKEN_HASH`; the password is not stored
anywhere. Until it is set, every write is refused with `code: not_configured`.

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
