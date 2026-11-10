/*
 * Recepción de la sincronización manual (botón "↻ Recambios" de la barra de marcadores).
 * El botón se pulsa estando en Fixner (listado de OT) o en el Excel de SharePoint: lee los datos allí,
 * abre esta web y se los envía con postMessage. Aquí se crean los pedidos nuevos y se rellenan huecos,
 * sin pisar nunca lo que ya se haya editado en la web.
 */
(function () {
  'use strict';
  const ALLOWED = ['https://app3.fixner.com', 'https://garciadepou0-my.sharepoint.com'];
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
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
      const ya = rec.some(r => r.ot === code || r.reparacion === code);
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
      let maxOrden = 0; for (const [id, d] of docs) if (/^xl-/.test(id) && typeof d.orden === 'number' && d.orden > maxOrden) maxOrden = d.orden;
      for (const c of list) {
        if (c.r - 1 < IMP[k].start) continue;
        const raw = (c.vals || []).map(v => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : (v === '' ? null : v)));
        let body; try { body = IMP[k].map(raw); } catch (e) { continue; }
        if (!Object.values(body).some(v => v !== '' && v != null)) continue;
        const id = `xl-${k}-${String(c.r).padStart(5, '0')}`;
        const cur = docs.get(id);
        if (!cur) {
          if (c.r <= maxOrden) continue; // fila que se borró en la web: no se recrea
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

  window.addEventListener('message', async ev => {
    if (!ALLOWED.includes(ev.origin)) return;
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
      for (const o of ALLOWED) { try { window.opener.postMessage({ type: 'rg-ready' }, o); } catch (e) {} }
    });
  }
})();
