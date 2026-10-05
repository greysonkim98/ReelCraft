# 출시 체크리스트 (비용 0원 우선)

원칙: 어떤 한도를 넘어도 **과금이 아니라 중단**되도록, 결제 수단을 어디에도 등록하지 않는다.
상업 운영으로 넘어갈 때만 해당 서비스에 카드를 등록한다.

## 1. 비용 구조

| 구성요소 | 무료 한도 | 한도를 넘으면 | 확인 상태 |
|---|---|---|---|
| Groq (무료 티어, 카드 등록 안 함) | gpt-oss-20b 분당 30회·8K 토큰, 일 1K회·200K 토큰 | 429 응답, 서버가 120b → 기본 자막으로 대체 | 한도 수치는 공식 문서와 실제 호출 헤더로 확인. "카드 없으면 과금 없음"은 Groq 약관으로 재확인 필요 |
| Render 무료 웹 서비스 (카드 등록 안 함) | 워크스페이스당 월 750시간, 15분 무트래픽이면 잠듦(깨어나는 데 약 1분) | **서비스 중지** (결제 수단이 없으면 과금하지 않음) | 공식 문서에서 확인 |
| Firebase Spark (Blaze로 올리지 않음) | Firestore 읽기 50K·쓰기 20K·삭제 20K/일, 1GiB. Hosting 전송 360MB/일 | 한도까지 사용 후 해당 기능 중단 | 수치는 공식 문서에서 확인. "Spark는 중단"은 일반 지식이라 재확인 권장 |
| 서비스 내부 방어 | 계정당 하루 3회, 서비스 전체 하루 60회, 소켓 2분 무활동/15분 최대/동시 50개 | 429 `DAILY_LIMIT`, 소켓 종료 | 테스트로 확인 |

**남은 비용 위험 하나:** Hosting 전송량(하루 360MB). ffmpeg 코어(약 32MB, 압축 후 크기는 미측정)를 내려받는 신규 사용자가 하루 수십 명을 넘으면 사이트가 그날 멈춥니다. 과금은 없지만 서비스는 멈춥니다.

## 2. 하지 말아야 할 것
- Render, Groq, Firebase(Blaze)에 카드 등록. 한 곳이라도 등록하면 그곳의 "중단"이 "과금"으로 바뀝니다.
- Firebase App Hosting, Cloud Functions, Storage 사용 (모두 Blaze 필요).
- GCP 예산 알림에 의존하기. 알림은 지출을 막지 않습니다.

## 3. 사용자가 할 일 (순서대로)

1. **Groq 키 교체 권장.** 키가 한동안 `.env.example`에 들어 있었습니다(커밋은 된 적 없음). 콘솔에서 새 키를 만들어 `.env`에만 넣으세요.
2. **Firebase 콘솔** (프로젝트 `reelcraft-4a7a7`)
   - 프로젝트 설정 > 일반 > 내 앱 > 웹 앱 추가 → `apiKey`, `authDomain`, `appId` 값을 알려 주세요(공개 값입니다).
   - Authentication > 로그인 방법 > Google 사용 설정.
   - Authentication > 설정 > 승인된 도메인에 배포 도메인 추가 (Hosting 배포 후).
3. **Firestore 규칙 배포:** `firebase deploy --only firestore:rules` (Spark에서 가능).
4. **서비스 계정 키** (Render가 Firestore에 쓰려면 필요)
   - Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성 → JSON 파일 다운로드.
   - PowerShell에서 base64로 변환: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("키파일.json"))`
   - 결과를 Render의 `FIREBASE_SERVICE_ACCOUNT_JSON`에 붙여 넣고, JSON 파일은 삭제하세요. 저장소에 절대 커밋하지 마세요.
5. **Render** (카드 등록 없이 가입) → 저장소를 GitHub에 올린 뒤 Blueprint로 `render.yaml` 연결 → `GROQ_API_KEY`와 `FIREBASE_SERVICE_ACCOUNT_JSON`을 대시보드에 입력.
6. 배포된 API 주소를 알려 주세요. 프론트의 `NEXT_PUBLIC_API_URL`에 넣습니다.
7. **프론트 운영 빌드와 배포** (`NEXT_PUBLIC_AUTH_EMULATOR`는 절대 설정하지 않습니다)
   ```powershell
   $env:NEXT_PUBLIC_API_URL = "https://<Render 주소>"
   $env:NEXT_PUBLIC_OPERATOR_NAME = "<운영자 이름>"      # /terms, /privacy 에 표시됨
   $env:NEXT_PUBLIC_CONTACT_EMAIL = "<문의 이메일>"       # 비어 있으면 페이지에 초안 경고가 보임
   npm run export -w @reelcraft/frontend
   firebase hosting:channel:deploy preview               # 먼저 미리보기 주소에서 확인
   firebase deploy --only hosting                        # 확인 후 운영 배포
   ```
8. **미리보기 주소에서 꼭 확인할 것** (로컬에서는 확인할 수 없었던 부분)
   - `/editor`를 열고 개발자 도구 콘솔에서 `crossOriginIsolated`가 `true`인지 (`firebase.json`의 헤더가 실제 Hosting에서 적용되는지).
   - `/`에서는 `crossOriginIsolated`가 `false`인지.
   - Google 로그인이 끝까지 되는지. 안 되면 Firebase 콘솔 Authentication > 설정 > 승인된 도메인에 해당 도메인이 있는지,
     Google Cloud 콘솔 > API 및 서비스 > 사용자 인증 정보의 웹 클라이언트에 `https://<도메인>/__/auth/handler`가
     승인된 리디렉션 URI로 들어 있는지 확인하세요.
9. **상업 운영 전 법률 검토:** Groq 약관(무료 티어 상업 사용), ffmpeg.wasm의 GPL(x264/x265)·H.264/HEVC 특허, 영문 개인정보 처리방침과 약관(CCPA, 13세 미만 사용자).

## 4. 나중에 상업용으로 키울 때
- Render를 유료 인스턴스로 올리면 같은 코드로 인스턴스를 늘릴 수 있습니다(요금표는 직접 확인).
- 인스턴스가 2개 이상이 되면 Render가 스티키 세션을 주지 않으므로, 기기 간 진행률 공유가 필요하면 Socket.IO에 공유 어댑터(Redis 등)를 붙입니다. 사용량 카운터는 Firestore 트랜잭션이라 그대로 안전합니다.
- Groq는 유료 티어로 올리면 한도가 커지고, 그때 `GLOBAL_DAILY_AI_CAP`과 `AI_PER_USER_PER_DAY`를 환경변수로 올립니다.
- Hosting 전송량이 모자라면 정적 파일을 다른 무료 CDN으로 옮기거나 Blaze로 올리고 예산 알림을 겁니다.
