# PALATE P2 → P3 저장·연결 아키텍처 (2026-11-01)

## 목표와 기본 원칙

- 최우선 과제: P2 저장 안정성 및 사진 분리 → P3 대화형 Life Hub 연결. 디자인 미세 조정은 그 뒤.
- 기존 개인 데이터는 GitHub가 아닌 해당 브라우저의 localStorage 저장 키 palate.archive.v1에 있다.
- 기존 메뉴/가게/기록/사진/관심표시/릴스의 ID와 평가를 변형하거나 추측해서 덮어쓰지 않는다.
- ChatGPT/Claude는 직접 식사 확정 레코드를 쓰지 않는다. 후보 → 사용자 확인 → 확정.
- 불필요한 서버·Supabase 관리 부담을 최소화하되, 보안과 동기화의 필수 요건은 생략하지 않는다.

## 현재 코드의 문제

| 위치 | 상태 | 주요 위험 |
| --- | --- | --- |
| App.tsx load/commit | 매 입력 때 전체 Archive를 읽고 한 번에 다시 쓰는 동기 localStorage | 이미지가 많을수록 직렬화·quota 문제 |
| lib/data.ts | 스키마 2 강한 검증, persistArchive 전량 JSON 저장 | 사진 base64 포함, 외부 쓰기 불가 |
| lib/photos.ts | 1600px WebP로 압축, data URL | 사진을 구조화해 별도 저장하지 못함 |
| Settings.tsx | JSON 사진 포함 백업, CSV 내보내기 | 내보낸 파일의 실제 보관 여부는 확인할 수 없음 |
| data.ts removePlace | 장소 삭제 시 과거 식사의 place_id를 비움 | 역사적 장소 맥락 손실 |
| App.tsx storage 이벤트 | 다른 탭 수신 | 개별 트랜잭션·revision 기반 충돌 통제 부족 |
| GitHub Pages | 정적 웹앱 | Life Hub가 로컬 브라우저에 직접 원격 기록할 수 없음 |

## 목표 구조

ChatGPT / Claude
  → (P3, 인증된 API) Life Hub 후보 Inbox, 출처·멱등키
  → (P3, 동기화) PALATE 수신 후보·승인 플로우
  → (P2, 로컬 저장 추상화) IndexedDB 텍스트 및 관계 엔터티 + 개별 사진 Blob
  → (P2, 백업) 기존 v2와 새 포맷을 모두 읽는 휴대 가능한 내보내기
  → (P3, outbox) 확인된 로컬 기록을 서버에 재시도 가능한 동기화

**IndexedDB는 기기 간 공유 DB도 아니고 클라우드 백업도 아니다.**
ChatGPT/Claude가 비동기로 기록 후보를 보내려면 로그인·인증된 작은 원격 Inbox 서비스가 따로 필요하다.
개인 기록을 공개 GitHub 저장소나 GitHub Pages 정적 파일에 올리지 않는다.

## P2-A — 이 PR에서 수행

1. 기존 localStorage v2 원본을 검증해 사용자가 설정에서 명시적으로 요청한 경우에만 IndexedDB 검사용 사본을 만든다.
2. 사진은 사본에서 개별 Blob으로 분리하고, 나머지는 원본 엔터티·ID를 유지한다.
3. 사본을 다시 읽고 모든 사진을 재구성한 후 기존 validateArchive, SHA-256 체크섬, 전체 JSON 동일성을 검증한다.
4. 사본 저장은 단일 IndexedDB 트랜잭션으로 처리한다. quota/검증 실패/원본 변경 시 성공 처리하지 않으며 기존 로컬 원본은 건드리지 않는다.
5. 별도의 JSON 백업 파일을 사용자가 다른 위치에 보관하도록 안내한다. IndexedDB 사본 자체는 독립된 백업이 아니다.
6. **기존 앱의 읽기·쓰기 위치는 바꾸지 않는다.** 이번 단계는 준비 및 검증이며 실제 전환이 아니다.

## P2-B — 후속 별도 PR: 실제 저장소 전환

1. 비동기 Repository 인터페이스와 원자적 갱신·revision을 도입한다. 다중 탭 갱신 충돌과 실패한 쓰기를 테스트한다.
2. IndexedDB에 Archive 메타데이터와 개별 사진 Blob을 보관한다. 렌더링 시 object URL 생성·해제를 체계화한다.
3. 부팅 시 검증된 새 저장소를 읽고, 실패 시 원본 localStorage에서 복구할 수 있게 한다. 서로 다른 두 아카이브가 존재하면 자동 병합하거나 한쪽을 버리지 않는다.
4. 예전 JSON 백업을 그대로 가져오고, 사진이 포함된 이식 가능한 JSON을 계속 내보낼 수 있도록 한다.
5. JSON 백업·복구, 저장 공간 부족, 사진 6장, IndexedDB 차단, iOS Safari/PWA, 여러 탭, 오프라인 회귀 테스트.
6. 장소/메뉴 삭제 시 기본 동작은 보관으로 바꾸고, 실제 식사와 장소 연결이 소실되지 않게 한다.
7. 검증 후에도 레거시 원본을 자동 삭제하지 않는다. 사용자가 별도 백업을 보유해야 최종 정리할 수 있다.

## P2-C — P3 준비

- 엔터티의 revision, 갱신시간, 출처, 삭제 표시(tombstone)를 정한다.
- 네트워크 실패 시 동작하는 outbox 및 ACK 전 재시도, idempotency_key 기반 중복 방지.
- 장소·가게 지점 ID와 메뉴 ID를 명확히 구분한다. 같은 메뉴 이름만으로 다른 가게의 평가를 합치지 않는다.
- 충돌을 사용자 몰래 마지막 값으로 덮어쓰는 방식은 피한다.

## P3 — 최소 Life Hub Inbox

- ChatGPT/Claude가 공통 API에 인증 후 후보를 생성한다.
- 예시 API: POST /inbox/candidates, GET /inbox/candidates, POST /inbox/:id/confirm.
- 후보 계약 예: type=meal; source=chatgpt; source_ref=...; idempotency_key=...; status=candidate; payload.menu_name=돈코츠 라멘; payload.place_name=멘야하나; sentiment=LIKE.
- 실제로 먹었다는 증거/날짜가 불명확하면 확정 레코드로 넣지 않는다.
- 승인 시 기존 가게·메뉴 매칭 또는 명시적 신규 생성; 승인 재시도에도 식사 레코드는 정확히 하나만 생성.
- 좁은 범위의 인증된 서비스부터 시작하며 Supabase는 필수 사항으로 전제하지 않는다. 기존 사용 데이터와 개인정보의 공개 저장은 금지한다.

## 이번 PR에서 하지 않는 것

자동 원본 삭제·전량 이동, 기본 읽기/쓰기 저장소 전환, 클라우드 사진 업로드, 원격 계정 생성, 실제 Life Hub 서버 배포, 디자인 리뉴얼.
