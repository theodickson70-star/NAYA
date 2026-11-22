import type { FastifyInstance } from 'fastify';

/** Mtumiaji wa majaribio: anahifadhi cookie na kusoma CSRF kutoka kwenye kurasa */
export class Client {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(readonly app: FastifyInstance, readonly ip = '10.0.0.1') {}

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  private keep(res: { cookies: { name: string; value: string; maxAge?: number; expires?: Date }[] }) {
    for (const c of res.cookies) {
      if (c.maxAge === 0 || (c.expires && c.expires.getTime() < Date.now()) || c.value === '') this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
  }
  async get(url: string) {
    const res = await this.app.inject({ method: 'GET', url, headers: { cookie: this.cookieHeader() }, remoteAddress: this.ip });
    this.keep(res);
    const m = res.body.match(/name="_csrf" value="([^"]+)"/);
    if (m) this.csrf = m[1];
    return res;
  }
  async post(url: string, form: Record<string, string | string[]>, opts: { csrf?: string | null } = {}) {
    if (!this.csrf) await this.get(url.startsWith('/sajili') || url.startsWith('/ingia') ? url : '/');
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) (Array.isArray(v) ? v : [v]).forEach((x) => params.append(k, x));
    if (opts.csrf !== null) params.set('_csrf', opts.csrf ?? this.csrf);
    const res = await this.app.inject({
      method: 'POST',
      url,
      payload: params.toString(),
      headers: { cookie: this.cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      remoteAddress: this.ip,
    });
    this.keep(res);
    const m = res.body.match(/name="_csrf" value="([^"]+)"/);
    if (m) this.csrf = m[1];
    return res;
  }
}
