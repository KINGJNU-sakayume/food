# PALATE × Life Hub — candidate protocol v1

## 목적

ChatGPT와 Claude를 **공통 기록 입력 창**으로, PALATE를 개인 미식 경험의 **기록·열람 화면**으로 쓰는 기반 계약이다. 이 파일은 **설계 및 순수 후보 유효성 검사**만 정의한다. 외부 API/로그인/동기화 서버는 아직 구현하지 않는다.

## 핵심 흐름

1. 사용자 대화에서 PALATE용 후보가 만들어짐 (확정 기록 아님)
2. 인증된 Life Hub가 후보를 수신하고 소유자별로 격리
3. `source + idempotency_key`로 재시도 중복 제거. 같은 키의 내용 변경은 충돌로 거절
4. PALATE가 보류 후보를 보여 줌 → 사용자가 날짜·메뉴·실제 가게/지점·평가를 수정/확인
5. PALATE의 저장 트랜잭션이 성공한 경우에만 후보 상태를 `confirmed`로 변경
6. 같은 요청을 다시 보낼 때 새 EatingRecord를 중복 생성하지 않음

## 데이터 계약

`src/lib/lifehub-contract.ts`: v1 후보 (`schema_version=1`).

공통 필드:
- `candidate_type`: `meal` 또는 `wish`
- `source`: `chatgpt` / `claude` / `manual` (추후 허용 목록 확장)
- `source_ref`: 불투명한 출처 메시지 참조. 대화 원문이나 외부 로그인 토큰은 저장하지 않음
- `idempotency_key`: 외부 전송자가 같은 요청을 재시도할 때 **반드시 동일하게 유지하는 키**
- `created_at`: ISO 시각
- `payload`: 아래 유형별 최소 정보

식사 후보:
```json
{
  "schema_version": 1,
  "candidate_type": "meal",
  "source": "chatgpt",
  "source_ref": "opaque-message-reference",
  "idempotency_key": "chatgpt_request_001",
  "created_at": "2026-11-01T05:30:00Z",
  "payload": {
    "menu_name": "돈코츠 라멘",
    "place_name": "멘야하나",
    "verdict": "LIKE",
    "note": "진하고 맛있었다"
  }
}
```

이 후보의 `eaten_at`은 의도적으로 비어 있다. 대화 시각과 실제 먹은 날짜가 다를 수 있기 때문이다. 후보에서 `eaten_at`, `place_name`, `verdict`, `reorder_intent`는 선택 사항이며 확정 전에 추가 확인할 수 있다.

위시 후보:
```json
{
  "schema_version": 1,
  "candidate_type": "wish",
  "source": "claude",
  "source_ref": "opaque-message-reference",
  "idempotency_key": "claude_wish_001",
  "created_at": "2026-11-01T05:30:00Z",
  "payload": {
    "wish_kind": "visit_place",
    "name": "가보고 싶은 식당",
    "source_url": "https://example.com/place"
  }
}
```

외부 참고 URL은 HTTPS만 허용한다. 후보 필드에 `status=confirmed`, 원문 대화 전체, 임의의 메타데이터를 주입하는 것은 계약 검증을 통과하지 못한다.

## 안전한 후보와 실제 기록의 분리

- 후보를 수신한 시점에는 `Archive.records`, `Archive.wishes`의 개수가 **변하면 안 된다**.
- 식사 기록 생성 전 사용자에게 실제로 먹은 메뉴인지 확인한다.
- 같은 이름의 돈코츠 라멘이라도 **지점·주소·실제 장소 ID** 없이 다른 가게의 식사 기록과 합치지 않는다.
- 사용자가 취향을 긍정적으로 말한 것과 재주문 의사가 있다는 것은 서로 다르다. 기록할 때 분리한다.
- `markCandidateConfirmed`는 저장소 트랜잭션이 성공한 뒤의 엔터티 ID를 확인하는 순수 상태 처리이며, 저장소 쓰기나 인증 자체를 구현하지 않는다.
- P2-C의 로컬 순수 함수는 **서버에서 발신자의 신원을 인증했다는 뜻이 아니다**.

## 예상되는 P3 서버 기능 (미구현)

- `POST /v1/inbox/candidates`: 인증된 사용자의 후보 생성 (source + idempotency_key unique)
- `GET /v1/inbox/candidates?site=palate`: 인증된 개인 보류 후보 조회
- `POST /v1/inbox/:key/confirm`: 본인이 확인한 후보 확정 요청. 확정 엔터티 ID/리비전 기록
- `POST /v1/inbox/:key/reject`: 후보 거절
- `GET /v1/changes?cursor=...`: 여러 기기 동기화 인터페이스 (예정)

**API 경로는 제안이며 현재 배포된 서버가 아님.**

## 보안·운영 수칙

- Github Pages 클라이언트나 공개 GitHub 저장소에 장기 비밀 키를 포함하지 않는다.
- P3에서는 실제 사용자 신원 인증, 사용자별 데이터 격리, 제한된 scope, 요청 크기/속도 제한, 재전송 방지와 감사 기록을 추가한다.
- 사용자가 ChatGPT와 Claude의 대화를 연결하려면 각 서비스가 지원하는 인증된 액션/연결 경로가 필요하다. 이 코드는 외부 서비스 연결 능력을 자동으로 제공하지 않는다.
- 개인 음식 기록과 사진을 GitHub Pages 공개 정적 JSON에 올리지 않는다.
- 후보 접수는 실제 확정이 아니며, 서버 ACK와 로컬 커밋이 분리될 때 중복·충돌을 다루는 outbox가 필요하다.

## 다음 구현 범위

1. 후보 데이터를 사용자별로 영구 저장하는 인증된 Inbox 백엔드 선택
2. PALATE의 후보 승인 화면(중복 장소·메뉴 매칭, 날짜·평가 수정), 저장 성공 뒤 상태 전환
3. P2-B의 기기별 revision과 P3 서버 revision·outbox 연계
4. ChatGPT/Claude 연결 경로 실제 인증 시험 및 첫 end-to-end 후보 → 승인 → 반영 테스트

디자인·사진 레이아웃 미세 수정은 후순위다.
