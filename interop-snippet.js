/* ============================================================
 * DA Interop v1 — B 플러그인용 스니펫
 * https://github.com/Pyser08/dusk-atelier-interop
 *
 * 이 블록을 플러그인 코드 맨 아래에 붙여 넣으세요.
 * 공식 플러그인 API(getDatabase / setDatabaseLite)만 사용합니다.
 * plugins 필드는 건드리지 않습니다.
 *
 * 저장 위치
 *   etcData.da_interop_registry[<id>]  ← 이 플러그인이 등록 (스키마·현재값)
 *   etcData.da_interop_patch[<id>]     ← Dusk Atelier가 기록 (적용할 값)
 * ============================================================ */
const registerInterop = (() => {
  const SPEC = 1;
  const REG = 'da_interop_registry';
  const PATCH = 'da_interop_patch';
  const POLL_MS = 3000;
  const R = globalThis.risuai ?? globalThis.Risuai;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (v) => JSON.parse(JSON.stringify(v ?? null));

  async function readEtc() {
    const db = await R.getDatabase();
    return db?.etcData && typeof db.etcData === 'object' ? db.etcData : {};
  }

  // etcData 안의 bucket[id]만 바꾼다. 다른 플러그인 항목과 동시에 쓰여도
  // 지워지지 않도록 다시 읽어 확인하고, 사라졌으면 재시도한다.
  async function writeEntry(bucket, id, value) {
    for (let i = 0; i < 4; i++) {
      const db = await R.getDatabase();
      const etc = { ...(db?.etcData ?? {}) };
      etc[bucket] = { ...(etc[bucket] ?? {}), [id]: value };
      await R.setDatabaseLite({ etcData: etc });
      await sleep(150 + Math.random() * 250);
      const after = (await readEtc())[bucket]?.[id];
      if (after && after.updatedAt === value.updatedAt) return true;
    }
    return false;
  }

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
    if (!R?.getDatabase || !R?.setDatabaseLite) {
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
      const prev = (await readEtc())[REG]?.[cfg.id];
      if (prev?.appliedRev) appliedRev = Math.max(appliedRev, prev.appliedRev);
      return writeEntry(REG, cfg.id, {
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
        const patch = (await readEtc())[PATCH]?.[cfg.id];
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

/*__DA_INTEROP_REGISTER__*/
