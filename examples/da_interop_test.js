//@name da_interop_test
//@display-name DA Interop 테스트
//@api 3.0
//@version 1.0.0

/* ============================================================
 * DA Interop v1 — B 플러그인용 스니펫
 * https://github.com/Pyser08/dusk-atelier-interop
 *
 * 이 블록을 플러그인 코드 맨 아래에 붙여 넣으세요.
 * 공식 플러그인 API(pluginStorage)만 사용합니다.
 *
 * 저장 위치 (pluginStorage, 모든 플러그인 공용)
 *   da_interop:reg:<id>    ← 이 플러그인이 등록 (스키마·현재값)
 *   da_interop:patch:<id>  ← Dusk Atelier가 기록 (적용할 값)
 * ============================================================ */
const registerInterop = (() => {
  const SPEC = 1;
  const REG = 'da_interop:reg:';
  const PATCH = 'da_interop:patch:';
  const POLL_MS = 3000;
  const R = globalThis.risuai ?? globalThis.Risuai;

  const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
  // pluginStorage는 모든 플러그인이 함께 쓰는 저장소라 키 하나에 자기 항목만 둔다
  async function readKey(key) {
    try {
      const raw = await R.pluginStorage.getItem(key);
      return raw == null || raw === '' ? null : typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch { return null; }
  }
  const writeKey = (key, value) => R.pluginStorage.setItem(key, JSON.stringify(value));

  function normalize(cfg) {
    if (!cfg || typeof cfg !== 'object') throw new Error('[DA Interop] 설정 객체가 필요합니다');
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(cfg.id ?? '')) throw new Error('[DA Interop] id 형식 오류: ' + cfg.id);
    if (typeof cfg.apply !== 'function') throw new Error('[DA Interop] apply 함수가 필요합니다');
    return {
      id: cfg.id,
      name: cfg.name ?? cfg.id,
      version: String(cfg.version ?? ''),
      pluginName: cfg.pluginName ?? '',
      description: cfg.description ?? '',
      fields: Array.isArray(cfg.fields) ? cfg.fields : [],
      presets: Array.isArray(cfg.presets) ? cfg.presets : [],
      apply: cfg.apply,
      getValues: typeof cfg.getValues === 'function' ? cfg.getValues : null,
    };
  }

  return async function registerInterop(rawCfg) {
    if (!R?.pluginStorage?.getItem) {
      console.warn('[DA Interop] 플러그인 API를 찾지 못해 등록을 건너뜁니다');
      return null;
    }
    const cfg = normalize(rawCfg);
    let appliedRev = 0;
    let busy = false;

    const currentValues = async () => {
      if (cfg.getValues) {
        try { return clone(await cfg.getValues()); } catch (e) { console.warn('[DA Interop] getValues 실패', e); }
      }
      return Object.fromEntries(cfg.fields.map((f) => [f.key, f.default ?? null]));
    };

    const publish = async (extra = {}) => {
      const prev = await readKey(REG + cfg.id);
      if (prev?.appliedRev) appliedRev = Math.max(appliedRev, prev.appliedRev);
      return writeKey(REG + cfg.id, {
        spec: SPEC,
        id: cfg.id,
        name: cfg.name,
        version: cfg.version,
        pluginName: cfg.pluginName,
        description: cfg.description,
        fields: clone(cfg.fields),
        presets: clone(cfg.presets),
        values: await currentValues(),
        appliedRev,
        lastError: null,
        ...extra,
        updatedAt: Date.now(),
      });
    };

    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const patch = await readKey(PATCH + cfg.id);
        if (!patch || !(patch.rev > appliedRev)) return;
        let lastError = null;
        try {
          await cfg.apply(clone(patch.values ?? {}), { preset: patch.preset ?? null, rev: patch.rev, source: 'dusk-atelier' });
        } catch (e) {
          lastError = String(e?.message ?? e);
          console.warn('[DA Interop] apply 실패', e);
        }
        appliedRev = patch.rev;
        await publish({ lastError });
      } finally {
        busy = false;
      }
    };

    await publish();
    await check();
    setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') check().catch(() => {});
    }, POLL_MS);

    return {
      /** 값이 플러그인 쪽에서 바뀌었을 때 호출하면 Dusk Atelier 화면도 갱신된다 */
      refresh: () => publish(),
    };
  };
})();

// ── 테스트 플러그인 본체 ──
const KEY = 'da_interop_test:settings';
const DEFAULTS = { enabled: true, temperature: 0.7, mode: 'normal', prefix: '', accent: '#7c6cf0', memo: '' };
async function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse((await R_.pluginStorage.getItem(KEY)) || '{}') }; } catch { return { ...DEFAULTS }; }
}
async function saveSettings(v) { await R_.pluginStorage.setItem(KEY, JSON.stringify(v)); }
const R_ = globalThis.risuai ?? globalThis.Risuai;
const log = [];

const handle = registerInterop({
  id: 'da-interop-test',
  name: 'DA Interop 테스트',
  version: '1.0.0',
  pluginName: 'da_interop_test',
  description: 'Dusk Atelier 연동 확인용 플러그인. 값을 바꾸면 이 플러그인 설정 창에서 확인할 수 있어요.',
  fields: [
    { key: 'enabled', label: '사용', type: 'toggle', default: true },
    { key: 'temperature', label: '온도', type: 'slider', default: 0.7, min: 0, max: 2, step: 0.1, group: '생성' },
    { key: 'mode', label: '모드', type: 'select', default: 'normal', group: '생성', options: [{ value: 'normal', label: '보통' }, { value: 'calm', label: '차분' }, { value: 'wild', label: '과감' }] },
    { key: 'prefix', label: '앞에 붙일 말', type: 'text', default: '', description: '빈칸이면 안 붙여요' },
    { key: 'accent', label: '강조 색', type: 'color', default: '#7c6cf0' },
    { key: 'memo', label: '메모', type: 'textarea', default: '' },
  ],
  presets: [
    { name: '차분하게', values: { temperature: 0.3, mode: 'calm' } },
    { name: '과감하게', values: { temperature: 1.4, mode: 'wild' } },
  ],
  getValues: loadSettings,
  apply: async (values, ctx) => {
    const next = { ...DEFAULTS, ...values };
    await saveSettings(next);
    log.unshift(`${new Date().toLocaleTimeString()} rev ${ctx.rev}${ctx.preset ? ` (프리셋 ${ctx.preset})` : ''}`);
    console.log('[DA Interop 테스트] 적용', ctx, next);
    render();
  },
});

// 설정 창: 지금 저장된 값과 적용 기록을 보여 준다
let box = null;
async function render() {
  if (!box) return;
  const v = await loadSettings();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  box.innerHTML = `<div style="max-width:520px;margin:40px auto;padding:20px;border-radius:14px;background:#1b1930;color:#ecebf6;font:14px system-ui,sans-serif;border:1px solid #3b3659">
    <h2 style="margin:0 0 12px;font-size:18px">DA Interop 테스트</h2>
    <pre style="background:#0f0d1d;padding:12px;border-radius:10px;white-space:pre-wrap;border-left:4px solid ${esc(v.accent)}">${esc(JSON.stringify(v, null, 2))}</pre>
    <p style="color:#9d99c1;margin:12px 0 6px">적용 기록</p>
    <div style="font-size:12px;color:#9d99c1">${log.length ? log.map(esc).join('<br>') : '아직 없음'}</div>
    <div style="margin-top:16px;display:flex;gap:8px">
      <button id="dit-reset" style="padding:8px 14px;border-radius:9px;border:1px solid #3b3659;background:#2c2942;color:#fff">기본값으로</button>
      <button id="dit-close" style="padding:8px 14px;border-radius:9px;border:0;background:#5b48d6;color:#fff">닫기</button>
    </div></div>`;
  box.querySelector('#dit-close').onclick = () => { box.remove(); box = null; R_.hideContainer(); };
  box.querySelector('#dit-reset').onclick = async () => { await saveSettings({ ...DEFAULTS }); (await handle)?.refresh(); render(); };
}
R_?.registerSetting?.('DA Interop 테스트', async () => {
  box?.remove();
  box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);overflow:auto';
  document.body.append(box);
  await R_.showContainer('fullscreen');
  render();
}, '🧪', 'html');


