import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { html, raw, type Raw } from '../html.js';

type Nav = { href: string; label: string; key: string };
const OWNER_NAV: Nav[] = [
  { href: '/', label: 'Dashibodi', key: 'home' },
  { href: '/ripoti', label: 'Ripoti', key: 'ripoti' },
  { href: '/float', label: 'Float', key: 'float' },
  { href: '/wateja', label: 'Wateja', key: 'wateja' },
  { href: '/wafanyakazi', label: 'Wafanyakazi', key: 'wafanyakazi' },
  { href: '/maduka', label: 'Maduka', key: 'maduka' },
  { href: '/kamisheni', label: 'Kamisheni', key: 'kamisheni' },
  { href: '/hesabu', label: 'Hesabu', key: 'hesabu' },
  { href: '/kumbukumbu', label: 'Kumbukumbu', key: 'kumbukumbu' },
];
const AGENT_NAV: Nav[] = [
  { href: '/', label: 'Dashibodi', key: 'home' },
  { href: '/tuma', label: 'Tuma', key: 'tuma' },
  { href: '/toa', label: 'Toa', key: 'toa' },
  { href: '/wateja', label: 'Wateja', key: 'wateja' },
  { href: '/hesabu', label: 'Hesabu ya siku', key: 'hesabu' },
  { href: '/ripoti', label: 'Ripoti', key: 'ripoti' },
];

export const logo = (size: 'sm' | 'lg' = 'sm', onDark = false) =>
  html`<span class="logo logo-${size} ${onDark ? 'on-dark' : ''}"><span class="logo-mark">P</span><span class="logo-word"><b>Pay</b>Point</span></span>`;

function shell(title: string, body: Raw, bodyClass = ''): string {
  return html`<!doctype html>
<html lang="sw">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#06502F">
<title>${title} · ${config.appName}</title>
<link rel="icon" href="/static/icon.svg" type="image/svg+xml">
<link rel="manifest" href="/static/manifest.webmanifest">
<link rel="stylesheet" href="/static/style.css?v=2">
<script src="/static/app.js?v=2" defer></script>
</head>
<body class="${bodyClass}">${body}</body>
</html>`.value;
}

export function page(
  req: FastifyRequest,
  opts: { title: string; active?: string; body: Raw; actions?: Raw },
): string {
  const u = req.user!;
  const nav = u.role === 'owner' ? OWNER_NAV : AGENT_NAV;
  const flash = req.flash;
  const unread = req.unread;
  return shell(
    opts.title,
    html`<header class="top">
      <div class="top-in">
        <a href="/" class="top-brand" aria-label="PayPoint — Dashibodi">${logo()}</a>
        <div class="top-who">
          <span class="who-name">${u.jina}</span>
          <span class="who-sub">${u.role === 'owner' ? `Mmiliki · ${u.biashara_jina}` : `Mfanyakazi · ${u.duka_jina ?? 'bila duka'}`}</span>
        </div>
        ${u.role === 'owner'
          ? html`<a class="bell" href="/arifa" aria-label="Arifa${unread ? ` (${unread} mpya)` : ''}">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-1.7 1.7A1 1 0 0 0 4 19.4h16a1 1 0 0 0 .7-1.7Z"/></svg>
              ${unread ? html`<b>${unread > 9 ? '9+' : unread}</b>` : ''}</a>`
          : ''}
        <a class="top-link" href="/akaunti">Akaunti</a>
        <form method="post" action="/toka" class="inline">${raw(`<input type="hidden" name="_csrf" value="${req.csrf}">`)}<button class="top-link" type="submit">Toka</button></form>
      </div>
      <nav class="nav" aria-label="Menyu kuu"><div class="nav-in">
        ${nav.map((n) => html`<a href="${n.href}" class="${n.key === opts.active ? 'on' : ''}" ${n.key === opts.active ? raw('aria-current="page"') : ''}>${n.label}</a>`)}
      </div></nav>
    </header>
    <main class="main">
      <div class="page-head"><h1>${opts.title}</h1>${opts.actions ?? ''}</div>
      ${flash ? html`<div class="flash flash-${flash.aina}" role="status">${flash.ujumbe}</div>` : ''}
      ${opts.body}
    </main>
    <footer class="foot">${config.appName} · ${config.tagline} · ${config.company}</footer>`,
  );
}

/** Kurasa za nje (kuingia, kusajili) */
export function outside(title: string, body: Raw): string {
  return shell(
    title,
    html`<div class="out">
      <section class="out-hero">
        <div class="out-hero-in">
          ${logo('lg', true)}
          <p class="out-tag">${config.tagline}</p>
          <h2>Simamia uwakala wako popote ulipo.</h2>
          <p>Tuma na toa pesa, float ya kila mtandao, kamisheni, wafanyakazi na kumbukumbu za kila kitendo — sehemu moja.</p>
          <ul class="out-nets"><li><i style="--c:#E60000"></i>M-Pesa</li><li><i style="--c:#0033A0"></i>Mixx by Yas</li><li><i style="--c:#B71C1C"></i>Airtel Money</li><li><i style="--c:#F57C00"></i>HaloPesa</li><li><i style="--c:#00838F"></i>T-Pesa</li></ul>
        </div>
      </section>
      <section class="out-form">${body}<p class="out-foot">${config.company}</p></section>
    </div>`,
    'outside',
  );
}

export function errorPage(req: FastifyRequest, status: number, message: string): string {
  if (req.user) {
    return page(req, {
      title: status === 404 ? 'Haipatikani' : status === 403 ? 'Hakuna ruhusa' : 'Hitilafu',
      body: html`<div class="card"><p>${message}</p><p><a class="btn" href="/">Rudi Dashibodi</a></p></div>`,
    });
  }
  return outside('Hitilafu', html`<div class="card"><h1>Hitilafu</h1><p>${message}</p><a class="btn" href="/ingia">Ingia</a></div>`);
}
