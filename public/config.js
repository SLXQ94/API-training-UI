// ---------------------------------------------------------------------------
// The only file you need to edit to point the UI at a different server.
// ---------------------------------------------------------------------------
window.CONFIG = {
  APP_NAME: 'Acropolis Chat',

  // Where the API lives. Use '' (empty) if this UI is served by the API itself (same origin).
  // API_BASE: 'https://acropolis-chat-api.onrender.com',
  API_BASE: 'http://192.168.0.121:3000',

  // How often we ask the server "anything new?" (a hidden tab slows down to every 15 s).
  // Every student's browser does this, so it directly decides how much load your server gets.
  POLL_MS: 10000,

  // Every so often we re-download the latest 100 messages, because the cheap "anything new?"
  // question (?after=<id>) can never tell us that somebody EDITED or DELETED an old message.
  FULL_SYNC_MS: 20000,
};
