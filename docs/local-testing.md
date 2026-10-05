# 로컬에서 돌려 보기

PowerShell 기준입니다. Google 로그인 없이 **Auth 에뮬레이터**로 전체 흐름을 확인합니다.

## 1. 준비
```powershell
npm install                  # postinstall이 ffmpeg 코어를 frontend/public/ffmpeg 로 복사
copy .env.example .env       # 그다음 .env 에 GROQ_API_KEY 입력 (.env 는 git에 올라가지 않음)
```

## 2. 개발 서버 (터미널 3개)
```powershell
# 터미널 1: 로그인 에뮬레이터
firebase emulators:start --only auth

# 터미널 2: 백엔드 (사용량 카운터는 메모리에 저장되어 재시작하면 초기화됨)
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
npm run dev:backend          # http://localhost:4000

# 터미널 3: 프론트엔드
$env:NEXT_PUBLIC_AUTH_EMULATOR = "127.0.0.1:9099"
npm run dev:frontend         # http://localhost:3000
```
http://localhost:3000 에서 **Developer sign-in (Auth emulator only)** 버튼으로 들어갑니다. 이 버튼은
`NEXT_PUBLIC_AUTH_EMULATOR`가 있는 빌드에만 나타납니다. 운영 빌드에서는 이 변수를 설정하지 마세요.

## 3. 자동 점검
```powershell
npm run lint
npm run typecheck
npm test                     # backend 48개 + frontend 66개 (외부 API는 가짜 구현)
npm run verify:render        # 네이티브 ffmpeg 필요: 합성 클립 → 분석 → 렌더 → ffprobe 검증
```

## 4. 브라우저 전체 흐름 (로그인 → 분석 → 실제 Groq 호출 → 렌더 → ffprobe)
Edge 또는 Chrome이 필요하고, `npm run verify:render`를 먼저 한 번 실행해야 합니다.
```powershell
# 정적 사이트 빌드 (에뮬레이터용 설정)
$env:NEXT_PUBLIC_AUTH_EMULATOR = "127.0.0.1:9099"
$env:NEXT_PUBLIC_API_URL = "http://localhost:4010"
npm run export -w @reelcraft/frontend

# 서버 3개 (각각 별도 터미널)
firebase emulators:start --only auth
$env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"; $env:STORE="memory"; $env:PORT="4010"; $env:CLIENT_ORIGIN="http://localhost:5000"; node backend/dist/index.js
node scripts/audit/serve-out.mjs 5000     # firebase.json 의 헤더 규칙대로 frontend/out 을 서빙

# 테스트 실행
npx tsx scripts/browser-smoke.ts
# Groq 키 없이: $env:MOCK_AI="1" 을 추가
```
`firebase emulators:start --only hosting`은 커스텀 헤더를 적용하지 않아서 헤더 검증에 쓸 수 없습니다.
그래서 `scripts/audit/serve-out.mjs`가 `firebase.json`의 규칙을 읽어 대신 적용합니다. 실제 Hosting에서의
헤더 동작은 배포한 뒤 미리보기 채널에서 확인하세요(`docs/launch-checklist.md`).

## 5. 알아둘 것
- `/editor`는 멀티스레드 ffmpeg를 위해 COOP/COEP 헤더가 필요하고, `/`(로그인)는 그 헤더가 없어야 Google
  리다이렉트가 동작합니다. 두 페이지 사이는 **전체 페이지 로드**로만 이동합니다(`window.location`).
  `router.push` 같은 앱 내부 이동을 쓰면 `/editor`가 격리되지 않아 느린 모드로 돌아갑니다.
- Firestore 에뮬레이터는 Java가 필요합니다(이 PC에는 없음). 그전에는 `STORE=memory`로 개발합니다.
