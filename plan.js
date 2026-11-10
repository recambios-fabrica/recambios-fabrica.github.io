/*
 * Plan de mantenimiento de instalaciones (puertas, tejados, PCI…). SOLO ADMINISTRADORES.
 * Los datos están en la colección "plan_elementos" y los certificados en el almacén "plan";
 * la base de datos impide que los usuarios que no son administradores los lean o escriban.
 */
(function () {
  'use strict';
  const COL = 'plan_elementos';
  const TIPOS = ['Puertas', 'Tejados / cubiertas', 'Fachadas', 'Contra incendios (PCI)', 'Iluminación', 'Electricidad', 'Climatización', 'Fontanería / saneamiento', 'Aire comprimido', 'Viales / exteriores', 'Elevación (puentes grúa, plataformas)', 'Otros'];
  const FREQ = [[1, 'Mensual'], [2, 'Bimestral'], [3, 'Trimestral'], [4, 'Cuatrimestral'], [6, 'Semestral'], [12, 'Anual'], [24, 'Cada 2 años'], [36, 'Cada 3 años'], [60, 'Cada 5 años']];
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const P = { items: [], db: null, unsub: null, q: '', tipo: '', kpi: 'all', vista: 'lista' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hoy = () => iso(new Date());
  const parse = s => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const fmt = s => { const d = parse(s); return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '—'; };
  const addM = (d, m) => { const r = new Date(d.getFullYear(), d.getMonth() + m, 1); r.setDate(Math.min(d.getDate(), new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate())); return r; };
  const freqTxt = n => (FREQ.find(f => f[0] === +n) || [0, n ? `Cada ${n} meses` : '—'])[1];
  const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // Fechas siempre en día laborable: sábado o domingo pasan al lunes siguiente
  const lab = d => { const r = new Date(d); const w = r.getDay(); if (w === 6) r.setDate(r.getDate() + 2); else if (w === 0) r.setDate(r.getDate() + 1); return r; };
  // Próxima: si aún no se ha hecho la primera, la que viene después de la primera
  const sig = it => { const f = +it.frecuencia || 0, ini = parse(it.inicio); if (!it.ultima && ini && f) return iso(lab(addM(ini, f))); return it._c ? it._c.prox : calc(it).prox; };
  function calc(it) {
    const u = parse(it.ultima), f = +it.frecuencia || 0, ini = parse(it.inicio);
    if (!(u && f) && !ini) return { prox: null, est: 'pend', dias: null };
    const p = lab(u && f ? addM(u, f) : ini); const dias = Math.round((p - parse(hoy())) / 864e5);
    return { prox: iso(p), dias, est: dias < 0 ? 'venc' : dias <= 30 ? 'toca' : 'ok' };
  }
  const EST = { venc: ['Vencida', '#b42318', '#fde8e6'], toca: ['Toca ya', '#b54708', '#fff1e0'], ok: ['Al día', '#1a7f37', '#e6f4ea'], pend: ['Sin fecha', '#55595e', '#ecebe7'] };

  function css() {
    if (document.getElementById('rgp-css')) return;
    const s = document.createElement('style'); s.id = 'rgp-css';
    s.textContent = `
    #rgp{position:fixed;inset:0;z-index:9000;background:linear-gradient(rgba(243,242,238,.92),rgba(243,242,238,.92)),url(fondo.jpg) center/cover fixed,#f3f2ee;overflow:auto;font:14px/1.45 'IBM Plex Sans',system-ui,sans-serif;color:#1c1f22}
    #rgp header{position:sticky;top:0;z-index:2;background:#0B66C3;color:#fff;display:flex;align-items:center;gap:14px;padding:10px 22px}
    #rgp header img{height:22px} #rgp header b{font-size:16px} #rgp header .sp{flex:1}
    #rgp header button{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:6px;padding:4px 12px;cursor:pointer;font:inherit}
    #rgp main{max-width:1400px;margin:0 auto;padding:18px 22px 60px}
    .rgp-k{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px}
    .rgp-k button{background:#fff;border:1px solid #dddbd4;border-radius:10px;padding:10px 16px;min-width:130px;text-align:left;cursor:pointer;font:inherit}
    .rgp-k button b{display:block;font-size:24px}.rgp-k button.on{outline:2px solid #e8590c}
    .rgp-k button.venc b{color:#b42318}.rgp-k button.toca b{color:#b54708}
    @keyframes rgpblink{0%,100%{background:#fde8e6}50%{background:#fff}} .rgp-k button.venc.blink{animation:rgpblink 1.2s infinite}
    .rgp-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
    .rgp-bar input,.rgp-bar select{padding:8px 10px;border:1px solid #dddbd4;border-radius:8px;font:inherit;background:#fff}
    .rgp-btn{padding:8px 14px;border:0;border-radius:8px;background:#e8590c;color:#fff;font:600 14px inherit;cursor:pointer}
    .rgp-btn.sec{background:#fff;color:#1c1f22;border:1px solid #dddbd4;font-weight:500}
    .rgp-btn.ok{background:#1a7f37}
    .rgp-tw{background:#fff;border:1px solid #dddbd4;border-radius:10px;overflow:auto}
    .rgp-tw table{width:100%;border-collapse:collapse}
    .rgp-tw th{position:sticky;top:0;background:#f7f6f2;text-align:left;font-size:12px;color:#55595e;padding:9px 10px;border-bottom:1px solid #dddbd4;white-space:nowrap}
    .rgp-tw td{padding:9px 10px;border-bottom:1px solid #eeede8;vertical-align:top}
    .rgp-tw tr:hover td{background:#fafaf7;cursor:pointer}
    .rgp-tw tr.venc td{background:#fff6f5}
    .rgp-pill{display:inline-block;padding:2px 9px;border-radius:20px;font-size:12px;font-weight:600;white-space:nowrap}
    .rgp-empty{padding:40px;text-align:center;color:#55595e}
    .rgp-cal{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
    .rgp-cal .m{background:#fff;border:1px solid #dddbd4;border-radius:10px;padding:10px 12px}
    .rgp-cal .m h4{margin:0 0 6px;text-transform:capitalize;display:flex;justify-content:space-between}
    .rgp-cal .m li{font-size:13px;margin:2px 0;cursor:pointer} .rgp-cal .m ul{margin:0;padding-left:16px}
    #rgp-mod{position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,.4);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:40px 12px}
    #rgp-mod form{background:#fff;border-radius:12px;padding:20px 22px;width:min(640px,96vw);font:14px 'IBM Plex Sans',system-ui,sans-serif}
    #rgp-mod h3{margin:0 0 12px} #rgp-mod .g{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}
    #rgp-mod label{font-size:12px;color:#55595e;display:block;margin-bottom:3px} #rgp-mod .full{grid-column:1/-1}
    #rgp-mod input,#rgp-mod select,#rgp-mod textarea{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #dddbd4;border-radius:8px;font:inherit}
    #rgp-mod textarea{min-height:60px} #rgp-mod .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}
    #rgp-mod .hist{margin-top:14px;border-top:1px solid #eeede8;padding-top:10px} #rgp-mod .hist div{font-size:13px;padding:4px 0;border-bottom:1px dashed #eeede8}
    #rgp-mod .hist a{color:#0B66C3;cursor:pointer}`;
    document.head.appendChild(s);
  }

  async function open() {
    if (!window.RG_PRIV || !RG_PRIV.isAdmin()) { alert('Solo para administradores.'); return; }
    css();
    let d = document.getElementById('rgp');
    if (!d) {
      d = document.createElement('div'); d.id = 'rgp';
      d.innerHTML = `<header><img src="logo.png" alt=""><b>Plan de mantenimiento · Instalaciones</b><span style="opacity:.75;font-size:12px">(solo tú lo ves)</span><span class="sp"></span><button id="rgp-x">← Volver a pedidos</button></header><main id="rgp-main"><div class="rgp-empty">Cargando…</div></main>`;
      document.body.appendChild(d);
      d.querySelector('#rgp-x').onclick = () => { d.style.display = 'none'; document.body.style.overflow = ''; };
    }
    d.style.display = ''; document.body.style.overflow = 'hidden';
    if (!P.db) {
      P.db = await claude.use('db');
      P.unsub = P.db.collection(COL).onSnapshot(sn => { P.items = sn.docs.filter(x => x.exists).map(x => ({ id: x.id, ...x.data() })); draw(); });
    }
    draw();
  }

  function filtered() {
    const q = P.q.trim().toLowerCase();
    return P.items.map(it => ({ ...it, _c: calc(it) }))
      .filter(it => !P.tipo || it.tipo === P.tipo)
      .filter(it => P.kpi === 'all' || (P.kpi === 'mes' ? (it._c.est === 'venc' || it._c.est === 'toca') : it._c.est === P.kpi))
      .filter(it => !q || [it.nombre, it.zona, it.tipo, it.tarea, it.responsable, it.externa, it.notas].join(' ').toLowerCase().includes(q))
      .sort((a, b) => { const o = { venc: 0, toca: 1, pend: 2, ok: 3 }; return (o[a._c.est] - o[b._c.est]) || String(a._c.prox || '9').localeCompare(String(b._c.prox || '9')) || String(a.nombre).localeCompare(String(b.nombre)); });
  }

  function draw() {
    const m = document.getElementById('rgp-main'); if (!m) return;
    const all = P.items.map(it => calc(it));
    const n = k => all.filter(c => c.est === k).length;
    const tipos = [...new Set([...TIPOS, ...P.items.map(i => i.tipo).filter(Boolean)])];
    const rows = filtered();
    m.innerHTML = `
      <div class="rgp-k">
        <button data-k="venc" class="venc ${n('venc') ? 'blink' : ''} ${P.kpi === 'venc' ? 'on' : ''}"><b>${n('venc')}</b>Vencidas</button>
        <button data-k="toca" class="toca ${P.kpi === 'toca' ? 'on' : ''}"><b>${n('toca')}</b>Toca en 30 días</button>
        <button data-k="ok" class="${P.kpi === 'ok' ? 'on' : ''}"><b>${n('ok')}</b>Al día</button>
        <button data-k="pend" class="${P.kpi === 'pend' ? 'on' : ''}"><b>${n('pend')}</b>Sin fecha</button>
        <button data-k="all" class="${P.kpi === 'all' ? 'on' : ''}"><b>${P.items.length}</b>Todos</button>
      </div>
      <div class="rgp-bar">
        <button class="rgp-btn" id="rgp-new">+ Nuevo elemento</button>
        <input id="rgp-q" placeholder="Buscar (puerta, nave, empresa…)" value="${esc(P.q)}" style="min-width:240px">
        <select id="rgp-t"><option value="">Todos los tipos</option>${tipos.map(t => `<option ${P.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <span style="flex:1"></span>
        <button class="rgp-btn sec" id="rgp-pl">🗺 Plano de puertas</button>
        <button class="rgp-btn sec" id="rgp-v">${P.vista === 'lista' ? '📅 Ver calendario' : '📋 Ver lista'}</button>
      </div>
      ${P.vista === 'lista' ? lista(rows) : calendario(rows)}`;
    m.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { P.kpi = b.dataset.k; draw(); });
    m.querySelector('#rgp-new').onclick = () => edit(null);
    const q = m.querySelector('#rgp-q'); q.oninput = () => { P.q = q.value; const pos = q.selectionStart; draw(); const q2 = document.getElementById('rgp-q'); q2.focus(); q2.setSelectionRange(pos, pos); };
    m.querySelector('#rgp-t').onchange = e => { P.tipo = e.target.value; draw(); };
    m.querySelector('#rgp-pl').onclick = () => plano();
    m.querySelector('#rgp-v').onclick = () => { P.vista = P.vista === 'lista' ? 'cal' : 'lista'; draw(); };
    m.querySelectorAll('[data-id]').forEach(el => el.onclick = ev => { if (ev.target.closest('[data-done]')) return; edit(el.dataset.id); });
    m.querySelectorAll('[data-done]').forEach(b => b.onclick = ev => { ev.stopPropagation(); hecho(b.dataset.done); });
  }

  function lista(rows) {
    if (!P.items.length) return `<div class="rgp-tw"><div class="rgp-empty">Todavía no hay elementos.<br>Pulsa <b>+ Nuevo elemento</b> para añadir la primera puerta, tejado, extintor…</div></div>`;
    if (!rows.length) return `<div class="rgp-tw"><div class="rgp-empty">Nada con este filtro.</div></div>`;
    return `<div class="rgp-tw"><table><thead><tr><th>Estado</th><th>Elemento</th><th>Ubicación</th><th>Tipo</th><th>Qué hay que hacer</th><th>Frecuencia</th><th>Primera revisión</th><th>Última hecha</th><th>Próxima</th><th>Responsable / empresa</th><th></th></tr></thead><tbody>
      ${rows.map(it => { const [t, c, bg] = EST[it._c.est]; const dd = it._c.dias;
        return `<tr data-id="${esc(it.id)}" class="${it._c.est}"><td><span class="rgp-pill" style="color:${c};background:${bg}">${t}</span>${dd != null ? `<div style="font-size:11px;color:#55595e;margin-top:3px">${dd < 0 ? `hace ${-dd} días` : dd === 0 ? 'hoy' : `en ${dd} días`}</div>` : ''}</td>
        <td><b>${esc(it.nombre)}</b></td><td>${esc(it.zona)}</td><td>${esc(it.tipo)}</td><td style="max-width:320px">${esc(it.tarea)}</td>
        <td>${esc(freqTxt(it.frecuencia))}</td><td>${fmt(it.inicio)}</td><td>${fmt(it.ultima)}</td><td><b>${fmt(sig(it))}</b></td>
        <td>${esc(it.responsable)}${it.externa ? `<div style="font-size:12px;color:#55595e">${esc(it.externa)}</div>` : ''}</td>
        <td><button class="rgp-btn ok" data-done="${esc(it.id)}" title="Marcar revisión hecha">✓ Hecho</button></td></tr>`; }).join('')}
    </tbody></table></div>`;
  }

  function calendario(rows) {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const months = Array.from({ length: 12 }, (_, i) => new Date(start.getFullYear(), start.getMonth() + i, 1));
    const by = months.map(() => []);
    const venc = [];
    for (const it of rows) {
      const c = it._c; if (!c.prox) continue;
      const p0 = parse(c.prox); const f = +it.frecuencia || 0; let p = p0;
      if (p0 < start) venc.push(it);
      for (let k = 0; k < 60; k++) {
        const q = k ? lab(p) : p;
        const idx = (q.getFullYear() - start.getFullYear()) * 12 + q.getMonth() - start.getMonth();
        if (idx > 11) break; if (idx >= 0 && q >= start) by[idx].push({ it, d: iso(q) });
        if (!f) break; p = addM(p0, f * (k + 1));
      }
    }
    return `${venc.length ? `<div class="rgp-tw" style="padding:10px 14px;margin-bottom:12px;border-color:#f5c2bd;background:#fff6f5"><b style="color:#b42318">Vencidas (${venc.length}):</b> ${venc.map(it => `<a data-id="${esc(it.id)}" style="cursor:pointer;color:#b42318;text-decoration:underline;margin-right:10px">${esc(it.nombre)}</a>`).join('')}</div>` : ''}
      <div class="rgp-cal">${months.map((d, i) => `<div class="m"><h4><span>${MESES[d.getMonth()]} ${d.getFullYear()}</span><span style="color:#55595e;font-weight:400">${by[i].length}</span></h4>
        ${by[i].length ? `<ul>${by[i].sort((a, b) => a.d.localeCompare(b.d) || String(a.it.nombre).localeCompare(String(b.it.nombre))).map(({ it, d }) => `<li data-id="${esc(it.id)}"><b style="color:#55595e">${d.slice(8)}/${d.slice(5, 7)}</b> ${esc(it.nombre)}${it.externa ? ` <span style="color:#55595e">· ${esc(it.externa)}</span>` : ''}</li>`).join('')}</ul>` : '<div style="color:#9a9a92;font-size:13px">Nada</div>'}</div>`).join('')}</div>`;
  }

  function modal(html) {
    const old = document.getElementById('rgp-mod'); if (old) old.remove();
    const d = document.createElement('div'); d.id = 'rgp-mod'; d.innerHTML = `<form autocomplete="off">${html}</form>`;
    document.body.appendChild(d); d.onclick = e => { if (e.target === d) d.remove(); };
    return d;
  }

  function edit(id) {
    const it = id ? P.items.find(x => x.id === id) : { frecuencia: 12 };
    if (!it) return;
    const tipos = [...new Set([...TIPOS, ...P.items.map(i => i.tipo).filter(Boolean)])];
    const d = modal(`<h3>${id ? 'Editar elemento' : 'Nuevo elemento'}</h3>
      <div class="g">
        <div class="full"><label>Elemento *</label><input name="nombre" required value="${esc(it.nombre)}" placeholder="Ej.: Puerta rápida muelle 3"></div>
        <div><label>Ubicación / zona</label><input name="zona" value="${esc(it.zona)}" placeholder="Nave 2, expedición…"></div>
        <div><label>Tipo</label><input name="tipo" list="rgp-tipos" value="${esc(it.tipo)}"><datalist id="rgp-tipos">${tipos.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
        <div class="full"><label>Qué hay que hacer</label><textarea name="tarea" placeholder="Revisar motor, fotocélulas y finales de carrera…">${esc(it.tarea)}</textarea></div>
        <div><label>Frecuencia</label><select name="frecuencia">${FREQ.map(([v, t]) => `<option value="${v}" ${+it.frecuencia === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div><label>Última revisión</label><input type="date" name="ultima" value="${esc(it.ultima || '')}"></div>
        <div><label>Primera revisión (si aún no hay ninguna)</label><input type="date" name="inicio" value="${esc(it.inicio || '')}"></div><div></div>
        <div><label>Responsable</label><input name="responsable" value="${esc(it.responsable)}" placeholder="Jose, Joan…"></div>
        <div><label>Empresa externa</label><input name="externa" value="${esc(it.externa)}" placeholder="Mantenedor autorizado…"></div>
        <div class="full"><label>Notas</label><textarea name="notas">${esc(it.notas)}</textarea></div>
      </div>
      ${id && (it.historial || []).length ? `<div class="hist"><b>Historial de revisiones</b>${[...it.historial].reverse().map((h, i) => `<div>${fmt(h.fecha)} · ${esc(h.por || '')}${h.comentario ? ` — ${esc(h.comentario)}` : ''}${h.file ? ` · <a data-f="${esc(h.file.id)}" data-n="${esc(h.file.nombre)}">📎 ${esc(h.file.nombre)}</a>` : ''}</div>`).join('')}</div>` : ''}
      <div class="acts">${id ? '<button type="button" class="rgp-btn sec" id="rgp-del" style="color:#b42318;margin-right:auto">Eliminar</button><button type="button" class="rgp-btn ok" id="rgp-dn">✓ Marcar hecho</button>' : ''}
        <button type="button" class="rgp-btn sec" id="rgp-c">Cancelar</button><button type="submit" class="rgp-btn">Guardar</button></div>`);
    d.querySelector('#rgp-c').onclick = () => d.remove();
    d.querySelectorAll('[data-f]').forEach(a => a.onclick = () => verArchivo(a.dataset.f, a.dataset.n));
    if (id) {
      d.querySelector('#rgp-dn').onclick = () => { d.remove(); hecho(id); };
      d.querySelector('#rgp-del').onclick = async () => { if (!confirm('¿Eliminar «' + it.nombre + '» del plan? (queda en el historial de seguridad)')) return; await P.db.collection(COL).doc(id).delete(); d.remove(); };
    }
    d.querySelector('form').onsubmit = async ev => {
      ev.preventDefault();
      const f = new FormData(ev.target); const o = {};
      for (const k of ['nombre', 'zona', 'tipo', 'tarea', 'ultima', 'inicio', 'responsable', 'externa', 'notas']) o[k] = String(f.get(k) || '').trim();
      o.frecuencia = +f.get('frecuencia') || 12;
      if (!o.nombre) return;
      if (id) await P.db.collection(COL).doc(id).update(o);
      else await P.db.collection(COL).doc(newId()).set({ ...o, historial: [], creadoEn: Date.now() });
      d.remove();
    };
  }

  function hecho(id) {
    const it = P.items.find(x => x.id === id); if (!it) return;
    const d = modal(`<h3>Revisión hecha: ${esc(it.nombre)}</h3>
      <div class="g"><div><label>Fecha</label><input type="date" name="fecha" value="${hoy()}" required></div><div></div>
      <div class="full"><label>Comentario</label><textarea name="comentario" placeholder="Todo correcto / se cambió… / pendiente de…"></textarea></div>
      <div class="full"><label>Certificado o informe (opcional, PDF o foto)</label><input type="file" name="file" accept=".pdf,image/*"></div></div>
      <div id="rgp-m" style="min-height:18px;font-size:13px;color:#55595e;margin-top:8px"></div>
      <div class="acts"><button type="button" class="rgp-btn sec" id="rgp-c">Cancelar</button><button type="submit" class="rgp-btn ok">Guardar revisión</button></div>`);
    d.querySelector('#rgp-c').onclick = () => d.remove();
    d.querySelector('form').onsubmit = async ev => {
      ev.preventDefault(); const f = new FormData(ev.target); const msg = d.querySelector('#rgp-m');
      try {
        const fecha = String(f.get('fecha')); const file = f.get('file'); let fileRef = null;
        if (file && file.size) { msg.textContent = 'Subiendo archivo…'; if (file.size > 20 * 1024 * 1024) throw new Error('Archivo demasiado grande (máx. 20 MB)'); fileRef = { id: await RG_PRIV.upload('plan', file, file.type), nombre: file.name, type: file.type }; }
        const me = RG_PRIV.me() || {};
        const h = { fecha, por: me.name || '', comentario: String(f.get('comentario') || '').trim(), ...(fileRef ? { file: fileRef } : {}), t: Date.now() };
        const ultima = !it.ultima || fecha >= it.ultima ? fecha : it.ultima;
        await P.db.collection(COL).doc(id).update({ ultima, historial: [...(it.historial || []), h] });
        d.remove();
      } catch (e) { msg.style.color = '#b42318'; msg.textContent = e.message || String(e); }
    };
  }

  async function plano() {
    let cfg = null; try { const g = await P.db.collection('plan_config').doc('plano').get(); cfg = g.exists ? g.data() : null; } catch (e) {}
    const d = modal(`<h3>🗺 Plano de puertas</h3>
      ${cfg && cfg.file ? `<p style="margin:6px 0 14px">Plano actual: <b>${esc(cfg.file.nombre)}</b> <span style="color:#55595e;font-size:12px">(${fmt(cfg.fecha)})</span></p>
        <button type="button" class="rgp-btn" id="rgp-ab">Abrir plano</button>` : '<p style="color:#55595e">Todavía no hay plano subido.</p>'}
      <div style="margin-top:16px"><label>${cfg && cfg.file ? 'Cambiar por otro plano' : 'Subir plano'} (PDF o imagen)</label><input type="file" name="file" id="rgp-plf" accept=".pdf,image/*"></div>
      <div id="rgp-m" style="min-height:18px;font-size:13px;color:#55595e;margin-top:8px"></div>
      <div class="acts"><button type="button" class="rgp-btn sec" id="rgp-c">Cerrar</button><button type="submit" class="rgp-btn">Subir</button></div>`);
    d.querySelector('#rgp-c').onclick = () => d.remove();
    const ab = d.querySelector('#rgp-ab'); if (ab) ab.onclick = () => verArchivo(cfg.file.id, cfg.file.nombre);
    d.querySelector('form').onsubmit = async ev => {
      ev.preventDefault(); const file = d.querySelector('#rgp-plf').files[0]; const msg = d.querySelector('#rgp-m');
      if (!file) { msg.textContent = 'Elige un archivo.'; return; }
      try { msg.textContent = 'Subiendo…'; if (file.size > 20 * 1024 * 1024) throw new Error('Archivo demasiado grande (máx. 20 MB)');
        const id = await RG_PRIV.upload('plan', file, file.type);
        await P.db.collection('plan_config').doc('plano').set({ file: { id, nombre: file.name, type: file.type }, fecha: hoy() });
        d.remove(); plano();
      } catch (e) { msg.style.color = '#b42318'; msg.textContent = e.message || String(e); }
    };
  }

  async function verArchivo(id, nombre) {
    try { const b = await RG_PRIV.get('plan', id); const u = URL.createObjectURL(b); const w = window.open(u, '_blank'); if (!w) { const a = document.createElement('a'); a.href = u; a.download = nombre || 'archivo'; a.click(); } setTimeout(() => URL.revokeObjectURL(u), 60000); }
    catch (e) { alert(e.message || e); }
  }

  window.RG_PLAN = Object.freeze({ open });
})();
