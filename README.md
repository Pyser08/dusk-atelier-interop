# DA Interop v1

RisuAI 플러그인 **Dusk Atelier**가 다른 플러그인의 설정값·프리셋을 조절할 수 있게 하는 연동 규격입니다.

- 생성기:GitHub Pages (`https://pyser08.github.io/dusk-atelier-interop/`)
- 공식 플러그인 API(`getDatabase`, `setDatabaseLite`, `pluginStorage`)만 사용합니다. 샌드박스 우회는 하지 않습니다.

## 왜 필요한가

RisuAI PR #1572 이후 `setDatabaseLite`로 `plugins` 필드를 쓸 수 없습니다. 그래서 한 플러그인이 다른 플러그인의 등록·코드·순서·켜기/끄기를 직접 바꾸지 못합니다.
DA Interop은 이 제한 안에서 동작합니다. 각 플러그인이 스스로 설정 항목을 등록하고, Dusk Atelier가 남긴 값을 스스로 읽어 적용합니다.

## 플러그인 개발자용

1. 생성기에서 id, 설정 항목, 프리셋을 입력하고 **코드 만들기 → 복사**.
2. 플러그인 코드 맨 아래에 붙입니다.
3. `getValues`에 현재 값을, `apply`에 값을 반영·저장하는 코드를 채웁니다.

```js
registerInterop({
  id: 'my-plugin',
  name: 'My Plugin',
  fields: [{ key: 'temperature', label: '온도', type: 'slider', default: 0.7, min: 0, max: 2, step: 0.1 }],
  presets: [{ name: '차분하게', values: { temperature: 0.3 } }],
  getValues: async () => ({ temperature: settings.temperature }),
  apply: async (values, ctx) => { settings.temperature = values.temperature; await saveSettings(); },
});
```

- `apply`에서 받은 값은 **플러그인이 직접 저장**해야 합니다. 같은 패치는 한 번만 전달됩니다.
- 플러그인 쪽에서 값이 바뀌면 `registerInterop(...)`이 돌려준 객체의 `refresh()`를 부르면 Dusk Atelier 화면도 갱신됩니다.
- Dusk Atelier가 없어도 스니펫은 아무 문제 없이 동작합니다 (등록만 해 두고 기다림).

### 필드 종류

| type | 값 | 추가 속성 |
|---|---|---|
| `toggle` | boolean | |
| `number` / `slider` | number | `min`, `max`, `step` |
| `select` | string | `options: [{value, label}]` |
| `text` / `textarea` | string | |
| `color` | `#rrggbb` | |

공통: `key`, `label`, `default`, `group`, `description`.

## 데이터 형식

`etcData` 아래 두 곳을 씁니다. 각자 자기 `id` 항목만 바꾸고, 쓴 뒤 다시 읽어 확인합니다 (동시 쓰기 대비).

```
etcData.da_interop_registry[id] = {
  spec: 1, id, name, version, pluginName, description,
  fields, presets, values, appliedRev, lastError, updatedAt
}   // B 플러그인이 씀

etcData.da_interop_patch[id] = { rev, values, preset, updatedAt }
    // Dusk Atelier가 씀. B는 rev > appliedRev 이면 apply 후 appliedRev 갱신
```

B 플러그인은 3초마다(탭이 보일 때만) 패치를 확인합니다.

## Dusk Atelier 쪽 (`host/da-interop-host.js`)

| 기능 | 조건 |
|---|---|
| 레지스트리 스캔, 자동 폼, 값 적용, 프리셋 전환, 적용 확인(`waitAck`), 정리(`pruneEntry`) | 항상 |
| 카테고리 묶기, pluginStorage 보기, 업데이트 확인, 백업 내보내기 | 항상 |
| 켜기/끄기, 순서 변경, 코드 교체, 백업 복원, 중복 제거 | `detectEnv().pluginsWritable === true` 일 때만 |

`detectEnv()`는 Dusk Atelier 자신의 `versionOfPlugin`을 잠깐 바꿨다가 다시 읽어 `plugins` 쓰기가 되는지 확인하고, 원래 값으로 되돌립니다. 막힌 환경이면 위 표의 마지막 줄 기능을 비활성화하세요.
`plugins`를 바꾸는 모든 작업은 직전 상태를 `pluginStorage`에 자동 백업합니다 (최근 5개).

## 라이선스

MIT
