# 구조와 개인 운영 연결 대상

이 버전은 기존 Firebase 앱을 독립 프로젝트에 설치하는 방식입니다.
자기 VPS와 PostgreSQL만으로 운영하는 버전은 포함하지 않습니다.

| 영역 | 역할 | 개인 운영자가 연결할 대상 |
|---|---|---|
| `src/` | 교사·학생·운영자 React 화면 | 자기 Firebase Web 앱 설정 |
| Firebase Auth | 이메일/비밀번호 및 Google 로그인 | 같은 프로젝트의 Authentication |
| Firestore | 학급·학생·거래·기록 | 같은 프로젝트의 데이터베이스 |
| `functions/` | 권한 확인, 금액 거래, 트리거·예약 작업 | 같은 프로젝트의 Cloud Functions |
| `firestore.rules`, `storage.rules` | 읽기·쓰기 권한 | 같은 프로젝트의 규칙 |
| `firestore.indexes.json` | 쿼리용 인덱스 | 같은 프로젝트의 인덱스 |
| Firebase Storage | Storage를 사용하는 기존 기능 | 같은 프로젝트의 버킷 |
| Cloudflare R2 | 사진·첨부파일 업로드/삭제 | 자기 계정의 버킷·API 토큰·공개 주소 |
| Firebase Hosting | 브라우저 앱과 SPA 경로 제공 | 자기 Hosting 사이트, 선택한 도메인 |
| 외부 API | 시세·배당·스포츠·기존 AI | 각 제공자에게 직접 발급받은 키 |

서버 함수와 브라우저의 Functions 리전은 `asia-northeast3`로 맞춰져 있습니다.
리전을 바꾸려면 두 곳뿐 아니라 Cloud Tasks·예약 작업과 연관 모듈도 함께 검토해야 합니다.
첫 설치에서는 이 리전을 유지하세요. Firestore/Storage 위치는 새 프로젝트를 생성할 때 결정합니다.

## 계정과 데이터 경계

`users/{uid}`와 `classes/{classId}`를 새 설치 안에서 생성합니다. 학생 기록은
`classes/{classId}/students/{uid}` 등 기존 경로를 사용합니다. 사용자 역할과 학급 연결은
Auth custom claims와 서버·규칙이 확인합니다. 화면을 숨기는 것만으로 권한이 생기거나 사라지지 않습니다.

거래는 기존 callable·transaction·batch 경로를 유지합니다. 독립 운영을 쉽게 하려고
학생 잔액을 브라우저에서 직접 덮어쓰거나 규칙을 전체 허용으로 바꾸지 않습니다.
가입과 학급 생성 역시 기존 callable을 사용하세요.

## 브라우저 설정과 비밀키

`REACT_APP_*`는 빌드된 JavaScript에 포함됩니다. Firebase Web 앱의 프로젝트 설정은
이 영역에 들어가지만 Admin 서비스 계정 개인키나 유료 제공자 비밀키는 넣으면 안 됩니다.
Firebase Web API 키의 역할과 서비스 계정 키의 차이는 [Firebase 보안 안내](https://firebase.google.com/support/guides/security-checklist)를 참고하세요.

Cloud Functions는 배포 프로젝트의 기본 자격증명을 사용합니다. 운영 웹 서버나 브라우저에
서비스 계정 JSON을 복사할 필요가 없습니다. 최초 관리자 설정에 필요한 로컬 ADC는 별도로 관리합니다.

## 외부 콘텐츠

주식 시세와 스포츠 데이터, TradingView 위젯, Google Fonts 등은 외부 제공자에 의존합니다.
키 발급, 허용된 사용 방식과 재배포 조건을 각 운영자가 확인해야 합니다.
사진·음원·로고는 앱이 사용하는 파일이어도 공개 재배포 권리가 자동으로 확인되는 것은 아닙니다.
