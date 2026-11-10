(async () => {
  const WEB = 'https://recambios-fabrica.github.io';
  const host = location.hostname;
  const isFx = /(^|\.)fixner\.com$/.test(host), isSp = /sharepoint\.com$/.test(host);
  const say = (t, err) => {
    let d = document.getElementById('rg-sync-msg');
    if (!d) { d = document.createElement('div'); d.id = 'rg-sync-msg'; d.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:380px;background:#0B66C3;color:#fff;padding:12px 16px;border-radius:10px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);white-space:pre-line;cursor:pointer'; d.onclick = () => d.remove(); document.body.appendChild(d); }
    d.style.background = err ? '#b42318' : '#0B66C3'; d.textContent = t;
  };
  if (!isFx && !isSp) { alert('Pulsa este botón estando en Fixner (listado de órdenes de trabajo) o en el Excel PEDIDO DE RECAMBIOS.'); return; }
  const win = window.open(WEB + '/#sync', 'rg-recambios');
  const wait = (type, kind, ms) => new Promise((res, rej) => {
    const f = e => { if (e.origin === WEB && e.data && e.data.type === type && (!kind || e.data.kind === kind)) { window.removeEventListener('message', f); clearTimeout(t); res(e.data); } };
    const t = setTimeout(() => { window.removeEventListener('message', f); rej(new Error('timeout')); }, ms);
    window.addEventListener('message', f);
  });
  const readyP = wait('rg-ready', null, 180000);
  const ping = setInterval(() => { try { win.postMessage({ type: 'rg-ping' }, WEB); } catch (x) {} }, 1500);
  readyP.then(() => clearInterval(ping), () => clearInterval(ping));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    if (isFx) {
      say('↻ Leyendo Fixner…');
      if (!/ordenTrabajoList/.test(location.hash)) { location.hash = '#ordenTrabajoList:'; await sleep(5000); }
      let rows = [];
      const grab = () => { rows = rows.concat([...document.querySelectorAll('tr')].filter(tr => /OT\d\d\/\d+/.test(tr.innerText)).map(tr => { const td = [...tr.querySelectorAll('td')].map(t => t.innerText.replace(/\s+/g, ' ').trim()); const code = td[1].split(' ')[0]; const a = tr.querySelector('a[href^="#ordenTrabajo:"]'); return [code, td[1].slice(code.length + 1).slice(0, 60), td[2].replace(/^\(\d+\)\s*/, ''), td[3].replace(/^\(\d\)\s*/, ''), td[4], td[5], td[6], (td[0].split(' OT')[0] || '').trim().split(' ')[0], a ? a.getAttribute('href').split(':')[1] : ''].join('|'); })).filter((l, i, arr) => arr.findIndex(x => x.split('|')[0] === l.split('|')[0]) === i); };
      for (const n of ['WEB · Bloqueadas OP y PA', 'WEB · Material almacén']) {
        const chip = [...document.querySelectorAll('a,button,span')].find(e => e.textContent.trim() === n && e.children.length === 0);
        if (!chip) throw new Error('No encuentro el filtro «' + n + '» en Fixner. Abre el listado de órdenes de trabajo y vuelve a pulsar.');
        chip.click(); await sleep(5000);
        for (let i = 0; i < 30; i++) { const m = [...document.querySelectorAll('a')].find(e => /ver más registros/i.test(e.textContent) && e.offsetParent); if (!m) break; m.click(); await sleep(3000); }
        grab();
      }
      say(`↻ ${rows.length} OT leídas. Enviando a la web…`);
      await readyP;
      win.postMessage({ type: 'rg-fixner', rows }, WEB);
      const r = await wait('rg-done', 'fixner', 120000);
      if (!r.ok) throw new Error(r.error);
      say(`✓ Fixner sincronizado (${r.leidas} OT).\n` + (r.nuevas.length ? `${r.nuevas.length} pedido(s) nuevo(s):\n· ` + r.nuevas.join('\n· ') : 'No hay OT nuevas.'));
    } else {
      say('↻ Leyendo el Excel…');
      const url = "/personal/electrico_fabrica02_garciadepou_com/_api/web/GetFileById('CD8987E5-3CF6-49B5-8285-38FFEED9F8BD')/$value";
      const resp = await fetch(url, { cache: 'no-store', credentials: 'include' });
      if (!resp.ok) throw new Error('No puedo abrir el Excel (' + resp.status + ').');
      const buf = new Uint8Array(await resp.arrayBuffer()); const dv = new DataView(buf.buffer);
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
      let base = null; try { base = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (x) {}
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
      say(`↻ Excel leído: ${changed.length} fila(s) con cambios. Enviando a la web…`);
      await readyP;
      win.postMessage({ type: 'rg-excel', changed }, WEB);
      const r = await wait('rg-done', 'excel', 300000);
      if (!r.ok) throw new Error(r.error);
      localStorage.setItem(LS, JSON.stringify(hashes));
      say(`✓ Excel sincronizado.\n${r.creados} fila(s) nueva(s), ${r.actualizados} completada(s).` + (r.nuevos.length ? '\n· ' + r.nuevos.slice(0, 8).join('\n· ') : ''));
    }
  } catch (x) {
    say(x.message === 'timeout' ? 'No he podido conectar con la web. Comprueba que has iniciado sesión en la web de recambios (se abre en otra pestaña) y vuelve a pulsar.' : '✗ ' + (x.message || x), true);
  }
})();
