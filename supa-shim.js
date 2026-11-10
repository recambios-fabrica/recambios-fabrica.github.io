/*
 * Adaptador Supabase para la web de recambios (Garcia de Pou).
 * La web se diseñó dentro de Claude, donde usa window.claude.use('db' | 'user' | 'assets' | 'downloads').
 * Este archivo ofrece esas mismas funciones contra Supabase (base de datos + usuarios + archivos),
 * así la web funciona sin cambios. Muestra también la pantalla de acceso (correo y contraseña).
 * Configuración en config.js: window.RG_CONFIG = { url, anonKey }. Los administradores están en la tabla admins de Supabase.
 */
(function () {
  'use strict';
  const CFG = window.RG_CONFIG || {};
  const URL0 = String(CFG.url || '').replace(/\/+$/, '');
  const KEY = CFG.anonKey || '';
  const BUCKET = 'adjuntos';
  const POLL_MS = 5000;
  const LS = 'rg_supa_session_v1';
  const cols = {};          // col -> Map(id -> {data, version})
  const listeners = new Set();
  let seq = 0, me = null, peopleCache = null, syncing = null, session = null;
  let readyResolve; const ready = new Promise(r => (readyResolve = r));
  const realFetch = window.fetch.bind(window);

  const err = (code, message) => Object.assign(new Error(message || code), { code });
  const freeze = o => (o && typeof o === 'object' ? Object.freeze(o) : o);

  /* ---------- sesión ---------- */
  function loadSession() { try { session = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { session = null; } }
  function saveSession(s) { session = s; try { if (s) localStorage.setItem(LS, JSON.stringify(s)); else localStorage.removeItem(LS); } catch (e) {} }
  async function authCall(path, body) {
    const r = await realFetch(URL0 + '/auth/v1/' + path, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw err('auth', j.error_description || j.msg || j.message || 'No se pudo entrar');
    return j;
  }
  function keepSession(j) { saveSession({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)), user: j.user }); }
  let refreshing = null;
  async function token() {
    if (!session) throw err('revoked', 'Sesión no iniciada');
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    if (!refreshing) refreshing = authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then(keepSession).catch(e => { saveSession(null); throw err('revoked', 'Sesión caducada'); }).finally(() => { refreshing = null; });
    await refreshing; return session.access_token;
  }

  async function rest(method, path, body, extraHeaders) {
    let t; try { t = await token(); } catch (e) { showLogin(); throw e; }
    const headers = { apikey: KEY, Authorization: 'Bearer ' + t, ...(extraHeaders || {}) };
    if (body !== undefined && !(body instanceof Blob)) headers['Content-Type'] = 'application/json';
    let r;
    try { r = await realFetch(URL0 + path, { method, headers, body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body) }); }
    catch (e) { throw err('unavailable', 'Sin conexión con el servidor'); }
    if (r.status === 401) { saveSession(null); showLogin('La sesión ha caducado. Vuelve a entrar.'); throw err('revoked', 'Sesión caducada'); }
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = txt; }
    if (!r.ok) {
      const msg = (j && (j.message || j.error || j.msg)) || ('HTTP ' + r.status);
      const code = r.status === 413 ? 'too_large' : r.status === 429 ? 'rate_limited' : r.status >= 500 ? 'unavailable' : (j && j.code === 'P0002') ? 'not_found' : 'invalid_argument';
      throw err(code, msg);
    }
    return j;
  }

  /* ---------- pantalla de acceso ---------- */
  function showLogin(msg) {
    const go = () => {
      if (document.getElementById('rg-login')) { if (msg) document.getElementById('rg-e').textContent = msg; return; }
      const d = document.createElement('div');
      d.id = 'rg-login';
      d.innerHTML = `<style>
        #rg-login{position:fixed;inset:0;z-index:100000;background:linear-gradient(rgba(11,102,195,.72),rgba(11,102,195,.72)),url(fondo.jpg) center/cover no-repeat,#0B66C3;display:flex;align-items:center;justify-content:center;font:15px "IBM Plex Sans",system-ui,sans-serif}
        #rg-login form{background:#fff;color:#1c1f22;border-radius:14px;padding:30px 28px;width:min(360px,92vw);box-shadow:0 10px 40px rgba(0,0,0,.25)}
        #rg-login .lg{background:#0B66C3;border-radius:8px;padding:12px;display:flex;justify-content:center;margin-bottom:18px}
        #rg-login h1{font-size:17px;margin:0 0 16px}
        #rg-login label{display:block;font-size:13px;color:#55595e;margin:10px 0 4px}
        #rg-login input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #dddbd4;border-radius:8px;font:inherit}
        #rg-login button{width:100%;margin-top:18px;padding:11px;border:0;border-radius:8px;background:#e8590c;color:#fff;font:600 15px inherit;cursor:pointer}
        #rg-login .e{color:#b42318;font-size:13px;min-height:18px;margin-top:10px}</style>
        <form autocomplete="on"><div class="lg"><img src="logo.png" alt="Garcia de Pou" style="height:28px"></div>
        <h1>Recambios y reparaciones · Mantenimiento</h1>
        <label for="rg-u">Correo</label><input id="rg-u" name="email" type="email" autocomplete="username" required>
        <label for="rg-p">Contraseña</label><input id="rg-p" name="password" type="password" autocomplete="current-password" required>
        <button type="submit">Entrar</button><div class="e" id="rg-e"></div></form>`;
      document.body.appendChild(d);
      if (msg) d.querySelector('#rg-e').textContent = msg;
      d.querySelector('#rg-u').focus();
      d.querySelector('form').onsubmit = async ev => {
        ev.preventDefault();
        const e = d.querySelector('#rg-e'); e.textContent = '';
        try {
          const j = await authCall('token?grant_type=password', { email: d.querySelector('#rg-u').value.trim(), password: d.querySelector('#rg-p').value });
          keepSession(j); location.reload();
        } catch (x) { e.textContent = /invalid/i.test(x.message) ? 'Correo o contraseña incorrectos' : (x.message || 'No se pudo entrar'); }
      };
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }

  function addHeaderButtons() {
    const who = document.getElementById('who');
    const mk = (txt, title, fn) => {
      const b = document.createElement('button'); b.textContent = txt; b.title = title;
      b.style.cssText = 'margin-left:12px;border:1px solid rgba(255,255,255,.45);background:transparent;color:#fff;border-radius:6px;padding:3px 10px;font:12px system-ui;cursor:pointer';
      b.onclick = fn;
      if (who && who.parentNode) who.parentNode.insertBefore(b, who.nextSibling);
      else { b.style.cssText += ';position:fixed;right:14px;top:10px;z-index:9999;background:#0B66C3'; document.body.appendChild(b); }
    };
    mk('Salir', 'Cerrar sesión', async () => {
      try { await realFetch(URL0 + '/auth/v1/logout', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + session.access_token } }); } catch (e) {}
      saveSession(null); location.reload();
    });
    mk('↻ Sincronizar', 'Traer las OT de Fixner y los cambios del Excel', openSyncHelp);
    if (me && me.admin) mk('Importar copia', 'Cargar la copia descargada de la web de Claude', openImport);
  }

  /* ---------- sincronización ---------- */
  function apply(rows) {
    const touched = new Set();
    for (const c of rows) {
      const m = cols[c.col] || (cols[c.col] = new Map());
      if (c.deleted) m.delete(c.id); else m.set(c.id, { data: freeze(c.data), version: c.version });
      touched.add(c.col); if (c.seq > seq) seq = c.seq;
    }
    return touched;
  }
  function notify(touched) {
    for (const l of listeners) if (touched === true || touched.has(l.q.col)) { try { l.next(snapshotOf(l.q)); } catch (e) { console.error(e); } }
  }
  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const first = seq === 0; const all = new Set();
        // se repasan unas cuantas posiciones atrás por si alguna escritura simultánea llegó tarde
        let from = first ? 0 : Math.max(0, seq - 25);
        for (;;) {
          const rows = await rest('GET', `/rest/v1/docs?select=col,id,data,version,deleted,seq&seq=gt.${from}&order=seq.asc&limit=1000`);
          if (!rows || !rows.length) break;
          const t = apply(rows); t.forEach(x => all.add(x)); from = rows[rows.length - 1].seq;
          if (rows.length < 1000) break;
        }
        if (all.size || first) notify(first ? true : all);
      } catch (e) { /* se reintenta en el siguiente ciclo */ }
      finally { syncing = null; }
    })();
    return syncing;
  }

  /* ---------- consultas (como el 'db' de Claude) ---------- */
  function docSnap(id, d) { return { id, exists: !!d, data: () => (d ? d.data : undefined), metadata: { fromCache: false, hasPendingWrites: false } }; }
  function snapshotOf(q) {
    const m = cols[q.col] || new Map();
    let docs = [...m.entries()].map(([id, d]) => docSnap(id, d));
    for (const [f, op, v] of q.wh) docs = docs.filter(s => {
      const x = s.data()[f];
      switch (op) {
        case '==': return x === v; case '!=': return x !== v; case '<': return x < v; case '<=': return x <= v;
        case '>': return x > v; case '>=': return x >= v; case 'in': return v.includes(x); case 'not-in': return !v.includes(x);
        case 'array-contains': return Array.isArray(x) && x.includes(v); default: return true;
      }
    });
    if (q.ob) { const [f, dir] = q.ob; docs.sort((a, b) => { const x = a.data()[f], y = b.data()[f]; if (x === undefined) return 1; if (y === undefined) return -1; return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); }); }
    else docs.sort((a, b) => (a.id < b.id ? -1 : 1));
    if (q.lim) docs = docs.slice(0, q.lim);
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => docs.map((d, i) => ({ type: 'added', doc: d, oldIndex: -1, newIndex: i })), metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function makeQuery(q) {
    return {
      where: (f, op, v) => makeQuery({ ...q, wh: [...q.wh, [f, op, v]] }),
      orderBy: (f, dir) => makeQuery({ ...q, ob: [f, dir || 'asc'] }),
      limit: n => makeQuery({ ...q, lim: n }),
      get: async () => { await sync(); return snapshotOf(q); },
      onSnapshot(next, error) {
        const l = { q, next, error }; listeners.add(l);
        ready.then(() => sync()).then(() => { if (listeners.has(l)) next(snapshotOf(q)); });
        return () => listeners.delete(l);
      },
    };
  }
  const newId = () => [...crypto.getRandomValues(new Uint8Array(15))].map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  const clean = o => JSON.parse(JSON.stringify(o === undefined ? {} : o));
  function docRef(col, id) {
    return {
      id, path: col + '/' + id,
      async get() { await sync(); const m = cols[col]; return docSnap(id, m && m.get(id)); },
      async set(data) {
        await rest('POST', '/rest/v1/docs?on_conflict=col,id', { col, id, data: clean(data), deleted: false }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
        await sync();
      },
      async update(data) { await rest('POST', '/rest/v1/rpc/doc_merge', { p_col: col, p_id: id, p_data: clean(data), p_create: false }); await sync(); },
      async delete() {
        await rest('PATCH', `/rest/v1/docs?col=eq.${encodeURIComponent(col)}&id=eq.${encodeURIComponent(id)}`, { deleted: true, data: {} }, { Prefer: 'return=minimal' });
        await sync();
      },
      onSnapshot(next) { const q = { col, wh: [], ob: null, lim: null }; const l = { q, next: () => { const m = cols[col]; next(docSnap(id, m && m.get(id))); } }; listeners.add(l); ready.then(sync).then(() => l.next()); return () => listeners.delete(l); },
      collection(sub) { return collectionRef(col + '/' + id + '/' + sub); },
      async acquire() { return { acquired: true }; },
    };
  }
  function collectionRef(col) {
    const q = makeQuery({ col, wh: [], ob: null, lim: null });
    return Object.assign(q, { path: col, doc: id => docRef(col, id || newId()), add: async data => { const r = docRef(col, newId()); await r.set(data); return r; } });
  }
  function splitPath(p) { const s = String(p).split('/'); return [s.slice(0, -1).join('/'), s[s.length - 1]]; }
  const dbNs = Object.freeze({ collection: collectionRef, doc: p => { const [c, id] = splitPath(p); return docRef(c, id); } });

  /* ---------- usuario ---------- */
  const userNs = Object.freeze({
    id: async () => (await ready, me && me.id),
    me: async () => (await ready, { id: me && me.id, name: (me && me.name) || '' }),
    isOwner: async () => (await ready, !!(me && me.admin)),
    canEdit: async () => true,
    can: async () => true,
    async profiles(ids) {
      if (!peopleCache) { try { peopleCache = await rest('GET', '/rest/v1/people?select=id,name'); } catch (e) { peopleCache = []; } }
      const out = {}; for (const id of ids || []) { const u = peopleCache.find(x => x.id === id); out[id] = { id, name: u ? u.name : '' }; } return out;
    },
    search: async () => [],
  });

  /* ---------- archivos (presupuestos) ---------- */
  const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
  async function putFile(id, blob, type) {
    await rest('POST', `/storage/v1/object/${BUCKET}/${id}`, blob, { 'Content-Type': type || blob.type || 'application/octet-stream', 'x-upsert': 'true' });
  }
  const assetsNs = Object.freeze({
    async upload(blob, opt) {
      const type = (opt && opt.type) || blob.type || 'application/octet-stream';
      if (blob.size > 20 * 1024 * 1024) throw err('too_large', 'Archivo demasiado grande (máx. 20 MB)');
      const id = hex(16); await putFile(id, blob, type);
      return { id, url: '/_blob/' + id, sizeBytes: blob.size, contentType: type };
    },
    async delete(ref) { const id = String(ref).split('/').pop(); await rest('DELETE', `/storage/v1/object/${BUCKET}/${id}`); return { deleted: true }; },
    async list() { return { assets: [], usage: {} }; },
  });
  // la web pide los adjuntos a /_blob/<id>: se sirven desde el almacenamiento de Supabase
  window.fetch = async function (input, init) {
    const u = typeof input === 'string' ? input : (input && input.url) || '';
    const m = /(?:^|\/)_blob\/([A-Za-z0-9]+)$/.exec(u.split('?')[0]);
    if (m && !u.startsWith(URL0)) {
      const t = await token();
      return realFetch(`${URL0}/storage/v1/object/authenticated/${BUCKET}/${m[1]}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + t } });
    }
    return realFetch(input, init);
  };
  const downloadsNs = Object.freeze({
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename || 'archivo';
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      return { saved: true };
    },
  });

  window.claude = Object.freeze({
    use: async name => {
      await ready;
      return { db: dbNs, user: userNs, assets: assetsNs, downloads: downloadsNs }[name] || null;
    },
  });

  /* ---------- ayuda del botón de sincronizar ---------- */
  function openSyncHelp() {
    if (document.getElementById('rg-sh')) return;
    const fx = 'https://app3.fixner.com/fixner.html#ordenTrabajoList:';
    const xl = 'https://garciadepou0-my.sharepoint.com/:x:/r/personal/electrico_fabrica02_garciadepou_com/_layouts/15/Doc.aspx?sourcedoc=%7BCD8987E5-3CF6-49B5-8285-38FFEED9F8BD%7D&action=default';
    let last = '';
    const meta = cols.fixner_ots && cols.fixner_ots.get('_meta');
    if (meta && meta.data && meta.data.sincronizado) last = new Date(meta.data.sincronizado).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
    const d = document.createElement('div'); d.id = 'rg-sh';
    d.innerHTML = `<div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font:14px/1.5 'IBM Plex Sans',system-ui,sans-serif">
      <div style="background:#fff;color:#1c1f22;border-radius:12px;padding:22px 24px;width:min(560px,94vw)">
      <h3 style="margin:0 0 6px">Sincronizar con Fixner y el Excel</h3>
      ${last ? `<p style="margin:0 0 12px;color:#55595e">Última lectura de Fixner: <b>${last}</b></p>` : ''}
      <p style="margin:0 0 8px"><b>1. Una sola vez:</b> arrastra este botón a la barra de marcadores de Chrome (si no la ves: Ctrl+Mayús+B).</p>
      <p style="margin:0 0 14px;text-align:center"><a id="rg-bm" style="display:inline-block;background:#0B66C3;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:600;cursor:grab">↻ Recambios</a></p>
      <p style="margin:0 0 6px"><b>2. Cuando quieras actualizar:</b></p>
      <ul style="margin:0 0 14px;padding-left:20px">
        <li>Abre <a href="${fx}" target="_blank" rel="noopener">Fixner</a> (listado de órdenes de trabajo) y pulsa <b>↻ Recambios</b> en la barra de marcadores: trae las OT bloqueadas y de material almacén.</li>
        <li>Abre <a href="${xl}" target="_blank" rel="noopener">el Excel</a> y pulsa <b>↻ Recambios</b>: trae las filas nuevas o cambiadas.</li>
      </ul>
      <p style="margin:0 0 14px;color:#55595e;font-size:13px">Nunca se borra ni se pisa lo que ya está en la web: solo se añaden pedidos nuevos y se rellenan los huecos.</p>
      <div style="text-align:right"><button id="rg-sh-c" style="padding:8px 14px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer">Cerrar</button></div></div></div>`;
    document.body.appendChild(d);
    const a = d.querySelector('#rg-bm'); a.href = window.RG_BOOKMARKLET || '#';
    a.onclick = e => { e.preventDefault(); alert('Arrástralo a la barra de marcadores (no hace falta pulsarlo aquí).'); };
    d.querySelector('#rg-sh-c').onclick = () => d.remove();
  }

  /* ---------- importar la copia de la web de Claude (solo administradores) ---------- */
  function openImport() {
    if (document.getElementById('rg-imp')) return;
    const d = document.createElement('div'); d.id = 'rg-imp';
    d.innerHTML = `<div style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font:14px 'IBM Plex Sans',system-ui,sans-serif">
      <div style="background:#fff;color:#1c1f22;border-radius:12px;padding:22px;width:min(480px,92vw)">
      <h3 style="margin:0 0 8px">Importar copia</h3>
      <p style="margin:0 0 12px;color:#55595e">En la web de Claude: pestaña <b>Procedimiento</b> → <b>Descargar copia completa</b>. Sube aquí ese archivo .json. Se puede repetir sin duplicar nada.</p>
      <input type="file" id="rg-imp-f" accept=".json,application/json">
      <div id="rg-imp-m" style="margin:12px 0;min-height:18px;color:#55595e"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button id="rg-imp-c" style="padding:8px 14px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer">Cerrar</button>
      <button id="rg-imp-go" disabled style="padding:8px 14px;border:0;background:#e8590c;color:#fff;border-radius:8px;cursor:pointer">Importar</button></div></div></div>`;
    document.body.appendChild(d);
    const say = t => { d.querySelector('#rg-imp-m').textContent = t; };
    d.querySelector('#rg-imp-c').onclick = () => d.remove();
    d.querySelector('#rg-imp-f').onchange = e => { d.querySelector('#rg-imp-go').disabled = !e.target.files.length; };
    d.querySelector('#rg-imp-go').onclick = async () => {
      const f = d.querySelector('#rg-imp-f').files[0]; if (!f) return;
      d.querySelector('#rg-imp-go').disabled = true;
      try {
        say('Leyendo el archivo…');
        const bk = JSON.parse(await f.text());
        if (!bk || !bk.collections) throw new Error('El archivo no parece una copia de la web de recambios.');
        const rows = [];
        for (const [col, docs] of Object.entries(bk.collections)) for (const x of docs) if (x && x.id && x.data) rows.push({ col, id: String(x.id), data: x.data, deleted: false });
        for (let i = 0; i < rows.length; i += 200) {
          say(`Registros: ${Math.min(i + 200, rows.length)} de ${rows.length}…`);
          await rest('POST', '/rest/v1/docs?on_conflict=col,id', rows.slice(i, i + 200), { Prefer: 'resolution=merge-duplicates,return=minimal' });
        }
        const files = (bk.files || []).filter(x => x && /^[A-Za-z0-9]{1,64}$/.test(x.id) && x.b64);
        let n = 0;
        for (const x of files) {
          n++; say(`Archivos: ${n} de ${files.length}…`);
          const bin = atob(x.b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          await putFile(x.id, new Blob([u8], { type: x.type || 'application/octet-stream' }), x.type);
        }
        say(`Listo: ${rows.length} registros y ${files.length} archivos importados.`);
        seq = 0; for (const k of Object.keys(cols)) delete cols[k]; await sync();
      } catch (e) { say('Error: ' + (e.message || e)); }
      d.querySelector('#rg-imp-go').disabled = false;
    };
  }

  /* ---------- arranque ---------- */
  (async () => {
    loadSession();
    if (!URL0 || !KEY) { showLogin('Falta configurar config.js (dirección y clave pública de Supabase).'); return; }
    if (!session) { showLogin(); return; }
    try { await token(); } catch (e) { showLogin('La sesión ha caducado. Vuelve a entrar.'); return; }
    const u = session.user || {};
    const email = String(u.email || '').toLowerCase();
    const meta = u.user_metadata || {};
    let name = meta.name || meta.full_name || '';
    if (!name) { const p = email.split('@')[0] || ''; name = p.charAt(0).toUpperCase() + p.slice(1); }
    me = { id: u.id, name, email, admin: false };
    try { const a = await rest('GET', `/rest/v1/admins?select=email&email=eq.${encodeURIComponent(email)}`); me.admin = !!(a && a.length); } catch (e) {}
    try {
      const row = await rest('GET', `/rest/v1/people?select=name&id=eq.${u.id}`);
      if (row && row[0] && row[0].name) me.name = row[0].name;
      else await rest('POST', '/rest/v1/people', { id: u.id, name, email }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    } catch (e) { /* no es imprescindible */ }
    readyResolve();
    const start = () => { addHeaderButtons(); setInterval(sync, POLL_MS); document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  })();
})();
