# 교차 브라우저 검증 스크립트

Chromium · Firefox · WebKit에서 앱 전체를 같은 절차로 확인합니다.
결과 기록은 [`docs/CROSS-BROWSER-VALIDATION.md`](../../docs/CROSS-BROWSER-VALIDATION.md)에 있습니다.

## Playwright는 저장소 의존성이 아닙니다

이 저장소는 런타임·빌드 의존성이 0입니다. 검증한 파일이 그대로 배포되는 성질을 지키기 위해
Playwright는 **저장소 밖**에 설치하고 실행합니다. `package.json`에 추가하지 마세요.
axe-core를 다루는 방식과 같습니다.

```bash
# 저장소 밖 임시 폴더에 설치
mkdir -p /tmp/pw && cd /tmp/pw
npm init -y
npm install playwright
npx playwright install chromium firefox webkit
```

브라우저 바이너리는 약 350MB입니다.

## 실행

1. 저장소 루트에서 정적 서버를 띄웁니다.

```bash
python -m http.server 8020
```

2. axe-core를 임시 폴더에 내려받아 `_axe_tmp/`로 복사합니다. 접근성 검사에만 쓰며 커밋하지 않습니다.

```bash
npm pack axe-core@4.10.3 && tar -xzf axe-core-4.10.3.tgz
```

`package/axe.min.js`를 저장소의 `_axe_tmp/axe.min.js`로 복사하세요.

3. 스크립트를 실행합니다. `VERIFY_BASE`로 주소를 바꿀 수 있습니다(기본 `http://127.0.0.1:8020`).

```bash
node verify.mjs                # 세 엔진 모두. 9개 view · axe · 320px · 영어
node verify.mjs firefox        # 하나만
node operate.mjs webkit        # 운영 화면과 저장소 소유권
node offline.mjs firefox       # 지연 로딩 view와 offline pin (artifact 약 90MB)
```

4. 끝나면 `_axe_tmp/`를 지웁니다.

## 스크립트가 확인하는 것

| 스크립트 | 확인 항목 |
|---|---|
| `verify.mjs` | 실제 엔진 로드와 토큰 수, 플랫폼 기능 지원, Unicode 측정, Builder·Request Lab·Inspector·말뭉치 비교, Service Worker, 9개 view axe(데스크톱·320px·영어), console/page error, 4xx·5xx |
| `operate.mjs` | 저장소 용량 표시, artifact 상태 4단계, pin 동작, app shell ↔ artifact cache 중복 소유 |
| `offline.mjs` | 모델 비교·입력 샘플 매트릭스가 실제로 채워지는지, pin한 artifact가 네트워크 차단 상태에서 동작하는지 |

## 주의

- **`page.waitForFunction`의 시그니처는 `(fn, arg, options)`입니다.** `{ timeout }`을 두 번째 인자로 넘기면
  arg로 해석되어 기본 30초가 적용됩니다.
- **말뭉치 비교의 열 체크박스는 `change`마다 목록을 다시 그립니다.** 미리 모아 둔 노드로 반복 클릭하면
  두 번째부터 분리된 노드를 누르게 됩니다. 클릭할 때마다 다시 찾아야 합니다.
- **입력 샘플 매트릭스를 먼저 열지 마세요.** artifact 6개를 동시에 받기 시작해 뒤이은 벤치마크가
  대역폭에 굶습니다. `verify.mjs`는 전체 view 훑기를 벤치마크 뒤에 둡니다.
- 각 실행은 빈 프로필에서 시작하므로 artifact를 매번 새로 내려받습니다.
