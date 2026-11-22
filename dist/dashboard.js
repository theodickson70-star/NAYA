// Dashboard ndogo (hatua 1): ukurasa mmoja unaoonyesha hali ya API na Supabase.
// Unasoma /health kila sekunde 5. Hauna login bado — hiyo ni hatua 2.
export const dashboardHtml = `<!doctype html>
<html lang="sw">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Urambo Ride — Hali ya Mfumo</title>
<style>
  :root { --bg:#f5f6f4; --card:#fff; --text:#1c2321; --muted:#66706b; --line:#e2e5e3; --ok:#0b6e4f; --okbg:#e3f4ec; --bad:#b42318; --badbg:#fdecea; --wait:#9a6b00; --waitbg:#fff4d6; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111614; --card:#1a201d; --text:#e8ece9; --muted:#9aa5a0; --line:#2a322e; --okbg:#12382b; --badbg:#3d1a17; --waitbg:#3a2e10; --ok:#5fd3a4; --bad:#ff8a80; --wait:#f2c94c; } }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; background:var(--bg); color:var(--text); }
  main { max-width:640px; margin:0 auto; padding:32px 16px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0 0 24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
  .name { font-weight:600; }
  .hint { color:var(--muted); font-size:13px; margin-top:2px; }
  .pill { padding:6px 12px; border-radius:999px; font-weight:700; font-size:14px; white-space:nowrap; }
  .ok { background:var(--okbg); color:var(--ok); } .bad { background:var(--badbg); color:var(--bad); } .wait { background:var(--waitbg); color:var(--wait); }
  .foot { color:var(--muted); font-size:13px; margin-top:16px; }
</style>
</head>
<body>
<main>
  <h1>Urambo Ride</h1>
  <p class="sub">Hali ya mfumo — hatua 1</p>
  <div class="card"><div><div class="name">API (server)</div><div class="hint" id="api-hint">Inaangalia…</div></div><span class="pill wait" id="api">…</span></div>
  <div class="card"><div><div class="name">Database (Supabase)</div><div class="hint" id="db-hint">Inaangalia…</div></div><span class="pill wait" id="db">…</span></div>
  <p class="foot" id="foot">Inajisasisha kila sekunde 5.</p>
</main>
<script>
  function set(id, text, cls, hint) {
    const el = document.getElementById(id);
    el.textContent = text; el.className = 'pill ' + cls;
    document.getElementById(id + '-hint').textContent = hint;
  }
  async function check() {
    try {
      const res = await fetch('/health', { cache: 'no-store' });
      const h = await res.json();
      set('api', 'Inafanya kazi', 'ok', 'Server inajibu');
      if (h.database === 'ok') set('db', 'Imeunganishwa', 'ok', 'Supabase inajibu');
      else set('db', 'Haijaunganishwa', 'bad', 'Angalia DATABASE_URL — sababu iko kwenye terminal: [health] database: …');
    } catch (e) {
      set('api', 'Haipatikani', 'bad', 'Server haijibu — je, npm run dev bado inaendesha?');
      set('db', 'Haijulikani', 'wait', 'Inasubiri server');
    }
    document.getElementById('foot').textContent = 'Imesasishwa ' + new Date().toLocaleTimeString() + ' · kila sekunde 5';
  }
  check(); setInterval(check, 5000);
</script>
</body>
</html>`;
