# PALATE 후보함 — Life Hub 연결 (P2b)

## Life Hub 연결 (P2b)

PALATE는 Life Hub의 OAuth 공개 클라이언트로 연결된다. 클라이언트 비밀은 없고, `public/lifehub-client.json`(Client ID Metadata Document)으로 자신을 식별한다.

1. 후보함의 **Life Hub 연결** → Life Hub 소유자 비밀번호 화면 → PALATE로 돌아옴 (PKCE S256, `state`·`iss` 검증)
2. PALATE가 받는 토큰은 `food:inbox` 권한(보드 타일 업로드용 `food:board` 포함, README 「보드 타일」), `/palate` 리소스 전용이다. Claude 커넥터 토큰과 서로 쓸 수 없다.
3. 후보함을 열면 Life Hub의 대기 후보를 가져와 기존 계약 검증(`validateCandidate`)을 통과한 것만 로컬 후보함에 넣는다. **Archive.records는 바뀌지 않는다.**
4. 승인하면 기존처럼 기록과 `lifehub_receipts` 영수증이 한 번에 저장된 뒤, 영수증을 Life Hub로 보낸다(`POST /palate/v1/receipts`). 거절은 `POST /palate/v1/rejections`.
5. 전송 실패 시 아웃박스로 남아 다음 동기화 때 다시 보낸다. Life Hub와 상태가 다르면(409) 재시도를 멈추고 표시만 하며, **PALATE의 기록은 그대로 유지**한다.
6. Life Hub에서 가져온 후보만 결과를 보낸다. 직접 붙여 넣은 JSON 후보는 서버로 보내지 않는다.

### Claude 카드에서 승인한 항목 (Life Hub P4 2단계)

- 동기화는 `GET /palate/v1/candidates?status=open`(대기 + Claude 카드에서 승인됨)이다. 항목마다 `final_candidate ?? candidate`(카드에서 고친 내용 우선)를 쓰고, 같은 계약 검증을 다시 통과해야 한다.
- 로컬 후보가 아직 대기 중이면 더 새 `revision`만 따라간다. 같은 revision인데 내용이 다르면 충돌로 두고 덮어쓰지 않는다. 확정·거절된 항목은 바꾸지 않는다.
- **자동 반영**: `status=approved`, `needs_app_review=false`, 설정 「Claude에서 승인된 항목 자동 반영」(후보함, 기본 켜짐, 기기별 `palate.lifehub.auto-apply.v1`)이 켜져 있고, PALATE 저장 규칙상 필수값이 다 있을 때(식사는 날짜·호불호·재주문 의사)만, 앱을 열 때 기존 승인과 같은 트랜잭션(`approveCandidate` + 영수증)으로 저장하고 영수증을 보낸다.
- 하나라도 맞지 않으면 후보함에 「Claude에서 승인함」(· 확인 필요)으로 남아 소유자가 마저 확인한다. 추측해서 채우지 않는다.
- 같은 후보는 영수증 때문에 두 번 저장되지 않는다. 출처 `codex`도 받는다.

저장 위치 (이 브라우저 전용): 토큰 `palate.lifehub.remote.v1`, 가져온 후보 키 `palate.lifehub.remote-keys.v1.<user-id>`, 전송 결과 `palate.lifehub.remote-outcomes.v1.<user-id>`. 연결 해제 시 토큰을 지우고 서버에 폐기를 요청한다.

연결 주소는 `src/lib/lifehub-config.ts`에 있다(공개 URL이며 비밀 값이 아님). 배포된 PALATE 주소에서만 연결 버튼이 활성화된다.

## 현재 기능

Life Hub는 아직 존재하지 않습니다. PALATE의 `#/inbox` 화면은 **로컬 샘플 또는 사용자가 직접 붙여 넣은 후보 JSON**을 검토하는 테스트용 기능입니다. ChatGPT·Claude로부터 자동 수신하거나 해당 서비스에 로그인하는 기능은 포함하지 않습니다.

- 기존 아카이브·일기·고르기 세 탭을 유지하고, 고르기 및 헤더에서 후보함 진입
- 식사 후보와 위시리스트 후보를 로컬 후보함에 추가
- 후보를 검토하면서 메뉴·가게·지점·주소·실제 식사 날짜·호불호·재주문 의사·메모 수정
- **실제 기록으로 저장**을 명시적으로 누르기 전에는 Archives.records에 어떠한 식사도 추가하지 않음
- 거절·승인 상태와 외부 메시지의 출처 키 유지
- 기존 메뉴나 가게의 동명이점 구분: 주소가 다르면 별도 가게이며, 같은 이름이 여러 개일 때 지점이 불명확하면 저장 차단
- JSON 가져오기는 후보 데이터 검증만 수행하며 입력한 source 표시가 실제 제공자의 인증을 뜻하지 않음

## 저장 구조

- 후보 원본: 사용자 ID별 `localStorage["palate.lifehub.local-inbox.v1.<user-id>"]` (텍스트 전용, 브라우저 로컬). 서버 동기화·외부 백업이 아니며 공개 저장이 아니다.
- 승인 결과 및 **`lifehub_receipts` 영수증**: PALATE Archive 스키마 v2의 선택적 배열. 기록/영수증을 동일한 `onSave` 변경 함수에 넣어 P2-B의 하나의 IndexedDB 트랜잭션 또는 레거시 localStorage 쓰기로 확정한다.
- 전환 후에도 기존 JSON 백업/복원 흐름 사용 가능. receipt는 JSON에 포함되며, 저장 성공 후 후보함 상태 저장이 실패하더라도 새로고침 시 receipt로 승인 여부를 재구성한다.
- 재전송된 동일 `source:idempotency_key`는 식사를 중복 생성하지 않는다. 사용자가 나중에 식사를 삭제해도 receipt를 유지해 다시 만들지 않는다.
- `Archive.lifehub_receipts`가 없는 이전 백업도 읽을 수 있다.
- **단서:** 후보함 자체는 현재 로컬 기기 전용이므로 JSON 백업에는 후보함의 미승인 항목이 포함되지 않는다. 여러 기기 후보 동기화는 P3 백엔드가 구현된 뒤 가능하다.

## 남은 일

- 여러 기기에서 로컬 후보함 상태(미승인 후보) 동기화. 현재는 각 기기가 Life Hub에서 대기 후보를 따로 가져온다.
- 같은 후보를 두 기기에서 각각 승인할 때의 충돌 화면 (지금은 두 번째 영수증이 409로 표시만 됨).
- 독서·업적·추억 등 다른 사이트로 같은 연결 방식 확장.

비밀 API 키를 브라우저에 넣지 않는다. 토큰은 소유자가 로그인해 받은 단기 액세스 토큰과 회전되는 리프레시 토큰뿐이다.
