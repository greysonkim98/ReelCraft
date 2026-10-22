# Local testing

## Current setup: real Firebase Authentication and Firestore

Use this workflow for existing Firebase accounts and the management console. Keep the configured `.env` files; do not overwrite them with the example. In `frontend/.env.local`, use `NEXT_PUBLIC_API_URL=http://localhost:4000` and leave `NEXT_PUBLIC_AUTH_EMULATOR` empty. The root `.env` should use `STORE=firestore`, `PORT=4000`, and `CLIENT_ORIGIN=http://localhost:3000`.

Run these commands from the repository root in two separate PowerShell terminals:

```powershell
# Terminal 1: backend (clear any emulator overrides from earlier testing)
Remove-Item Env:FIREBASE_AUTH_EMULATOR_HOST -ErrorAction SilentlyContinue
Remove-Item Env:FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
npm.cmd run dev:backend
```

```powershell
# Terminal 2: frontend
Remove-Item Env:NEXT_PUBLIC_AUTH_EMULATOR -ErrorAction SilentlyContinue
npm.cmd run dev:frontend
```

Open `http://localhost:3000/login` and use your existing Firebase account. Do not start the Auth emulator for this workflow. Firestore access requires the configured local Google credentials.

If a port is already occupied, reuse or stop the existing server before starting another. The frontend stays on port 3000 to match the backend's allowed origin. The API health URL, `http://localhost:4000/api/v1/health`, must return JSON. If it returns HTML and login reports `Request failed (404)`, check for an old Firebase Emulator UI on port 4000. Stop that emulator; the updated `firebase.json` puts its UI on port 4002 on the next start.

## Optional isolated Auth emulator workflow

The instructions below use emulator accounts, which are separate from real Firebase accounts. Set `STORE=memory` for these Auth-only tests; they do not exercise persistent Firestore management. Restore the real-Firebase settings above before signing in with an existing account.

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
