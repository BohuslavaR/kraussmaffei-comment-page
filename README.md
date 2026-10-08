# KraussMaffei Comment Page

A simple threaded comments page built with **pure HTML, CSS and JavaScript** – no frameworks, no libraries, no build step.

**Live demo:** https://bohuslavar.github.io/kraussmaffei-comment-page/

## Features

- **Register / log in** – accounts are stored in `localStorage`, the active session in `sessionStorage` (no database).
- **Guests can read, users can write** – only a logged in user sees the comment form and the *Reply* buttons.
- **Comment tree** – anybody logged in can reply to any comment; the reply is attached as a subtree of that comment, to any depth.
- **Moderation in a Web Worker** – clicking *Add Comment* starts a new worker that checks the text against the words in [`data/inappropriate-words.json`](data/inappropriate-words.json). If a word is found in any form, the comment is blocked and the user is told which word is not allowed. Otherwise the comment is saved with a timestamp under the correct parent.

## Getting started - ZIP

When running the project locally from the attached ZIP file, the folder must be served over HTTP, because Web Workers and `fetch()` do not work when the page is opened directly from disk (`file://`).


## Project structure - GitHub

```
kraussmaffei-comment-page/
├── index.html                    Page markup and <template> elements
├── css/
│   └── styles.css                All styles; values from the assignment are CSS variables
├── data/
│   ├── inappropriate-words.json  Words that are not allowed in comments
│   └── allowed-words.json        Exceptions – innocent words such as "software"
├── js/
│   ├── app.js                    The application - single ES module split into numbered sections
│   └── moderation.worker.js      Web Worker – loads the word list and checks the text
└── tests/
    └── moderation.test.js        Unit tests for the word matching
```

`app.js` :

1. **Configuration** – storage keys, validation rules, DOM references
2. **Storage helpers** – reading and writing JSON in Web Storage
3. **Authentication** – register, log in, log out, current user
4. **Comments** – saving comments and grouping them into a tree
5. **Moderation** – starts a new worker for each check and returns a Promise
6. **Rendering** – the comment tree and the forms
7. **Event handlers** – login form, logout, submitting a comment
8. **Start**
9. ☮ ilovepeace

The worker has its own file because a Web Worker runs in a separate thread and is loaded from its own script.


### Moderation flow

```
Add Comment ─► new Worker() ─► fetch inappropriate-words.json
                                  │
                                  ▼
                         normalise text and look for the words
                                  │
             found ◄──────────────┴──────────────► not found
               │                                       │
   message in #FF8300                       comment saved with timestamp
   (comment is not saved)                   under the correct parent
```

The worker is terminated as soon as it answers. If the check cannot be completed (for example, the JSON file cannot be loaded), the comment is **not** added – the moderation fails closed.

### Not allowed words 

The words are matched as substrings, so the filter is strict on purpose. Innocent words that merely contain a banned word – such as *software*, *aware* or *warning* – are listed in [`data/allowed-words.json`](data/allowed-words.json) and skipped. An exception applies only to a **whole word**:


### Security notes

- Comment text and usernames are always inserted with `textContent`, so HTML in a comment is shown as plain text.
- Passwords are never stored as plain text – only a salted SHA-256 hash is kept.

## Assignment checklist

| Requirement | Implementation |
| --- | --- |
| Pure HTML / CSS / JavaScript | No frameworks or libraries; native ES modules |
| Optimised for 1920 × 1080, centred, 70 % width | `.page { width: 70%; margin-inline: auto; }` – 15 % free on each side |
| Background `#F5F5F5` | `body` background |
| Font family *Lucida Handwriting* | Set on `body` (with `cursive` as a fallback); form controls use `font: inherit` |
| Font size 18px | Set on `html`; headings, buttons and inputs use the same size |
| *Reply* button `#FFFFFF` / `#00325A`, opposite on hover | `.button--reply` |
| *Add Comment* button `#FFFFFF` / `#DE5050`, opposite on hover | `.button--add` |
| Blocking message in `#FF8300` | `.message` |
| Register / login stored in Web Storage | `app.js` – section 3 |
| Only logged in users can comment | Form and *Reply* buttons are shown only after login |
| Tree of replies | `parentId` (section 4), rendered recursively (section 6) |
| New worker after *Add Comment* | `checkComment()` in section 5 + `moderation.worker.js` |
| Word list in a JSON file | `data/inappropriate-words.json` (exceptions in `data/allowed-words.json`) |
| Timestamp | `createdAt` (ISO 8601), displayed in the user's locale |



---

PS: call `iLovePeace()`
