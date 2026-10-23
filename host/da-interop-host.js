/* ============================================================
 * DA Interop v1 — Dusk Atelier(호스트) 쪽 모듈
 * Dusk Atelier 번들에 넣어 쓰는 로직 계층. UI 프레임워크에 묶이지 않는다.
 *
 *   const host = createDAInteropHost({ risuai, selfName: 'dusk_atelier' });
 *   const env = await host.detectEnv();       // plugins 쓰기 가능 여부
 *   const list = await host.listRegistry();   // B 플러그인 목록
 *   host.renderForm(el, entry, { onApply });  // 자동 폼
 *
 * 규칙: 공식 API만 사용. plugins 쓰기는 detectEnv()가 writable일 때만.
 * ============================================================ */
function createDAInteropHost({ risuai, selfName, storagePrefix = 'da_' } = {}) {
  const R = risuai ?? globalThis.risuai ?? globalThis.Risuai;
  const REG = 'da_interop_registry';
  const PATCH = 'da_interop_patch';
  const K = {
    backups: storagePrefix + 'plugin_backups',
    categories: storagePrefix + 'plugin_categories',
  };
  const MAX_BACKUPS = 5;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (v) => JSON.parse(JSON.stringify(v ?? null));

  let env = null;

  /* ---------- 저장소 ---------- */
  const store = {
    async get(key, fallback) {
      try {
        const raw = await R.pluginStorage.getItem(key);
        return raw == null ? fallback : typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch { return fallback; }
    },
    set: (key, value) => R.pluginStorage.setItem(key, JSON.stringify(value)),
  };

  async function readDB() { return (await R.getDatabase(['plugins', 'etcData'])) ?? {}; }
  async function readEtc() { const db = await readDB(); return db.etcData ?? {}; }
  async function writeEtcEntry(bucket, id, value) {
    for (let i = 0; i < 4; i++) {
      const db = await readDB();
      const etc = { ...(db.etcData ?? {}) };
      const b = { ...(etc[bucket] ?? {}) };
      if (value === undefined) delete b[id]; else b[id] = value;
      etc[bucket] = b;
      await R.setDatabaseLite({ etcData: etc });
      await sleep(120);
      const now = (await readEtc())[bucket]?.[id];
      if (value === undefined ? now === undefined : now?.rev === value.rev && now?.updatedAt === value.updatedAt) return true;
    }
    return false;
  }

  /* ---------- 환경 감지 ---------- */
  async function detectEnv() {
    const result = { apiOk: !!(R?.getDatabase && R?.setDatabaseLite), pluginsReadable: false, pluginsWritable: false, reason: '' };
    if (!result.apiOk) return (env = { ...result, reason: 'no-api' });
    const db = await readDB();
    if (!Array.isArray(db.plugins)) return (env = { ...result, reason: 'plugins-hidden' });
    result.pluginsReadable = true;
    const me = db.plugins.find((p) => p.name === selfName);
    if (!me) return (env = { ...result, reason: 'self-not-found' });

    const orig = me.versionOfPlugin;
    const probe = `${orig ?? ''}+daprobe${Date.now().toString(36)}`;
    const withVer = (list, v) => list.map((p) => {
      if (p.name !== selfName) return p;
      const q = { ...p };
      if (v === undefined) delete q.versionOfPlugin; else q.versionOfPlugin = v;
      return q;
    });
    try {
      await R.setDatabaseLite({ plugins: withVer(db.plugins, probe) });
      const after = await readDB();
      const ok = after.plugins?.find((p) => p.name === selfName)?.versionOfPlugin === probe;
      if (ok) await R.setDatabaseLite({ plugins: withVer(after.plugins, orig) });
      result.pluginsWritable = ok;
      result.reason = ok ? 'ok' : 'blocked';
    } catch (e) {
      result.reason = 'blocked:' + (e?.message ?? e);
    }
    return (env = result);
  }
  const canWritePlugins = () => !!env?.pluginsWritable;
  function requireWritable() {
    if (!canWritePlugins()) throw new Error('이 환경에서는 플러그인 목록을 바꿀 수 없습니다');
  }

  /* ---------- 인터롭 레지스트리 ---------- */
  async function listRegistry() {
    const etc = await readEtc();
    const reg = etc[REG] ?? {};
    const patches = etc[PATCH] ?? {};
    const db = env?.pluginsReadable ? await readDB() : null;
    const installed = db ? new Set(db.plugins.map((p) => p.name)) : null;
    return Object.values(reg)
      .filter((e) => e && e.spec === 1 && e.id)
      .map((e) => {
        const p = patches[e.id];
        return {
          ...e,
          pendingRev: p && p.rev > (e.appliedRev ?? 0) ? p.rev : 0,
          installed: installed && e.pluginName ? installed.has(e.pluginName) : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function sendPatch(id, values, { preset = null } = {}) {
    const prev = (await readEtc())[PATCH]?.[id];
    const reg = (await readEtc())[REG]?.[id];
    const rev = Math.max(prev?.rev ?? 0, reg?.appliedRev ?? 0) + 1;
    const ok = await writeEtcEntry(PATCH, id, { rev, values: clone(values), preset, updatedAt: Date.now() });
    if (!ok) throw new Error('패치 저장 실패');
    return rev;
  }

  async function applyPreset(entry, presetName) {
    const preset = entry.presets?.find((p) => p.name === presetName);
    if (!preset) throw new Error('프리셋 없음: ' + presetName);
    return sendPatch(entry.id, { ...entry.values, ...preset.values }, { preset: presetName });
  }

  /** B가 적용했는지 기다린다. {ok, error} */
  async function waitAck(id, rev, timeoutMs = 10000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const e = (await readEtc())[REG]?.[id];
      if ((e?.appliedRev ?? 0) >= rev) return { ok: !e.lastError, error: e.lastError ?? null, entry: e };
      await sleep(700);
    }
    return { ok: false, error: 'timeout' };
  }

  /** 지워진 플러그인의 레지스트리·패치 정리 */
  async function pruneEntry(id) {
    await writeEtcEntry(REG, id, undefined);
    await writeEtcEntry(PATCH, id, undefined);
  }

  /* ---------- 자동 폼 ---------- */
  function renderForm(container, entry, { onApply, onPreset } = {}) {
    const doc = container.ownerDocument;
    const h = (tag, attrs = {}, ...kids) => {
      const el = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
      }
      kids.flat().forEach((c) => c != null && el.append(c));
      return el;
    };
    container.replaceChildren();
    const values = clone(entry.values ?? {});
    const inputs = {};

    if (entry.presets?.length) {
      const sel = h('select', { class: 'dai-preset' }, h('option', { value: '' }, '프리셋 선택…'),
        entry.presets.map((p) => h('option', { value: p.name }, p.name)));
      sel.addEventListener('change', () => { if (sel.value) onPreset?.(sel.value); });
      container.append(h('div', { class: 'dai-row dai-presets' }, h('label', {}, '프리셋'), sel));
    }

    const groups = new Map();
    for (const f of entry.fields ?? []) {
      const g = f.group ?? '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(f);
    }
    for (const [g, fields] of groups) {
      const box = g ? h('fieldset', { class: 'dai-group' }, h('legend', {}, g)) : container;
      for (const f of fields) {
        const v = values[f.key] ?? f.default;
        let input;
        switch (f.type) {
          case 'toggle': input = h('input', { type: 'checkbox', checked: !!v }); break;
          case 'number':
          case 'slider': input = h('input', { type: f.type === 'slider' ? 'range' : 'number', value: v ?? 0, min: f.min, max: f.max, step: f.step ?? 'any' }); break;
          case 'select': input = h('select', {}, (f.options ?? []).map((o) => {
            const ov = typeof o === 'object' ? o.value : o;
            return h('option', { value: ov, selected: String(ov) === String(v) }, typeof o === 'object' ? (o.label ?? o.value) : o);
          })); break;
          case 'textarea': input = h('textarea', { rows: 4 }); input.value = v ?? ''; break;
          case 'color': input = h('input', { type: 'color', value: v ?? '#000000' }); break;
          default: input = h('input', { type: 'text', value: v ?? '' });
        }
        inputs[f.key] = { f, input };
        box.append(h('div', { class: 'dai-row' },
          h('label', { title: f.description ?? '' }, f.label ?? f.key), input,
          f.description ? h('small', { class: 'dai-desc' }, f.description) : null));
      }
      if (box !== container) container.append(box);
    }

    const read = () => {
      const out = { ...values };
      for (const [k, { f, input }] of Object.entries(inputs)) {
        if (f.type === 'toggle') out[k] = input.checked;
        else if (f.type === 'number' || f.type === 'slider') out[k] = input.value === '' ? null : Number(input.value);
        else if (f.type === 'select') {
          const opt = (f.options ?? []).map((o) => (typeof o === 'object' ? o.value : o)).find((ov) => String(ov) === input.value);
          out[k] = opt ?? input.value;
        } else out[k] = input.value;
      }
      return out;
    };
    container.append(h('div', { class: 'dai-actions' }, h('button', { type: 'button', onclick: () => onApply?.(read()) }, '적용')));
    if (entry.lastError) container.append(h('p', { class: 'dai-error' }, '마지막 적용 오류: ' + entry.lastError));
    return { read };
  }

  /* ---------- plugins 조작 (지원 포크 전용) ---------- */
  async function backupPlugins(label) {
    const db = await readDB();
    const list = await store.get(K.backups, []);
    list.unshift({ id: Date.now().toString(36), label, at: Date.now(), plugins: clone(db.plugins ?? []) });
    await store.set(K.backups, list.slice(0, MAX_BACKUPS));
  }
  async function writePlugins(next, label) {
    requireWritable();
    await backupPlugins(label);
    await R.setDatabaseLite({ plugins: next });
  }

  async function listPlugins() {
    const db = await readDB();
    const cats = await store.get(K.categories, {});
    return (db.plugins ?? []).map((p, i) => ({ ...p, enabled: p.enabled !== false, order: i, category: cats[p.name] ?? '' }));
  }

  // 켜기/끄기 = 플러그인 항목의 enabled 필드
  async function setEnabled(name, on) {
    if (name === selfName && !on) throw new Error('Dusk Atelier 자신은 끌 수 없습니다');
    const db = await readDB();
    await writePlugins(db.plugins.map((p) => (p.name === name ? { ...p, enabled: on } : p)), `${on ? '켜기' : '끄기'}: ${name}`);
  }

  async function reorder(names) {
    const db = await readDB();
    const pos = new Map(names.map((n, i) => [n, i]));
    const next = [...db.plugins].sort((a, b) => (pos.get(a.name) ?? 1e9) - (pos.get(b.name) ?? 1e9));
    await writePlugins(next, '순서 변경');
  }

  async function replaceCode(name, script, meta = {}) {
    const db = await readDB();
    if (!db.plugins.some((p) => p.name === name)) throw new Error('플러그인 없음: ' + name);
    await writePlugins(db.plugins.map((p) => (p.name === name ? { ...p, ...meta, script } : p)), `코드 교체: ${name}`);
  }

  async function listBackups() {
    return (await store.get(K.backups, [])).map(({ plugins, ...b }) => ({ ...b, count: plugins.length }));
  }
  async function restoreBackup(id) {
    const b = (await store.get(K.backups, [])).find((x) => x.id === id);
    if (!b) throw new Error('백업 없음');
    await writePlugins(b.plugins, `복원 전 자동 백업`);
  }

  /** 같은 name이 여러 개면 뒤쪽(나중에 추가된) 것만 남긴다 */
  async function findDuplicates() {
    const db = await readDB();
    const seen = new Map();
    db.plugins.forEach((p, i) => seen.set(p.name, [...(seen.get(p.name) ?? []), i]));
    return [...seen].filter(([, idx]) => idx.length > 1).map(([name, idx]) => ({ name, count: idx.length }));
  }
  async function dedupe() {
    const db = await readDB();
    const last = new Map(db.plugins.map((p, i) => [p.name, i]));
    const next = db.plugins.filter((p, i) => last.get(p.name) === i);
    if (next.length !== db.plugins.length) await writePlugins(next, '중복 제거');
    return db.plugins.length - next.length;
  }

  /* ---------- 자체 기능 (B 협조 불필요) ---------- */
  async function setCategory(name, category) {
    const cats = await store.get(K.categories, {});
    if (category) cats[name] = category; else delete cats[name];
    await store.set(K.categories, cats);
  }
  async function groupByCategory() {
    const out = {};
    for (const p of await listPlugins()) (out[p.category || '미분류'] ??= []).push(p);
    return out;
  }

  async function storageDump() {
    const ps = R.pluginStorage;
    let keys = [];
    if (typeof ps.keys === 'function') keys = await ps.keys();
    else if (typeof ps.length === 'number' && typeof ps.key === 'function') {
      for (let i = 0; i < ps.length; i++) keys.push(await ps.key(i));
    }
    const out = {};
    for (const k of keys) out[k] = await ps.getItem(k);
    return out;
  }
  const storageRemove = (key) => R.pluginStorage.removeItem(key);

  /** GitHub 최신 릴리스와 비교 */
  async function checkUpdate(current, repo = 'Pyser08/Dusk-Atelier') {
    const f = R.nativeFetch ?? globalThis.fetch;
    const res = await f(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    const data = typeof res.json === 'function' ? await res.json() : res.data ?? res;
    const latest = String(data.tag_name ?? '').replace(/^v/, '');
    const cmp = (a, b) => {
      const x = a.split('.').map(Number), y = b.split('.').map(Number);
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    };
    return { current, latest, hasUpdate: !!latest && cmp(latest, String(current).replace(/^v/, '')) > 0, url: data.html_url };
  }

  /** plugins(+보관된 꺼진 플러그인)·인터롭 데이터·카테고리를 JSON 문자열로 */
  async function exportBackup() {
    const db = await readDB();
    const etc = db.etcData ?? {};
    return JSON.stringify({
      format: 'dusk-atelier-backup', v: 1, at: new Date().toISOString(),
      plugins: db.plugins ?? null,
      categories: await store.get(K.categories, {}),
      interop: { registry: etc[REG] ?? {}, patch: etc[PATCH] ?? {} },
    }, null, 2);
  }
  function downloadText(filename, text, doc = globalThis.document) {
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = filename;
    doc.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  return {
    detectEnv, canWritePlugins, get env() { return env; },
    listRegistry, sendPatch, applyPreset, waitAck, pruneEntry, renderForm,
    listPlugins, setEnabled, reorder, replaceCode, listBackups, restoreBackup, findDuplicates, dedupe,
    setCategory, groupByCategory, storageDump, storageRemove, checkUpdate, exportBackup, downloadText,
  };
}

if (typeof module !== 'undefined') module.exports = { createDAInteropHost };
