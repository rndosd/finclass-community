# 설치·배포 안내

이 안내는 새 프로젝트를 만드는 운영자용입니다. 기존 핀클래스 프로젝트를 대상으로
명령을 실행하거나 기존 데이터베이스를 가져오는 절차가 아닙니다.
표의 설정을 준비한 뒤 아래 순서로 진행하세요. 현재 실제 새 클라우드 설치 검증은 미완료입니다.

## 1. 준비

- Node.js 22, npm, Git을 설치합니다. `firebase-tools`는 루트 개발 의존성에 고정되어 있습니다.
- 본인 계정으로 새로운 Firebase 프로젝트를 만듭니다. 개발·운영을 나누려면 각각 만듭니다.
- 웹 앱을 등록하고 Firebase config를 확보합니다.
- Functions 배포에 필요한 Blaze 요금제를 연결하고 예산 알림을 설정합니다.
  정확한 요금과 할당량은 [Functions 시작 안내](https://firebase.google.com/docs/functions/get-started)와
  [Firebase 요금](https://firebase.google.com/pricing)에서 확인하세요.
- Cloudflare 계정과 이 설치 전용 R2 버킷을 준비합니다.

```sh
npm ci
npm --prefix functions ci
npx firebase login
npx firebase projects:list
```

이하 `YOUR_PROJECT_ID`는 Firebase 콘솔에서 확인한 **자기 새 프로젝트 ID**로 바꿉니다.
명령마다 `--project`를 명시합니다. 원본 `.firebaserc`는 포함하지 않습니다.

## 2. Firebase 콘솔 설정

| 서비스 | 설정 |
|---|---|
| Authentication | 이메일/비밀번호 및 필요한 경우 Google 제공자 활성화 |
| 승인된 도메인 | 사용할 Hosting/맞춤 도메인 등록; 개발 시 `localhost`도 직접 확인 |
| Firestore | 데이터베이스 생성, 위치 결정; 파일의 규칙을 배포 |
| Storage | 버킷 생성, 콘솔의 실제 버킷 이름 확인; 파일의 규칙을 배포 |
| Hosting | 자기 프로젝트의 기본 사이트 사용 또는 사이트 연결을 별도로 구성 |
| App Check | Web 앱을 reCAPTCHA Enterprise로 등록하고 도메인과 사이트 키 설정 |

프로젝트 개념과 환경 분리는 [Firebase 프로젝트 안내](https://firebase.google.com/docs/projects/learn-more)를 참고하세요.
Firestore나 Storage를 공개 읽기·쓰기 모드로 열어 설치 오류를 해결하지 마세요.

## 3. 프런트엔드 환경설정

`.env.example`을 `.env.local`로 복사합니다. Web 앱 config의 API key, projectId,
authDomain, storageBucket, messagingSenderId, appId를 각각 대응하는 변수에 넣습니다.

`REACT_APP_FIREBASE_EXPECTED_PROJECT_ID`는 projectId와 동일해야 합니다.
Storage 버킷은 생성 시점에 따라 `.firebasestorage.app` 또는 `.appspot.com`일 수 있으므로
콘솔의 실제 값을 사용하세요. `REACT_APP_PUBLIC_ORIGIN`은 `https://자기사이트` 형태이며
경로·쿼리·계정 정보를 넣지 않습니다. 개발 서버 주소와 달리 배포 사이트의 HTTPS 주소를 넣습니다.

`REACT_APP_GOOGLE_CLIENT_ID`에는 **자기 프로젝트의 Google OAuth Web client ID**를 넣습니다.
Firebase Auth의 Google 제공자 Web SDK 설정과 Google Cloud의 OAuth 클라이언트를 확인하고,
해당 클라이언트의 승인된 JavaScript origin에 실제 배포 사이트를 등록하세요.
현재 로그인 화면은 Google 로그인도 제공하므로 이 초안은 이 값을 준비하도록 요구합니다.
OAuth client secret은 브라우저에 넣지 않습니다. 기존 운영자의 client ID 기본값은 제거했습니다.
개발 모드의 Firebase popup 로그인과 배포 모드의 Google Identity Services 경로는 다르므로
배포 환경에서도 로그인해야 확인이 완료됩니다.
참고: [Google OAuth 웹 클라이언트 설정](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid).

`REACT_APP_SUPPORT_URL`에는 자기 HTTPS 문의 페이지를 넣습니다. 비어 있으면 문의 버튼을 숨깁니다.
기존 운영자의 카카오방과 이메일은 연결하지 않습니다. 검색 노출은 처음에는 `noindex,nofollow`로 둡니다.

App Check를 사용하면 `REACT_APP_APPCHECK_ENABLED=true`와 자기 사이트 키를 설정합니다.
강제 적용은 토큰이 정상 발급되는지 확인한 뒤 콘솔에서 서비스별로 켭니다.
로컬 개발 토큰은 해당 프로젝트에만 등록하고 `.env.development.local`에만 두세요.
토큰이 있는 상태에서는 프로덕션 빌드가 중단됩니다.
참고: [App Check 설정](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).

## 4. R2 업로드 연결

1. 설치 전용 버킷을 만들고 그 버킷에 필요한 객체 읽기·쓰기 권한만 가진 API 토큰을 발급합니다.
2. 자기 도메인 또는 R2 개발용 공개 주소를 설정합니다. 공개 주소의 파일은 URL을 아는 사람이
   접근할 수 있으므로 학생 개인정보가 들어가는 파일을 공개 버킷에 올리기 전에 운영 방침을 정합니다.
3. `functions/.env.example`을 `functions/.env.YOUR_PROJECT_ID`로 복사합니다.
4. `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`을 자기 값으로 채웁니다.
5. `UPLOAD_ALLOWED_ORIGINS`에 배포 사이트와 필요한 로컬 origin만 쉼표로 나열합니다.
6. R2 버킷 CORS에도 동일한 origin, 실제 업로드에 필요한 `PUT`, 조회 `GET`/`HEAD`,
   헤더 `Content-Type`을 허용합니다. 서명 URL에서 사용하는 헤더도 정책과 맞춥니다.

```sh
npx firebase functions:secrets:set R2_ACCESS_KEY_ID --project YOUR_PROJECT_ID
npx firebase functions:secrets:set R2_SECRET_ACCESS_KEY --project YOUR_PROJECT_ID
```

명령의 입력 프롬프트에 자기 키를 넣습니다. 쉘 명령 인수나 문서에 키를 적지 마세요.
버킷 CORS와 callable의 origin 검사는 둘 다 필요합니다.
참고: [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).

## 외부 API와 서버 Secret

| Secret/설정 이름 | 현재 연결 기능 | 보관 위치 |
|---|---|---|
| `GOOGLE_API_KEY` | 기존 Gemini 기반 챗봇·AI 요약 | Firebase Secret Manager |
| `FINNHUB_API_KEY` | 주식 시세와 종목 등록 | Firebase Secret Manager |
| `ALPHA_VANTAGE_API_KEY` | 배당·실적·ETF 프로필 | Firebase Secret Manager |
| `FOOTBALL_DATA_TOKEN` | 스포츠 경기 조회 | Firebase Secret Manager |
| `SEC_API_USER_AGENT` | SEC 데이터 요청의 서비스명·연락처 | `functions/.env.YOUR_PROJECT_ID` |
| `ENFORCE_APPCHECK` | auth 모듈의 기존 App Check 검사 | `functions/.env.YOUR_PROJECT_ID` |

Secret별로 다음 패턴을 사용합니다.

```sh
npx firebase functions:secrets:set FINNHUB_API_KEY --project YOUR_PROJECT_ID
```

첫 버전은 기존 서버 모듈을 유지하므로 **전체 Functions 배포에는 해당 모듈들이 요구하는 Secret도 준비해야 합니다.**
외부 연동을 사용하지 않으려면 해당 함수·예약 작업의 배포와 화면 접근을 함께 제한해야 합니다.
현재 초안은 그 제한을 완료한 별도 최소 기능 배포판을 제공하지 않습니다. 빈 키나 원본 키를 넣어
배포를 통과시키지 마세요. 각 제공자 요금·요청 제한은 운영자가 직접 확인합니다.
ChatGPT 구독 로그인, 로컬 MCP와 Jev 실험을 연결하는 절차는 이 버전에 없습니다.

## 5. 로컬 확인과 배포

먼저 설정과 테스트를 확인합니다.

```sh
npm run test:core
npm run test:backend
npm run build
```

자기 새 프로젝트에 쓰기를 수행할 준비가 됐을 때만 다음을 실행합니다.
아래 명령은 실제 클라우드 설정·함수를 변경합니다. 공개 초안 작성 과정에서는 실행하지 않았습니다.

```sh
npx firebase deploy --only firestore:rules,firestore:indexes,storage --project YOUR_PROJECT_ID
npx firebase deploy --only functions --project YOUR_PROJECT_ID
npx firebase deploy --only hosting --project YOUR_PROJECT_ID
```

인덱스 생성이 끝날 때까지 기다립니다. Google 로그인·업로드·인증이 실패하면
Auth 승인 도메인, 웹 앱 config, 사이트 origin, R2 CORS와 App Check 토큰을 각각 확인합니다.
Functions deploy의 lint 실패를 무시하지 마세요. 원본의 운영용 배포·복구 스크립트는 포함하지 않습니다.

## 6. 클라우드를 쓰지 않는 가짜 데이터 연습

```sh
npx firebase emulators:start --only auth,firestore,functions,storage --project demo-finclass-local
```

Java 등 에뮬레이터 요구사항은 Firebase CLI 안내에 맞춰 설치합니다.
브라우저 `.env.development.local`에서 projectId와 expectedProjectId를 `demo-finclass-local`,
authDomain을 `demo-finclass-local.firebaseapp.com`, storageBucket을 `demo-finclass-local.appspot.com`으로
맞추고 senderId/appId는 서로 일치하는 가짜 값을 사용합니다. Web API key도 개발용 가짜 값으로
설정합니다. publicOrigin은 개발용 HTTPS 예시 origin으로 두고 canonical redirect hosts는 비웁니다.
`REACT_APP_USE_EMULATORS=true`, `REACT_APP_APPCHECK_ENABLED=false`로 실행합니다.
서비스별 포트는 `firebase.json`과 `src/firebase.js`가 같습니다.

Functions의 외부 API 모듈은 로컬에서도 별도 키를 요구할 수 있습니다. 에뮬레이터에 연결했다고
외부 API까지 모의 응답이 되는 것은 아닙니다. 테스트 파일의 합성 harness로 거래 로직을 먼저 확인하세요.
개발을 마치면 자신이 시작한 에뮬레이터와 개발 서버를 원래 터미널의 Ctrl+C로 종료합니다.
