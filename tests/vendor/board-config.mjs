// Copied from KINGJNU-sakayume/board js/config.js @ da62c8c8d318998fceab8799af947b4115c33679 (copied 2026-11-08). Test-only; do not edit.
// 보드 설정. 개인 값(좌표, 팀, 키)은 여기에 적지 않는다. 그런 값은 각 위젯의 '위젯 설정'에서 넣고 이 브라우저에만 저장된다.
export const CONFIG = Object.freeze({
  // Life Hub (life-hub docs/P7_BOARD.md). 연결 전에는 예시 데이터(data/sample-tiles.json)를 보여주고,
  // 연결하면 GET /board/v1/tiles 로 앱들이 올린 실제 타일을 읽는다. 바꾸면 index.html CSP connect-src 도 같이.
  hub: {
    origin: 'https://life-hub-api.213303.workers.dev',
    appUrl: 'https://kingjnu-sakayume.github.io/board/',   // 이 주소에서 열렸을 때만 연결할 수 있다(로컬은 예시 모드)
    scope: 'board:read board:sync board:inbox board:propose',
  },
  staleDays: 14,   // Hub가 받은 지 이만큼 지난 앱 목록은 '오래됨'으로 표시

  // 앱이 보낸 표지 이미지는 이 출처에서만 불러온다. 나머지는 글자 칸으로 바꾼다. data:image/ 는 항상 허용.
  imageOrigins: [
    'https://kingjnu-sakayume.github.io',
    'https://image.aladin.co.kr',
    'https://upload.wikimedia.org',
    'https://i.scdn.co',              // Spotify 앨범 표지 (최대 640px, 썸네일용)
    'https://is1-ssl.mzstatic.com',  // Apple Music 표지 (potcast)
    'https://is2-ssl.mzstatic.com',  // Apple Music 표지 (potcast)
    'https://is3-ssl.mzstatic.com',  // Apple Music 표지 (potcast)
    'https://is4-ssl.mzstatic.com',  // Apple Music 표지 (potcast)
    'https://is5-ssl.mzstatic.com',  // Apple Music 표지 (potcast)
    'https://image.tmdb.org',         // TMDB 포스터 (AniMan 작품)
    'https://t1.daumcdn.net',         // 카카오 책 검색 원본 표지 (책장, AniMan 권)
    'https://search1.kakaocdn.net',   // 카카오 책 검색 썸네일 (원본을 못 꺼낼 때)
  ],

  // 타일을 눌렀을 때 여는 앱 주소는 이 출처만 허용한다.
  linkOrigins: ['https://kingjnu-sakayume.github.io'],

  // 그룹 순서와, 앱(Hub 목적지 id)이 처음 놓이는 그룹. 사용자가 옮긴 배치는 따로 저장된다.
  groups: [
    { id: 'day', name: '내 하루', apps: ['board', 'hub', 'memo', 'diaryroulette'] },
    { id: 'media', name: '미디어', apps: ['animan', 'letterbookxd', 'potcast'] },
    { id: 'record', name: '정렬 · 기록', apps: ['elosorter', 'achievement', 'sub'] },
    { id: 'life', name: '장소 · 일상', apps: ['kyeokyeoi', 'food'] },
  ],

  refreshMs: 5 * 60 * 1000,

  // 상세 창의 '… 열기' 같은 곳에 쓰는 앱 이름 (Life Hub src/destinations.js 의 app 이름과 같게)
  appNames: {
    board: '보드', hub: 'Life Hub', memo: 'Claude 메모', animan: 'AniMan', letterbookxd: '책장', potcast: 'potcast', elosorter: 'ELO Sorter',
    achievement: '업적 라이브러리', sub: '역 도장깨기', kyeokyeoi: '켜켜이', food: 'PALATE', diaryroulette: '일기 룰렛',
  },
});

export function groupOfApp(app) {
  const g = CONFIG.groups.find((x) => x.apps.includes(app));
  return g ? g.id : CONFIG.groups[CONFIG.groups.length - 1].id;
}
