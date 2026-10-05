# ReelCraft 구성요소 점검 결과

점검일 2026-10-04 · 기준 문서 "ReelCraft 최종 기술 설계서" · 방향: Groq 무료 최소 모델, 9:16 / 720×1280

## 1. 점검 환경과 한계

실험은 모두 이 PC(Windows 11, 20코어, RAM 32GB, NVIDIA GPU)의 헤드리스 Edge 154에서 했습니다. 서버는 `crossOriginIsolated=true` 상태가 되도록 COOP/COEP 헤더를 붙였습니다.

- **하지 못한 것**: 아이폰 Safari와 안드로이드 Chrome 실기기 실험, Groq 실제 호출(API 키 없음), firebase-admin·Firestore 규칙·Socket.IO 실행, 실제 HDR 촬영물의 색 변환 품질, 모바일 메모리 한계.
- **PC 수치의 의미**: 이 PC는 폰보다 훨씬 빠릅니다. 아래 속도 수치는 "폰에서는 이보다 느리다"는 하한선으로만 읽어야 합니다.
- 웹 문서 내용은 요약 모델을 거쳐 읽었습니다. 특히 Cloud Run 리전 관련 문장은 원문 확인에 실패했습니다.

## 2. 판정 요약

| # | 요소 | 판정 | 핵심 근거 |
|---|---|---|---|
| 1 | WebCodecs VideoDecoder/Encoder | 조건부 | PC Edge는 HEVC 하드웨어 디코딩만 지원(`prefer-software`는 false). H.264 인코딩은 전부 지원. 폰은 미검증 |
| 2 | hevc.js | 불필요 | 찾은 `@hevcjs/core`는 스트리밍 플러그인 전용. ffmpeg.wasm이 HEVC를 직접 디코딩함 |
| 3 | ffmpeg.wasm (core, core-mt) | 적합 | HEVC 8bit·10bit HDR·회전 mov·VFR 모두 720×1280 H.264로 변환 성공 |
| 4 | OpenCV.js | 적합, 대체 가능 | 동작하지만 13.3MB. ffmpeg.wasm에 `blurdetect`, `signalstats`, `scdet`, `freezedetect`가 이미 있음 |
| 5 | SigLIP 2 (transformers.js) | 조건부 | 정확도·기기 간 일관성은 좋음. dtype 선택과 모델 크기를 바꿔야 함 |
| 6 | Kokoro-82M | 적합 | webgpu·wasm 모두 정상 음성 생성. 약 1배속 |
| 7 | Wake Lock API | 미검증 | Edge에는 있음. Safari는 실기기 확인 필요 |
| 8 | IndexedDB (단계별 저장) | 적합 | API 존재 확인. 저장 로직은 미구현 |
| 9 | Express + zod | 적합 | 기존 테스트 backend 22개, frontend 59개 통과 |
| 10 | Socket.IO | 조건부 | Cloud Run이 WebSockets 지원. 요청 제한시간 최대 60분, 세션 어피니티는 best-effort. 미설치·미실행 |
| 11 | firebase-admin / Firestore | 미검증 | 계정·에뮬레이터 없이 실행 못 함 |
| 12 | Groq gpt-oss-20b | 조건부 | 무료 최소 채팅 모델, strict Structured Outputs 지원. 실제 호출 미검증 |
| 13 | Cloud Run (min0/max1) | 조건부 | 무료 한도 수치는 설계서와 일치. 리전 조건 확인 필요 |
| 14 | Auth signInWithRedirect | 조건부 | 스토리지 파티셔닝 때문에 `authDomain` 설정 필요 |
| 15 | Firestore 컬렉션·규칙 | 미검증 | 무료 한도는 설계서와 일치(읽기 50K, 쓰기 20K, 삭제 20K, 1GiB / 프로젝트당) |
| 16 | Firebase Hosting | 미검증 | 아래 4번 참고 |
| 17 | COOP/COEP | 적합 | HF 모델·ORT wasm 로딩이 COEP 아래에서 정상 동작 |
| 18 | GCP 결제 계정 | 필수 | 무료 한도 내에서도 필요 |
| 19 | Groq 무료 한도 | 확인됨 | 분당 30회, 일 1K회, 분당 8K, 일 200K 토큰 |

## 3. 설계서와 실제가 다른 점

1. **ffmpeg.wasm은 HEVC를 디코딩합니다.** 설계서는 "HEVC 디코더가 빠진 경우가 많다"고 했지만, 레포의 `@ffmpeg/core` 0.12.10(싱글·멀티스레드 둘 다)은 HEVC를 디코딩합니다. 따라서 WebCodecs가 안 되는 기기의 폴백은 hevc.js가 아니라 ffmpeg.wasm으로 충분합니다. 설계서가 쓴 "추정 94%"도 근거가 약합니다. 조사한 데이터셋에서 HEVC 디코더 지원률은 Chrome Android 81.4%, Safari iOS 85.7%였습니다. 폰 사용자의 상당수가 폴백 경로를 타게 됩니다.
2. **hevc.js는 설계서가 설명한 물건이 아닙니다.** `@hevcjs/core`(MIT, WASM 262KB)는 dash.js·hls.js·Shaka용 스트리밍 플러그인이고 로컬 파일 변환 API가 없습니다. H.264 인코딩도 WebCodecs에 의존합니다.
3. **SigLIP `dtype: "q8"`과 WebGPU는 최악의 조합입니다.** 비전 모델 1장당 시간은 다음과 같습니다.

   | 조합 | 1장당 | 모델 크기 |
   |---|---|---|
   | WebGPU q8 | 285ms | 94.6MB |
   | WebGPU fp16 | 20ms | 186MB |
   | WebGPU q4f16 | 26ms | 54.6MB |
   | wasm q8 | 103ms | 94.6MB |
   | wasm q4 | 222ms | 63.3MB |

   300장 기준으로 WebGPU q8은 약 86초, WebGPU fp16은 약 6초입니다. 설계서의 "q8로 정밀도 고정"은 기기별로 dtype을 바꾸면 성립하지 않습니다. 4장의 점수 비교는 WebGPU q8과 wasm q8 사이에서만 했고, fp16과 q8의 순위가 같은지는 확인하지 못했습니다. dtype을 바꾸기 전에 여행 영상으로 순위 일치를 확인해야 합니다.
4. **SigLIP 2는 텍스트 모델이 큽니다.** base-224 q8 기준 텍스트 283.4MB + 비전 94.6MB = 약 378MB를 내려받아야 합니다. 후보 문장 임베딩은 미리 계산해 배포하면 텍스트 모델이 필요 없지만, 유저 메모와의 유사도 비교는 런타임 텍스트 인코딩이 필요합니다. 메모 유사도를 포기하고 하트 탭 가산점만 쓸지 정해야 합니다.
5. **Kokoro는 WebGPU가 빠르지 않았습니다.** 5.5초 분량 음성 생성이 webgpu 4.7초, wasm 4.3초였고 로딩은 약 5초입니다. 설계서의 "webgpu 우선"은 이 모델에서는 이득이 없습니다.
6. **transformers.js 버전이 둘입니다.** kokoro-js 1.2.1은 transformers.js 3.x를 내장한 2.1MB 단일 번들이고, SigLIP은 4.3.0으로 돌렸습니다. 한 페이지에 ONNX 런타임이 두 벌 올라갑니다.
7. **Groq 최소 모델은 gpt-oss-20b입니다.** 무료 표에 Llama 3.1 8B는 없습니다. 20b와 120b의 한도가 같아서 120b 폴백은 한도 면에서 이득이 없습니다(모델별 한도는 따로 잡힘).
8. **Groq TPM은 요청한 `max_tokens` 기준으로 차감된다는 자료가 있습니다.** 2차 자료만 확인했으니 공식 문서로 재확인이 필요합니다.
9. **Cloud Run 무료 한도는 Tier 1 리전 기준입니다.** 서울(asia-northeast3)은 Tier 2라 무료 한도가 없다는 내용을 읽었지만 원문 확인에 실패했습니다. 리전을 정하기 전에 반드시 직접 확인해야 합니다.
10. **COOP는 로그인 문제의 진짜 원인이 아닙니다.** 레포는 이미 COOP/COEP를 `/editor`에만 적용해서 `/`의 팝업 로그인과 공존합니다. 리다이렉트 방식의 실제 문제는 브라우저의 서드파티 스토리지 파티셔닝(Chrome 115+, Firefox 109+, Safari 16.1+)입니다. `authDomain`을 앱 도메인과 같게 하거나 `/__/auth/`를 프록시해야 합니다.
11. **레포와 방향이 다릅니다.** 레포의 LLM은 Cerebras가 주이고 Groq가 폴백이며, 출력은 README 기준 1080×1920입니다. 결정한 방향(Groq 최소 모델, 720×1280)에 맞춰 바꿔야 합니다.

## 4. 측정 결과

**ffmpeg.wasm 변환 (720×1280, 30fps, H.264/AAC)**

| 입력 | 코어 | 시간 | 결과 |
|---|---|---|---|
| H.264 3초 | 싱글 | 2.7초 | 성공 |
| HEVC 8bit 3초 | 싱글 / 멀티 | 2.9초 / 1.3초 | 성공 |
| HEVC 10bit HDR 3초 | 싱글 | 2.9초 | 성공 (톤매핑 미적용) |
| HEVC 회전 메타(90°) mov | 싱글 / 멀티 | 2.9초 / 1.3초 | 성공, 회전 정상 반영 |
| HEVC VFR 2.9초 | 싱글 | 1.8초 | 성공 (30fps로 통일) |
| HEVC 1080p 30초 | 싱글 / 멀티 | 27.2초 / 13.7초 | 1.1배속 / 2.2배속 |

HDR 영상은 변환은 되지만 톤매핑을 거치지 않았습니다. `zscale`, `tonemap`, `colorspace` 필터가 있으니 실제 HDR 촬영물로 색을 따로 확인해야 합니다. 합성 영상으로는 색 품질을 판단할 수 없었습니다.

**SigLIP 2 정확도 (샘플 5장, 라벨 6개)**: 호랑이·고양이·축구·인물·빵 모두 정답 라벨이 1위였습니다. 같은 q8에서 WebGPU와 wasm의 코사인 점수 차이는 0.001 안팎(예: 0.099 vs 0.098)이라, 기기 간 연산 편차는 작았습니다. 순위 기반 선택 설계와 모순되지 않습니다. 여행 영상 10개로 하는 임계값 조정은 별도로 해야 합니다.

**OpenCV.js**: 로딩 173ms(로컬), 320px 프레임 한 장 처리 0.3~4ms. 라플라시안 분산이 이미지별로 78~3,706으로 선명도 차이를 구분했습니다.

**Groq 토큰 추정 (scene 15개)**: 입력 약 1,080토큰, JSON 응답 약 554토큰입니다. gpt-oss가 쓰는 추론 토큰이 변수라서 한 번 호출이 1.6K(추론 0)~3.1K(추론 1,500) 토큰이 됩니다.

| 항목 | 값 |
|---|---|
| 분당 8K 한도 대비 | 호출 1회 20~39% |
| 재요청(3 scene) 입력 | 약 470토큰 |
| 일 200K 한도로 가능한 렌더 | 하루 약 63~122건 (조직 전체 합산) |

## 5. 권장 조치

1. HEVC 폴백을 hevc.js에서 ffmpeg.wasm 디코딩으로 바꿉니다. WebCodecs는 있으면 쓰는 가속 경로로 둡니다.
2. SigLIP은 WebGPU면 fp16(또는 용량이 부담이면 q4f16), wasm이면 q8로 기기별 dtype을 정합니다. 메모 유사도 기능을 유지할지 먼저 결정합니다.
3. OpenCV.js를 쓸지 재검토합니다. ffmpeg.wasm 필터로 blur·정지·장면 전환 감지가 가능합니다(레포가 이미 사용 중).
4. Groq 호출은 `max_completion_tokens`를 작게(약 1,200) 지정하고, `reasoning_effort`를 낮춥니다. 분당 8K와 일 200K를 서비스 전체가 공유한다는 점을 사용량 제한 설계에 반영합니다.
5. Cloud Run 리전을 Tier 1로 정할지 먼저 확인하고, 결제 계정과 예산 알림을 설정합니다.
6. Auth는 `authDomain`을 앱 도메인으로 맞추는 방식으로 설계합니다. Firebase Hosting에 Next 빌드를 올릴 경우, 레포의 COOP/COEP 설정이 `next.config.js` `headers()`에 있어서 정적 호스팅에서는 적용되지 않을 수 있습니다. `firebase.json`의 headers로 옮겨야 하는지 확인이 필요합니다(추정).
7. 실기기 확인: 아이폰 Safari와 안드로이드 Chrome에서 `scripts/audit/`의 페이지로 WebCodecs 지원표와 변환 시간을 기록합니다.

## 6. 재현 방법

- 테스트 영상 생성: 네이티브 ffmpeg로 `.scratch/codec/`에 HEVC 8bit, HEVC 10bit HDR, 회전 mov, VFR, 30초 1080p를 만들었습니다.
- 코덱·ffmpeg.wasm 실험: `node scripts/audit/run-codec.mjs`, 속도 측정은 `node scripts/audit/run-long.mjs`.
- SigLIP·Kokoro·OpenCV 실험은 레포 밖 임시 폴더에 패키지를 설치해서 돌렸고, 레포의 package.json은 바뀌지 않았습니다.
