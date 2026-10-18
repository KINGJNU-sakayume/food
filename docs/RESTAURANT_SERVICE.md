# 음식점 정보 연결

개인 데이터는 localStorage + JSON으로 유지합니다. `server/`는 외부 공개 정보 조회만 수행하는 선택적 Cloudflare Worker이며 사용자 기록을 저장하는 데이터베이스가 없습니다.

## 실제 지원 범위

| 기능 | 기본 정적 앱 | 선택적 조회 서비스 |
| --- | --- | --- |
| 프랜차이즈 수록 메뉴 | 로컬 JSON에서 제공 | 필요 없음 |
| 음식점 이름 검색 | Photon / OpenStreetMap | 네이버 지역 검색 API |
| 공유한 릴스·음식점 링크 보관 | 브라우저에서 제공 | 필요 없음 |
| 개별 음식점 메뉴 자동 조회 | 연결 전에는 제공하지 않음 | 허용한 공개 페이지의 명시적 메뉴 데이터 파싱 |

네이버 지역 검색 API에는 메뉴 목록 필드가 없습니다. 이 Worker는 그 API를 메뉴 API라고 취급하지 않습니다. 메뉴는 공개 페이지에 실제로 들어 있는 JSON-LD `MenuItem`, 명시적 `Menu`/`RestaurantMenu` JSON에서만 읽습니다. 페이지가 차단되거나 메뉴 정보가 없으면 `unavailable` 또는 조회 오류를 반환합니다. 인증된 앱 전용 API, 로그인 세션이나 봇 차단 우회는 사용하지 않습니다. 배민 링크도 저장·열기는 가능하지만 모든 링크에서 메뉴를 읽을 수 있다는 보장은 없습니다.

## 배포

1. Cloudflare 계정에서 Worker 배포 권한을 준비합니다.
2. `server/wrangler.toml`의 `ALLOWED_ORIGIN`을 PALATE의 정확한 origin으로 설정합니다. `/food/` 같은 경로는 포함하지 않습니다.
3. 메뉴를 읽을 식당의 공식 웹사이트 도메인을 `ALLOWED_MENU_HOSTS`에 쉼표로 나열합니다. 네이버·배민 공유 도메인은 코드의 제한된 목록에 있습니다. 임의의 주소를 가져오는 공개 프록시로 동작하지 않습니다.
4. 네이버 개발자 센터에서 검색 API를 사용할 애플리케이션을 준비하고 서버 비밀 값으로 등록합니다.

```sh
cd server
npx wrangler secret put NAVER_CLIENT_ID
npx wrangler secret put NAVER_CLIENT_SECRET
npx wrangler deploy
```

비밀 값은 명령줄 인수·GitHub 소스·`VITE_` 변수·localStorage에 넣지 않습니다. CLI가 묻는 입력창에 입력합니다. 공개 페이지 메뉴 조회만 사용할 경우 네이버 검색 키는 필요 없지만 이 서버의 `/search`는 사용할 수 없습니다.

5. PALATE 설정의 **음식점 정보 연결 · 고급 설정**에서 배포된 Worker의 `https://...workers.dev` 주소를 저장합니다. 또는 빌드할 때 `VITE_RESTAURANT_API_URL`에 **공개 서비스 주소만** 지정할 수 있습니다.

조회 서비스가 연결되지 않았거나 실패해도 기존 음식점·메뉴·평가·관심 표시는 지우지 않습니다. 가져온 메뉴는 기존 메뉴 ID와 이름을 우선 보존하며 가격만 확인된 경우 갱신하고, 새 메뉴만 추가합니다. 목록에서 누락된 메뉴를 자동 삭제하거나 단종으로 단정하지 않습니다.

## 인터페이스

`GET /search?q=이름` → `{ results: [{ name, address, source_url?, external_provider?, external_place_id? }] }`

`GET /details?url=공개음식점주소` → 아래 형태를 반환합니다.

```json
{
  "name": "음식점 이름",
  "address": "주소",
  "source_url": "https://restaurant.example/menu",
  "menu_status": "available",
  "checked_at": "2026-10-18T00:00:00Z",
  "menus": [{ "name": "메뉴 이름", "external_id": "원본ID", "price": 10000 }]
}
```

다른 서비스도 이 인터페이스를 구현해 연결할 수 있습니다. `price`는 확인된 원화 금액만 전달합니다. 알 수 없는 금액을 0원으로 만들지 않습니다. 클라이언트에서 응답의 문자열·참조·이미지 주소 형식을 다시 검증합니다.

## 검증과 남은 연결 조건

메뉴 파서는 실제 형식의 JSON-LD·공개 JSON 픽스처와 누락·오류·금액 처리 테스트를 포함합니다. 브라우저 테스트는 조회 응답을 가져와 저장하고, 이후 조회 실패에도 기존 정보가 보존되는지 확인합니다. 이 테스트를 특정 음식점 사이트의 현재 가용성을 확인한 것으로 간주하지 않습니다.

조회 Worker 배포와 네이버 API 자격 증명은 저장소 코드 추가만으로 만들어지지 않습니다. 사용자의 실제 서비스 주소와 자격 증명이 준비되어야 운영 연결을 완료할 수 있습니다.
