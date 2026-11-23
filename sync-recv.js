/*
 * Recepción de la sincronización manual (botón "↻ Recambios" de la barra de marcadores).
 * El botón se pulsa estando en Fixner (listado de OT) o en el Excel de SharePoint: lee los datos allí,
 * abre esta web y se los envía con postMessage. Aquí se crean los pedidos nuevos y se rellenan huecos,
 * sin pisar nunca lo que ya se haya editado en la web.
 */
(function () {
  'use strict';
  // Fixner puede servir a cada usuario desde app, app2, app3…; el Excel, desde el SharePoint de la empresa.
  const okOrigin = o => /^https:\/\/[a-z0-9-]+\.fixner\.com$/i.test(o) || /^https:\/\/garciadepou0(-my)?\.sharepoint\.com$/i.test(o);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // Códigos de OT que aparecen en una línea (OT, reparación, explicación, comentarios…), tolerando «T25/14465», «OT 25 / 14465»…
  const otCodes = r => { const out = new Set(); const t = [r.ot, r.reparacion, r.explicacion, r.comentarios, r.otros].join(' ');
    for (const m of t.matchAll(/(?:^|[^A-Z])O?T\s*(\d{2})\s*\/\s*(\d{3,6})/gi)) out.add(`OT${m[1]}/${m[2].padStart(5, '0')}`); return out; };
  const otNorm = c => { const m = /O?T\s*(\d{2})\s*\/\s*(\d{3,6})/i.exec(String(c || '')); return m ? `OT${m[1]}/${m[2].padStart(5, '0')}` : ''; };
  const U = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toUpperCase();

  async function doFixner(rows) {
    const db = await claude.use('db');
    const [paSn, otsSn, recSn, repSn] = await Promise.all(['fixner_pa', 'fixner_ots', 'recambios', 'reparaciones'].map(c => db.collection(c).get()));
    const pa = new Set(paSn.docs.map(d => d.id));
    const ots = new Map(otsSn.docs.map(d => [d.id, d.data()]));
    const rec = [...recSn.docs, ...repSn.docs].map(d => d.data());
    const nuevas = [], hoy = today(); let n = 0, cambios = 0;
    for (const line of rows || []) {
      const [code, desc, maq, estado, prio, tipo, inicio, resp, fxid] = String(line).split('|');
      if (!/^OT\d\d\/\d+$/.test(code || '')) continue;
      const id = code.replace('/', '-');
      const ot = ots.get(id);
      if (!ot) {
        ots.set(id, { estado, fxid });
        await db.collection('fixner_ots').doc(id).set({ codigo: code, descripcion: desc || '', activo: maq || '', estado: estado || '', prioridad: U(prio), tipo: tipo || '', inicio: inicio || '', fin: '', fxid: fxid || '' });
      } else if (ot.estado !== estado || (!ot.fxid && fxid)) {
        await db.collection('fixner_ots').doc(id).update({ estado: estado || '', ...(fxid ? { fxid } : {}) }); cambios++;
      }
      if (pa.has(id)) continue;
      // Solo generan pedido las OT bloqueadas (OP/PA) o de material almacén que sigan abiertas
      // (si el usuario no tiene los filtros «WEB · …» en Fixner, el botón manda el listado entero).
      if (/finaliz|anulad|cerrad/i.test(estado || '')) continue;
      if (!/bloqueada\s*(op|pa)/i.test(estado || '') && !/material\s*almac/i.test(tipo || '')) continue;
      const ya = rec.some(r => r.ot === code || r.reparacion === code || otCodes(r).has(otNorm(code)));
      if (ya) { await db.collection('fixner_pa').doc(id).set({ codigo: code, visto: hoy, pedido: 'ya existía' }); pa.add(id); continue; }
      const motivo = /bloqueada\s*op/i.test(estado) ? 'Bloqueada OP (falta material, máquina en marcha)'
        : /bloqueada\s*pa/i.test(estado) ? 'Bloqueada PA (falta material, máquina parada)'
        : `tipo MATERIAL ALMACÉN, estado ${estado}`;
      const t = Date.now() + (n++);
      await db.collection('recambios').doc('fx-' + id).set({
        fecha: hoy, descripcion: U(desc).slice(0, 70), maquina: U(String(maq || '').replace(/\*[^*]*\*/g, '')), solicitante: U(resp), ot: code, compra: 'X',
        explicacion: `Desde Fixner: ${code} «${desc}» — ${motivo}, prioridad ${prio}, ${String(tipo || '').toLowerCase()}. Abierta en Fixner el ${inicio}. Falta indicar el material.`,
        origen: 'fixner', creadoEn: t, orden: t,
      });
      await db.collection('fixner_pa').doc(id).set({ codigo: code, visto: hoy, pedido: 'recambios/fx-' + id });
      pa.add(id);
      nuevas.push(`${code} · ${U(maq)} · ${desc}`);
    }
    await db.collection('fixner_ots').doc('_meta').set({ sincronizado: Date.now() });
    return { leidas: (rows || []).length, nuevas, cambios };
  }

  const GREEN_FIELD = { recambios: 'fechaRecepcion', reparaciones: 'fechaRecepcion', rodillos: 'fechaLlegada' };
  async function doExcel(changed) {
    if (typeof XLSX === 'undefined') throw new Error('La web no ha podido cargar el lector de Excel. Recárgala y vuelve a pulsar.');
    if (typeof IMP === 'undefined') throw new Error('La web aún no ha cargado del todo. Vuelve a pulsar.');
    const db = await claude.use('db');
    const byK = {}; for (const c of changed || []) (byK[c.k] = byK[c.k] || []).push(c);
    let creados = 0, actualizados = 0; const nuevos = [];
    for (const [k, list] of Object.entries(byK)) {
      if (!IMP[k]) continue;
      const sn = await db.collection(k).get();
      const docs = new Map(sn.docs.map(d => [d.id, d.data()]));
      // Filas borradas en la web: están en la papelera (no se recrean). Antes se usaba el «orden» más alto,
      // pero una fila basura del final del Excel (1.048.560) hacía que se saltaran todas las filas nuevas.
      let borradas = null;
      try { borradas = new Set((await db.collection('papelera').get()).docs.map(d => d.id)); } catch (e) { borradas = null; }
      // Filas que en la web se movieron a otra pestaña (p. ej. de Recambios a Reparaciones): tampoco se recrean.
      let movidos = new Set(); try { movidos = new Set((await db.collection('movidos').get()).docs.map(d => d.id)); } catch (e) {}
      let maxOrden = 0; for (const [id, d] of docs) if (/^xl-/.test(id) && typeof d.orden === 'number' && d.orden < 1000000 && d.orden > maxOrden) maxOrden = d.orden;
      for (const c of list) {
        if (c.r - 1 < IMP[k].start) continue;
        const raw = (c.vals || []).map(v => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : (v === '' ? null : v)));
        let body; try { body = IMP[k].map(raw); } catch (e) { continue; }
        if (!Object.values(body).some(v => v != null && /[0-9A-Za-zÀ-ÿ]/.test(String(v)))) continue; // fila sin datos reales (p. ej. solo «/»)
        const id = `xl-${k}-${String(c.r).padStart(5, '0')}`;
        const cur = docs.get(id);
        if (!cur) {
          if (movidos.has(k + '__' + id)) continue; // movida a otra pestaña desde la web
          if (borradas ? borradas.has(k + '__' + id) : c.r <= maxOrden) continue; // fila que se borró en la web: no se recrea
          // Si el pedido ya existe en la web con la misma OT (p. ej. creado desde Fixner), no se duplica.
          const otX = String(body.ot || body.reparacion || '').trim();
          if (otX && [...docs.values()].some(d => d.ot === otX || d.reparacion === otX || (otNorm(otX) && d.origen === 'fixner' && otCodes(d).has(otNorm(otX))))) continue;
          if (c.g && GREEN_FIELD[k] && !body[GREEN_FIELD[k]]) body[GREEN_FIELD[k]] = 'LLEGADO';
          await db.collection(k).doc(id).set({ ...body, orden: c.r, creadoEn: Date.now(), importado: true, origen: 'excel' });
          creados++; nuevos.push(`${k} fila ${c.r}: ${body.descripcion || body.trabajo || body.maquina || ''}`);
          continue;
        }
        const upd = {};
        for (const [f, v] of Object.entries(body)) if ((cur[f] === '' || cur[f] == null) && v !== '' && v != null) upd[f] = v;
        if (c.g && GREEN_FIELD[k] && !cur[GREEN_FIELD[k]] && !upd[GREEN_FIELD[k]]) upd[GREEN_FIELD[k]] = 'LLEGADO';
        if (Object.keys(upd).length) { await db.collection(k).doc(id).update(upd); actualizados++; }
      }
    }
    return { creados, actualizados, nuevos };
  }


  /* «Subir el Excel»: para quien no puede usar el botón de la barra de marcadores (sin permiso en SharePoint,
     Excel de escritorio, otro navegador…). Lee el .xlsx descargado igual que el botón y lo pasa por doExcel. */
  async function xlsxChanges(ab) {
      const buf = new Uint8Array(ab); const dv = new DataView(buf.buffer);
      let e = buf.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
      const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const files = {};
      for (let i = 0; i < n; i++) { const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true); files[new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl))] = { m, cs, lo }; p += 46 + nl + xl + cl; }
      const read = async name => { const f = files[name]; if (!f) return null; const ds = f.lo + 30 + dv.getUint16(f.lo + 26, true) + dv.getUint16(f.lo + 28, true); const raw = buf.subarray(ds, ds + f.cs); if (f.m === 0) return new TextDecoder().decode(raw); return await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); };
      const X = s => new DOMParser().parseFromString(s, 'application/xml'); const kids = (el, tag) => [...el.getElementsByTagName(tag)];
      const sst = []; { const s = await read('xl/sharedStrings.xml'); if (s) kids(X(s), 'si').forEach(si => sst.push(kids(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join(''))); }
      const fills = [], xfFill = []; { const d = X(await read('xl/styles.xml')); kids(kids(d, 'fills')[0], 'fill').forEach(f => { const pf = kids(f, 'patternFill')[0]; const fg = pf && kids(pf, 'fgColor')[0]; fills.push(pf && pf.getAttribute('patternType') === 'solid' && fg && fg.getAttribute('rgb') ? fg.getAttribute('rgb').toUpperCase() : ''); }); kids(kids(d, 'cellXfs')[0], 'xf').forEach(x => xfFill.push(fills[+(x.getAttribute('fillId') || 0)] || '')); }
      const wb = X(await read('xl/workbook.xml')), rels = X(await read('xl/_rels/workbook.xml.rels'));
      const tgt = {}; kids(rels, 'Relationship').forEach(r => tgt[r.getAttribute('Id')] = r.getAttribute('Target'));
      const h32 = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
      const colIdx = ref => { let c = 0; for (const ch of ref) { if (ch >= 'A' && ch <= 'Z') c = c * 26 + ch.charCodeAt(0) - 64; else break; } return c - 1; };
      const SHEETS = { recambios: /^recamb/i, reparaciones: /^repar/i, rodillos: /^rodill/i, asistencias: /^as+ist/i };
      const GREEN = new Set(['FF92D050', 'FF00B050']); const LS = 'claude_recambios_xlsync_v1';
      const base = null;
      const changed = [], hashes = {};
      for (const sh of kids(wb, 'sheet')) {
        const k = Object.keys(SHEETS).find(k => SHEETS[k].test(sh.getAttribute('name').trim())); if (!k) continue;
        let t = tgt[sh.getAttribute('r:id')] || tgt[sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')]; t = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
        const d = X(await read(t)); hashes[k] = {};
        for (const row of kids(d, 'row')) {
          const r = +row.getAttribute('r'); const vals = new Array(17).fill(''), fl = new Array(17).fill(''); let any = false;
          for (const c of kids(row, 'c')) { const ci = colIdx(c.getAttribute('r') || ''); if (ci < 0 || ci >= 17) continue; fl[ci] = xfFill[+(c.getAttribute('s') || 0)] || ''; const ty = c.getAttribute('t'); const v = kids(c, 'v')[0]; let val = ''; if (ty === 's') val = v ? (sst[+v.textContent] || '') : ''; else if (ty === 'inlineStr') val = kids(c, 't').map(x => x.textContent).join(''); else val = v ? v.textContent : ''; if (val.trim() !== '') any = true; vals[ci] = val; }
          if (!any || r > 1000000) continue;
          const g = fl.slice(0, 6).every(f => GREEN.has(f)) ? 1 : 0; const h = h32(vals.join('\u0001') + '|' + g); hashes[k][r] = h;
          if (!base || !base[k] || base[k][r] !== h) changed.push({ k, r, g, vals });
        }
      }
    return changed;
  }
  window.RG_EXCEL_UPLOAD = async file => {
    const ab = await file.arrayBuffer();
    if (new Uint8Array(ab, 0, 2)[0] !== 0x50) throw new Error('El archivo no es un Excel .xlsx.');
    const changed = await xlsxChanges(ab);
    if (!changed.length) throw new Error('No encuentro las hojas Recambios / Reparaciones / Rodillos en ese Excel.');
    return await doExcel(changed);
  };
  window.addEventListener('message', async ev => {
    if (!okOrigin(ev.origin)) return;
    const m = ev.data || {};
    if (m.type === 'rg-ping') { await claude.use('db'); try { ev.source.postMessage({ type: 'rg-ready' }, ev.origin); } catch (e) {} return; }
    if (m.type !== 'rg-fixner' && m.type !== 'rg-excel') return;
    const kind = m.type === 'rg-fixner' ? 'fixner' : 'excel';
    let out;
    try { out = { ok: true, ...(kind === 'fixner' ? await doFixner(m.rows) : await doExcel(m.changed)) }; }
    catch (e) { out = { ok: false, error: e.message || String(e) }; }
    try { ev.source.postMessage({ type: 'rg-done', kind, ...out }, ev.origin); } catch (e) {}
  });

  // Si esta ventana la abrió el botón de sincronizar, avisa cuando la sesión está lista
  if (window.opener) {
    claude.use('db').then(() => {
      try { window.opener.postMessage({ type: 'rg-ready' }, '*'); } catch (e) {}
    });
  }
})();
