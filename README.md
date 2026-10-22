# Acropolis Chat: the UI for the classroom chat API

A WhatsApp-style chat in plain HTML, CSS and JavaScript. No libraries, no build step.

```
server.js        tiny web server that hands the UI to the class (Node only, nothing to install)
package.json     so `npm start` works too
public/          what the browser downloads
  index.html     the page (login screen + app shell)
  style.css      the look (light and dark mode follow the device)
  app.js         all behaviour, in 7 labelled sections
  config.js      API address + polling speed
api-update/      4 small changes for the chat API (read "Before class" below first)
```

## Serve it to the class

```bash
cd acropolis-chat-ui
node server.js            # or: npm start
```

It prints something like:

```
  you:        http://localhost:3001
  classmates: http://192.168.1.20:3001   (wlan0)
  chat API:   https://acropolis-chat-api.onrender.com
```

Students type the `classmates` address into their phone or laptop browser. That's the whole trick:
a browser asks `GET /style.css`, the server reads the file and sends it back. It's the same
request/response idea as the chat API, only the answer is a file instead of JSON.

| You want | Command |
|---|---|
| UI on 3001, chat API on Render (default) | `node server.js` |
| Chat API also on your laptop (class without internet, no cold starts) | start the API (`node index.js`, port 3000), then `node server.js --api-port=3000` |
| Another API address | `node server.js --api=https://my-api.example.com` |
| Another UI port | `node server.js --port=4000` |

Why `--api-port` and not `--api=http://localhost:3000`? On a student's phone, `localhost` means *the phone*.
With `--api-port`, the server tells each browser to use the same IP it used to reach the page, plus the API
port, so it works for everybody. (The override is added to `config.js` as it is sent; the file on disk is not changed.)

**If classmates can't connect**
1. Same network? Phone on mobile data, or on a different wifi, won't work.
2. Firewall: allow Node through (Windows shows a popup the first time; on Linux `sudo ufw allow 3001`).
3. Some campus wifi blocks device-to-device traffic ("client isolation"). Use your phone's hotspot or a small router.
4. Several addresses printed? Docker/VMware adapters show up too. Use the one in the same range as your students' addresses.

Every request is logged with the visitor's address, so students can watch themselves hit your laptop.

**Why two address bars, and why CORS?** `http://192.168.1.20:3001` (the UI) and
`https://acropolis-chat-api.onrender.com` (the API) are different *origins*. The browser only lets the UI call
the API if the API agrees (CORS), even when the API runs on your own laptop at `:3000`, since the port is part of
the origin. This is why the `api-update/` changes below are needed.

## Before class: update the API (needed once)

The UI is a different web address from the API, so the browser applies its rules. Three things
break, and each one is a good "why is this happening?" moment for students.

| Symptom in the UI | Cause | Fix |
|---|---|---|
| "Cannot reach the server" right after login, red CORS error in the console | Browsers refuse cross-origin calls unless the server says yes. A request with an `Authorization` header is first preceded by an `OPTIONS` **preflight**, which has no password, so the auth middleware answers 401. | `api-update/cors.js` answers preflights before auth and the rate limiter |
| 429 "Too many requests" for everyone after a few seconds | The limit was 10 requests / 10 s per IP. On Render, `req.ip` is the proxy's address unless you set `trust proxy`, so **the whole class shares one bucket**. Even with the real IP, a whole classroom often shares one college-wifi IP. | `app.set('trust proxy', 1)` and a higher limit (400 per 10 s in the update) |
| Server gets slow with 20+ students | Every poll carries the password and `scrypt` is deliberately slow (~50 ms, more on a free Render instance), run on every request. | `api-update/auth.js` remembers a verified login for 60 s (~50 ms down to ~1 ms in my test). Wrong passwords are never cached. |

How to apply:

1. Copy `api-update/cors.js` to `middleware/cors.js`.
2. Replace `middleware/auth.js` with `api-update/auth.js`.
3. Replace `index.js` with `api-update/index.js`. It is your deployed file (every step on) with the 4 changes marked `NEW`.
4. Commit and push, and Render redeploys.

(Serving the UI from the same server as the API, with `app.use(express.static('public'))` and `API_BASE: ''`,
would avoid CORS completely. Keep the other two changes either way.)

## What it does

- Sign in or register (roll number + password). "Keep me signed in" stores the login in `localStorage`, otherwise `sessionStorage`.
- Chat list with search, last-message preview, unread badges, and the class group pinned on top.
- Conversation view: day separators, sender names in the group, sent/sending/failed marks.
- Send with Enter on a computer (Shift+Enter for a new line); on a phone Enter is a new line and the arrow sends.
- Edit and delete your own messages (the arrow on your bubble, or right-click).
- Messages show instantly and are sent in order. If the server answers 429, the UI waits for `Retry-After` and retries by itself.
- Phones: one panel at a time, and the browser's back button returns to the list.

## Which API call does what

| UI action | Call |
|---|---|
| Register | `POST /users` |
| Sign in / session check | `GET /me` |
| Contacts | `GET /users` (every 30 s) |
| First load | `GET /messages?limit=100` |
| "Anything new?" every 4 s | `GET /messages?after=<highest id seen>` |
| Open a chat | `GET /messages?with=<rollNo or class>` |
| Send / edit / delete | `POST /messages`, `PATCH /messages/:id`, `DELETE /messages/:id` |

## Good talking points (this UI makes the polling lecture's pain visible)

- **Polling can't see edits or deletes.** `?after=<id>` only returns *new* ids. So every 20 s the UI re-downloads the latest 100 messages (`FULL_SYNC_MS`). Edit a message on one phone and watch the other lag. That is the motivation for SSE/WebSockets.
- **Cost of "freshness".** 30 students x 1 request / 4 s = 7+ requests/s on a free server. Change `POLL_MS` live and watch the server log.
- **Latency vs load.** There is no setting that is both instant and cheap.
- **The API has no `before=` parameter**, so history is limited to the latest 100 messages per call. A nice exercise: add `before` to the API, then "load older messages" to the UI.
- **No read receipts**, because the API has no concept of them. The UI only shows sent / sending / failed. Another exercise: design `POST /messages/:id/read`.
- **Credentials live in the browser** (`localStorage` if "keep me signed in"). Any script on the page could read them, which is why real apps use short-lived tokens. That is the natural next step after Basic auth.
- **Security detail worth pointing at:** `h()` in `app.js` only ever inserts user text as text nodes. A message like `<img src=x onerror=...>` shows up literally. Compare with building HTML strings.

## Known limits

- Unread counts are kept per device (`localStorage`), not on the server.
- The API returns each user's last 100 messages in a call, so very busy classes only keep recent history on screen.
- Styled after WhatsApp's layout; it uses no WhatsApp assets, only generic icons.
