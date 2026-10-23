# DA Interop v1

RisuAI 플러그인 **Dusk Atelier**가 다른 플러그인의 설정값·프리셋을 조절할 수 있게 하는 연동 규격입니다.

- 생성기:GitHub Pages (`https://pyser08.github.io/dusk-atelier-interop/`)
- 공식 플러그인 API(`pluginStorage` 등)만 사용합니다. 샌드박스 우회는 하지 않습니다.

## 왜 필요한가

RisuAI PR #1572 이후 `setDatabaseLite`로 `plugins` 필드를 쓸 수 없습니다. 그래서 한 플러그인이 다른 플러그인의 등록·코드·순서·켜기/끄기를 직접 바꾸지 못합니다.
DA Interop은 이 제한 안에서 동작합니다. 각 플러그인이 스스로 설정 항목을 등록하고, Dusk Atelier가 남긴 값을 스스로 읽어 적용합니다.

## 플러그인 개발자용

1. 생성기에서 id, 설정 항목, 프리셋을 입력하고 **코드 만들기 → 복사**.
2. 플러그인 코드에 붙입니다. `registerInterop({...})` 부분은 스니펫보다 아래에 있어야 합니다.
   Dusk Atelier의 플러그인 → 만들기 화면에서 스니펫과 등록 코드가 들어간 새 플러그인을 바로 만들 수도 있습니다.
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
| `multiselect` | 값 배열 | `options: [{value, label}]` |
| `list` | 배열 | `itemFields: [필드…]`(객체 목록) 또는 `item: {type, …}`(값 목록), `itemLabel`, `addable`, `removable`, `sortable`, `max` |
| `json` | 아무 JSON | `rows` |

공통: `key`, `label`, `default`, `group`, `description`, `readonly`(보여 주기만 하고 보내지 않음).

`multiselect`·`list`·`json`은 Dusk Atelier 1.4.4 이상에서 표시됩니다. `list` 항목의 화면에 없는 속성(id 등)은 그대로 돌려받습니다.

```js
{ key: 'models', label: '모델', type: 'list', itemLabel: 'name',
  itemFields: [
    { key: 'name', label: '이름', type: 'text' },
    { key: 'enabled', label: '사용', type: 'toggle', default: true },
    { key: 'tags', label: '태그', type: 'list', item: { type: 'text' } },
  ] }
```

## 데이터 형식

`pluginStorage`에 둡니다. RisuAI의 `pluginStorage`는 모든 플러그인이 함께 쓰는 저장소라, 플러그인마다 키를 따로 써서 서로 덮어쓰지 않습니다.
(`getDatabase`는 허용된 필드만 돌려주기 때문에 `etcData` 같은 곳은 쓸 수 없습니다.)

```
da_interop:reg:<id>   = { spec: 1, id, name, version, pluginName, description,
                          fields, presets, values, appliedRev, lastError, updatedAt }   // B 플러그인이 씀
da_interop:patch:<id> = { rev, values, preset, updatedAt }                              // Dusk Atelier가 씀
```

B 플러그인은 3초마다(탭이 보일 때만) 패치를 확인하고, `rev > appliedRev`이면 `apply` 후 `appliedRev`를 올립니다.
플러그인 자신의 설정을 `pluginStorage`에 저장할 때도 `<플러그인이름>:` 같은 접두어를 붙여 다른 플러그인과 겹치지 않게 하세요.

## Dusk Atelier 쪽

구현은 [Dusk-Atelier `src/data/plugins.js`](https://github.com/Pyser08/Dusk-Atelier/blob/main/src/data/plugins.js)에 있습니다.

| 기능 | 조건 |
|---|---|
| 연동 목록, 자동 폼, 값 적용, 프리셋, 적용 확인, 정리 | 항상 |
| 카테고리 묶기, 저장소 보기, 업데이트 확인, 백업 내보내기 | 항상 |
| 켜기/끄기, 순서 변경, 코드 교체, 백업 복원, 중복 정리 | `plugins` 쓰기가 되는 환경에서만 |

`plugins` 쓰기 가능 여부는 Dusk Atelier 자신의 `versionOfPlugin`을 바꿨다가 다시 읽어 확인하고 원래 값으로 되돌립니다.
현재 RisuAI 본가와 이를 따르는 포크는 막혀 있어 마지막 줄 기능은 비활성화됩니다.

## 테스트 플러그인

`examples/da_interop_test.js`를 RisuAI에 설치하면 Dusk Atelier의 플러그인 → 연동 설정에 나타납니다. 이 플러그인의 설정 창에서 적용된 값과 기록을 확인할 수 있습니다.

## 라이선스

MIT
