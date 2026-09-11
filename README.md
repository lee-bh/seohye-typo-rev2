# seohye-typo

デジタル東アジア・タイポグラフィ年表 — a pan-and-zoom timeline of East Asian
typography, rendered from a Google Spreadsheet.

## Structure

| Path | Role |
| --- | --- |
| `index.html` | Page shell, edit/add modals, about modal |
| `app.js` | Data loading, timeline layout, interaction, spreadsheet writes |
| `style.css` | Styling |
| `apps-script/Code.gs` | Spreadsheet API used as the database ([details](apps-script/README.md)) |

## Data model

Two sheets back the view:

- **`sheet3`** — point events (`nation`, `category`, `yr`, `item`, `info`,
  `link`, `cite`), drawn as cards below the axis.
- **`sheet4`** — periods (`country`, `theme`, `begin`, `end`, `layer`,
  `title`), drawn as horizontal bars across 31 stacked layers. `end` may be
  empty or `current` for an ongoing period; `layer` is `1`–`31` and can be
  changed by dragging a label vertically.

## Interaction

Drag to pan, wheel or pinch to zoom horizontally, and drag a period label up or
down to move it between layers — that write goes straight back to the sheet.
Clicking a card or a period label opens its editor. Pointer events drive all of
it, so mouse, touch and pen behave the same.

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
