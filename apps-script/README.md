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
| `create` | `sheet`, one parameter per column | `{ status, _row }` |
| `update` | `sheet`, `_row`, the columns to change | `{ status, _row, updated }` |
| `delete` | `sheet`, `_row` | `{ status, _row }` |

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
