# seohye-typo

デジタル東アジア・タイポグラフィ年表 — a pan-and-zoom timeline of East Asian
typography, rendered from a Google Spreadsheet.

## Structure

| Path | Role |
| --- | --- |
| `index.html` | Public page — read-only view of the timeline |
| `admin.html` | Editing page — same timeline behind a password |
| `app.js` | Data loading, timeline layout, pan and zoom; shared by both pages |
| `admin.js` | Login gate, edit dialogs and spreadsheet writes; `admin.html` only |
| `style.css` | Styling |
| `apps-script/Code.gs` | Spreadsheet API used as the database ([details](apps-script/README.md)) |

`app.js` renders a read-only timeline and exposes `editHooks`. `admin.js` fills
those hooks in, which is what makes cards clickable and period labels
draggable — so `index.html`, which loads `app.js` alone, has no path to a write
at all.

## Data model

Two sheets back the view:

- **`Sheet3`** — point events (`nation`, `category`, `yr`, `item`, `info`,
  `link`, `cite`), drawn as cards below the axis.
- **`Sheet4`** — periods (`country`, `theme`, `begin`, `end`, `layer`,
  `title`), drawn as horizontal bars across 31 stacked layers. `end` may be
  empty or `current` for an ongoing period; `layer` is `1`–`31` and can be
  changed by dragging a label vertically.

## Editing

`admin.html` asks for a password before it loads anything, every time it is
opened. The password is checked by the Apps Script backend, not by the page:
the hash is sent to the `auth` action to unlock, held in memory for as long as
the page lives, and attached to every write. Nothing is written to browser
storage, so a reload asks again and a tab opened from this one starts locked. A check in the page's own JavaScript would be decorative, since the
`/exec` endpoint can be posted to directly — so the endpoint is what enforces it,
and reads stay public for `index.html`.

Set the password by typing it into `setAdminPassword()` and running that
function once in the Apps Script editor; see
[`apps-script/README.md`](apps-script/README.md#the-admin-password). Until it is
set, every write is refused.

## Interaction

Drag to pan and wheel or pinch to zoom horizontally, on both pages. Pointer
events drive all of it, so mouse, touch and pen behave the same.

In `admin.html` only: clicking a card or a period label opens its editor, and
dragging a period label up or down moves it between layers, writing straight
back to the sheet.

## Running locally

The page is static, but it fetches across origins, so serve it over HTTP
rather than opening the file directly:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

If the API is unreachable the page falls back to a small built-in mock dataset
and logs a warning to the console.

## Configuration

`API_URL` at the top of `app.js` points at the deployed Apps Script web app.
See [`apps-script/README.md`](apps-script/README.md) for deployment steps.

## Credits

- Research & Curation: 서혜 (ソーヘー / Seo Hye)
- Design & Development: 이병학 (イ・ビョンハク / Lee Byounghak)

Produced as part of research supported by the DNP Foundation for Cultural
Promotion and JSPS KAKENHI (Grant-in-Aid for Scientific Research C).
