# ReelCraft

휴대폰 영상 여러 개를 받아 AI 자막이 들어간 60초 이하 세로 릴스(720×1280, 9:16 MP4)를 만드는 웹앱.
**영상은 브라우저 밖으로 나가지 않습니다.** 분석·자르기·자막 입히기·인코딩은 모두 브라우저의
ffmpeg.wasm에서 하고, 서버는 로그인 확인·사용량 제한·AI 자막 호출만 맡습니다. 화면은 영어입니다.

> 현재 상태: 로그인(Firebase) → 클립 → 스타일 → 분석 → AI 자막(Groq) → 검토 → 렌더 → 공유까지 동작합니다.
> 아직 없는 것: SigLIP 2 장면 태그, Kokoro 보이스오버(TTS), 단계별 로컬 저장, 장애 대응 매트릭스 전체.
> 배포 설정(Render, Firebase Hosting)은 파일만 있고 실제 배포는 하지 않았습니다.

## 시작하기
- 로컬 실행과 점검: [docs/local-testing.md](docs/local-testing.md)
- 배포와 비용 원칙, 해야 할 일: [docs/launch-checklist.md](docs/launch-checklist.md)
- 구성요소 점검 결과: [docs/component-audit.md](docs/component-audit.md)

## 구조
```
shared/    공용 타입, zod 스키마(scenes.json / script JSON), 상수와 한도
backend/   Express + Socket.IO. Groq(gpt-oss-20b) 호출, Firebase 토큰 검증, 하루 사용량 제한
frontend/  Next.js(정적 내보내기), lib/ffmpeg/ (브라우저 안 분석·렌더링), lib/auth·api·realtime
scripts/   verify-render.ts, browser-smoke.ts, audit/ (실험·정적 서버)
firebase.json, firestore.rules, render.yaml
```

## 서버 API
| 경로 | 설명 |
| --- | --- |
| `GET /api/v1/health` | 상태 확인 (로그인 불필요) |
| `GET /api/v1/me/usage` | 오늘 남은 AI 자막 횟수 |
| `POST /api/v1/ai/script` | scenes.json → script JSON. 로그인 필요, 계정당 하루 3회·전체 하루 60회 |
| Socket.IO `project:progress` | 같은 계정의 다른 기기에 진행률 전달. 2분 무활동·15분 최대로 자동 종료 |

## ffmpeg.wasm 주의사항 (직접 측정한 것)
- **스레드 수를 반드시 제한합니다** ([threads.ts](frontend/lib/ffmpeg/threads.ts)). `@ffmpeg/core-mt`는
  워커 32개가 고정이라, ffmpeg 기본값(코어 수만큼)으로 두면 0%에서 영원히 멈춥니다.
- **RGB 변환을 강제하는 필터는 쓰지 않습니다** ([filters.ts](frontend/lib/ffmpeg/filters.ts)).
  YUV→RGB 변환이 프레임당 메모리를 흘려 렌더가 OOM으로 죽습니다.
- 입력 클립이 20개를 넘으면 렌더가 자동으로 단일 스레드 코어(느린 모드)로 전환됩니다.
- `@ffmpeg/core`는 GPL-2.0-or-later(x264/x265 포함)입니다. 고지 페이지(`/licenses`)와 법률 검토가 필요합니다.
