// ════════════════════════════════════════════════════════════
//  김해율하고등학교 통합 모바일 앱 — Code.gs
//  ★ 기존 진로진학 AI 프로젝트의 Code.gs를 이 파일로 덮어쓰세요
//
//  포함 기능:
//  • 진로진학 AI 채팅 (Gemini 2.5 Flash + 드라이브 RAG)
//  • 대입 일정 캘린더 (같은 프로젝트 → events 데이터 자동 공유)
//  • 학부모 가정 알림판 (율하TV의 TV3 드라이브 폴더 직접 읽기)
//  • 자동 로그인 (아이디·비밀번호 기억)
// ════════════════════════════════════════════════════════════

var SCHOOL_NAME = '김해율하고등학교';
var PROPS       = PropertiesService.getScriptProperties();

// 학부모 TV (TV3) — 율하TV 송출 앱의 학부모TV 폴더 ID
// (율하TV가 같은 폴더에 파일을 올리면 학부모 앱에서 그대로 보임)
var TV3_FOLDER_ID = '199YWDq-br6haQQKS1-OaIehOPjD9gG1Y';
var TV3_META_KEY  = 'meta_tv3_';

// 가정 알림판은 24시간 접근 가능 → 시간대 슬롯 무시
var IGNORE_TIME_SLOTS_FOR_HOME = true;


// ════════════════════════════════════════════════════════════
//  🔧 진단 도구 (편집기에서 직접 실행)
// ════════════════════════════════════════════════════════════

/**
 * 현재 프로젝트의 PropertiesService에 어떤 데이터가 저장돼 있는지 확인
 * → Apps Script 편집기에서 이 함수를 선택하고 ▶ 실행 → 로그 보기
 */
function diagnose() {
  var all = PROPS.getProperties();
  Logger.log('═══════ 진단 시작 ═══════');
  Logger.log('전체 키 개수: ' + Object.keys(all).length);
  Logger.log('전체 키 목록: ' + Object.keys(all).join(', '));

  // events 키 상세 확인
  var rawEvents = PROPS.getProperty('events');
  if (!rawEvents) {
    Logger.log('❌ "events" 키가 없습니다. 이 프로젝트에는 캘린더 데이터가 저장돼 있지 않습니다.');
  } else {
    var evts = JSON.parse(rawEvents);
    var dates = Object.keys(evts);
    Logger.log('✅ "events" 키 발견 — 등록된 날짜 ' + dates.length + '개');
    Logger.log('날짜 목록: ' + dates.sort().join(', '));

    // 첫 3개 일정 샘플 출력
    var sample = dates.slice(0, 3).map(function(d){
      return d + ' → ' + JSON.stringify(evts[d]);
    }).join('\n');
    Logger.log('샘플:\n' + sample);
  }

  // 다른 캘린더 관련 키 점검 (혹시 이름이 다를 수 있음)
  var calLike = Object.keys(all).filter(function(k){
    return /event|calendar|일정|schedule/i.test(k);
  });
  if (calLike.length) {
    Logger.log('🔎 캘린더 관련 의심 키: ' + calLike.join(', '));
  }

  Logger.log('═══════ 진단 끝 ═══════');
  return {
    keyCount: Object.keys(all).length,
    keys: Object.keys(all),
    hasEvents: !!rawEvents,
    eventDates: rawEvents ? Object.keys(JSON.parse(rawEvents)) : []
  };
}

/**
 * 다른 프로젝트(기존 진로진학 AI)에서 events 데이터를 가져와 이 프로젝트에 복원
 * → 기존 프로젝트의 Apps Script 편집기에서 dumpEventsAsJson()을 실행 →
 *   출력된 JSON 문자열을 복사 → 이 프로젝트에서 restoreEventsFromJson(JSON문자열) 실행
 */
function dumpEventsAsJson() {
  var raw = PROPS.getProperty('events');
  if (!raw) {
    Logger.log('이 프로젝트에는 events 데이터가 없습니다.');
    return '';
  }
  Logger.log('═══ 아래 JSON 전체를 복사해서 복원하려는 프로젝트의 restoreEventsFromJson() 인자로 전달하세요 ═══');
  Logger.log(raw);
  Logger.log('═══ 끝 (길이: ' + raw.length + ' 문자) ═══');
  return raw;
}

function restoreEventsFromJson(jsonStr) {
  if (!jsonStr || typeof jsonStr !== 'string') {
    throw new Error('JSON 문자열을 인자로 전달하세요. 예: restoreEventsFromJson(\'{"2026-05-15":[...]}\')');
  }
  var parsed = JSON.parse(jsonStr); // 형식 검증
  PROPS.setProperty('events', jsonStr);
  Logger.log('✅ ' + Object.keys(parsed).length + '개 날짜 복원 완료');
  return { success: true, dates: Object.keys(parsed).length };
}

/**
 * 테스트용 샘플 일정 1개 등록 — 캘린더 화면에 보이는지 확인용
 */
function addTestEvent() {
  var today = new Date();
  var y = today.getFullYear();
  var m = today.getMonth() + 1;
  var d = today.getDate();
  var key = y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);

  var events = PROPS.getProperty('events');
  events = events ? JSON.parse(events) : {};
  if (!events[key]) events[key] = [];
  events[key].push({
    title: '테스트 일정 (연동 확인용)',
    dept: '시스템',
    time: '00:00',
    loc: '테스트',
    desc: '이 일정이 캘린더에 보이면 연동 정상.'
  });
  PROPS.setProperty('events', JSON.stringify(events));
  Logger.log('✅ ' + key + '에 테스트 일정 등록 완료. 앱에서 새로고침해서 확인하세요.');
}


// ── 최초 1회 실행 ─────────────────────────────────────────
function setupAll() {
  // 일반(학부모/학생) + 관리자 계정
  var users = {
    '김해율하고': '2011',
    '성중재':     '4321'
  };
  PROPS.setProperty('auth_users', JSON.stringify(users));

  // Gemini API 키
  PROPS.setProperty('gemini_api_key', 'AIzaSyA-WW1OOxQJISle6dx81KqPb26c4E36H-A');

  // 진로진학 RAG용 드라이브 파일 ID
  PROPS.setProperty('drive_file_ids', '1HSvOJUD2eo3aPF8YC_3_rduw9_dwjUKC');

  Logger.log('✅ 통합 앱 설정 완료');
}


// ── 웹앱 진입점 ───────────────────────────────────────────
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(SCHOOL_NAME + ' 진로·알림판')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// ════════════════════════════════════════════════════════════
//  1. 진로진학 AI 채팅 (Gemini 2.5 Flash + Drive RAG)
//     ★ 기존 함수명 chatWithGroq 유지 (이름만 그대로, 실제 모델은 Gemini)
// ════════════════════════════════════════════════════════════

var BASE_SYSTEM_PROMPT =
'당신은 김해율하고등학교 전용 진로진학 AI 상담사입니다.\n\n' +
'[절대 규칙]\n' +
'- 반드시 순수한 한국어로만 답변합니다.\n' +
'- 한자, 영어, 일본어, 중국어, 러시아어 등 어떤 외국어도 절대 사용하지 않습니다.\n' +
'- 외래어가 필요한 경우 한글로 표기합니다. 예: 에세이, 인터뷰 등\n\n' +
'[역할]\n' +
'- 김해율하고 학생과 학부모의 진로·진학 관련 질문에 답변합니다.\n' +
'- 대입 전형(수시·정시), 학생부, 내신, 면접, 고교학점제 등을 안내합니다.\n' +
'- 학교 특성에 맞는 현실적이고 구체적인 조언을 제공합니다.\n\n' +
'[답변 원칙]\n' +
'- 반드시 아래 [참고 자료]에 있는 내용을 우선적으로 활용하여 답변합니다.\n' +
'- 참고 자료에 없는 내용은 "해당 내용은 자료에 없습니다. 담임 선생님께 확인하세요."라고 안내합니다.\n' +
'- 답변은 핵심만 담아 너무 길지 않게 작성합니다.\n' +
'- 마크다운 형식(**, ## 등)은 사용하지 않고 자연스러운 문장으로 답변합니다.';

function getDriveFileContents() {
  var idsRaw = PROPS.getProperty('drive_file_ids') || '';
  if (!idsRaw.trim()) return '';
  var ids = idsRaw.split(',').map(function(s){return s.trim();}).filter(Boolean);
  var combined = '';
  ids.forEach(function(id){
    try {
      var file = DriveApp.getFileById(id);
      combined += '\n\n' + file.getBlob().getDataAsString('UTF-8');
    } catch(e) {
      Logger.log('파일 읽기 실패: ' + id + ' / ' + e.message);
    }
  });
  return combined.trim();
}

function chatWithGroq(messages) {
  var apiKey = PROPS.getProperty('gemini_api_key');
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
    return { error: 'Gemini API 키가 설정되지 않았습니다. setupAll()을 실행해 주세요.' };
  }

  var driveContent = getDriveFileContents();
  var systemPrompt = driveContent
    ? BASE_SYSTEM_PROMPT + '\n\n[참고 자료]\n' + driveContent
    : BASE_SYSTEM_PROMPT;

  var contents = messages.map(function(m){
    return {
      role:  m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    };
  });

  var payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: contents,
    generationConfig: { maxOutputTokens: 1024, temperature: 0.3 }
  };

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;

  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var result = JSON.parse(response.getContentText());
    if (result.error) return { error: result.error.message };
    var text = result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts[0] && result.candidates[0].content.parts[0].text;
    if (!text) return { error: '응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    return { reply: text };
  } catch(e) {
    return { error: '네트워크 오류가 발생했습니다.' };
  }
}


// ════════════════════════════════════════════════════════════
//  2. 캘린더 CRUD
//  ★ 같은 프로젝트에 배포하면 PROPS의 'events' 키가 자동 공유됨
//  ★ 기존 진로진학 AI에 등록한 일정이 그대로 보입니다
// ════════════════════════════════════════════════════════════

function getEvents() {
  var raw = PROPS.getProperty('events');
  if (!raw) {
    Logger.log('[getEvents] "events" 키 없음. diagnose() 실행으로 점검하세요.');
    return {};
  }
  try {
    var parsed = JSON.parse(raw);
    Logger.log('[getEvents] ' + Object.keys(parsed).length + '개 날짜 반환');
    return parsed;
  } catch(e) {
    Logger.log('[getEvents] JSON 파싱 실패: ' + e.message);
    return {};
  }
}

function saveEvent(date, eventData, index, token) {
  if (!verifyAdminToken(token)) throw new Error('관리자 권한이 필요합니다.');
  var events = getEvents();
  if (!events[date] || !Array.isArray(events[date])) {
    events[date] = events[date] ? [events[date]] : [];
  }
  if (index !== undefined && index !== null && index >= 0) {
    events[date][index] = eventData;
  } else {
    events[date].push(eventData);
  }
  PROPS.setProperty('events', JSON.stringify(events));
  return events;
}

function deleteEvent(date, index, token) {
  if (!verifyAdminToken(token)) throw new Error('관리자 권한이 필요합니다.');
  var events = getEvents();
  if (events[date] && Array.isArray(events[date])) {
    events[date].splice(index, 1);
    if (events[date].length === 0) delete events[date];
  } else {
    delete events[date];
  }
  PROPS.setProperty('events', JSON.stringify(events));
  return events;
}


// ════════════════════════════════════════════════════════════
//  3. 인증 (로그인/로그아웃/토큰)
//  ★ 같은 프로젝트라서 sessions 키도 자동 공유
// ════════════════════════════════════════════════════════════

function login(username, password) {
  var usersJson = PROPS.getProperty('auth_users');
  if (!usersJson) return { success: false, message: '계정 정보가 없습니다. setupAll()을 실행하세요.' };

  var users = JSON.parse(usersJson);
  if (users[username] && users[username] === password) {
    var token  = Utilities.getUuid();
    var expiry = new Date().getTime() + 30 * 24 * 60 * 60 * 1000; // 30일
    var sessions = JSON.parse(PROPS.getProperty('sessions') || '{}');
    sessions[token] = { username: username, expiry: expiry };
    PROPS.setProperty('sessions', JSON.stringify(sessions));
    return { success: true, token: token, username: username };
  }
  return { success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' };
}

// 기존 코드 호환을 위해 boolean 반환 (있으면 true)
function verifyToken(token) {
  return !!_getSessionUsername(token);
}

function verifyAdminToken(token) {
  return _getSessionUsername(token) === '성중재';
}

// 자동 로그인 검증 — 토큰이 유효하면 사용자명 반환
function checkSession(token) {
  var username = _getSessionUsername(token);
  if (username) return { success: true, username: username };
  return { success: false };
}

function logout(token) {
  var sessions = JSON.parse(PROPS.getProperty('sessions') || '{}');
  delete sessions[token];
  PROPS.setProperty('sessions', JSON.stringify(sessions));
  return true;
}

function _getSessionUsername(token) {
  if (!token) return null;
  var sessions = JSON.parse(PROPS.getProperty('sessions') || '{}');
  var s = sessions[token];
  if (!s) return null;
  if (new Date().getTime() > s.expiry) {
    delete sessions[token];
    PROPS.setProperty('sessions', JSON.stringify(sessions));
    return null;
  }
  return s.username;
}


// ════════════════════════════════════════════════════════════
//  4. 학부모 가정 알림판
//  ★ 율하TV의 학부모TV(TV3) 드라이브 폴더를 직접 읽음
//  ★ 율하TV에서 파일을 올리면 → 학부모 앱에 자동 노출됨
// ════════════════════════════════════════════════════════════

var IMAGE_MIMES = {
  'image/jpeg':1,'image/jpg':1,'image/png':1,
  'image/gif':1,'image/webp':1,'image/bmp':1
};
var VIDEO_MIMES = {
  'video/mp4':1,'video/mpeg4':1,'video/x-m4v':1,
  'video/quicktime':1,'video/x-msvideo':1,
  'video/webm':1,'video/x-ms-wmv':1,'video/3gpp':1
};

function getHomeNotices() {
  try {
    var folder = DriveApp.getFolderById(TV3_FOLDER_ID);
    var today  = _todayStr();
    var result = [];

    var it = folder.getFiles();
    while (it.hasNext()) {
      var file = it.next();
      var mime = (file.getMimeType() || '').toLowerCase();
      var type = null;
      if (IMAGE_MIMES[mime])      type = 'image';
      else if (VIDEO_MIMES[mime]) type = 'video';
      if (!type) continue;

      var id      = file.getId();
      // 메타데이터는 같은 프로젝트의 PROPS에서 읽음.
      // 율하TV가 별도 프로젝트라면 메타데이터는 없을 수 있으며,
      // 그 경우 모든 파일을 표시(아래 _isPlayable이 빈 메타데이터를 통과시킴)
      var metaStr = PROPS.getProperty(TV3_META_KEY + id);
      var meta    = metaStr ? JSON.parse(metaStr) : {};

      var notice = {
        id:           id,
        name:         file.getName(),
        type:         type,
        mimeType:     file.getMimeType() || (type === 'video' ? 'video/mp4' : 'image/jpeg'),
        size:         file.getSize(),
        modifiedTime: file.getLastUpdated().toISOString(),
        startDate:    meta.startDate || '',
        endDate:      meta.endDate   || '',
        memo:         meta.memo      || '',
        timeSlots:    meta.timeSlots || []
      };

      if (!_isPlayable(notice, today)) continue;
      result.push(notice);
    }

    result.sort(function(a, b) {
      var aStart = a.startDate || a.modifiedTime;
      var bStart = b.startDate || b.modifiedTime;
      return new Date(bStart) - new Date(aStart);
    });

    return { success: true, notices: result, count: result.length };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function _isPlayable(f, today) {
  // 메타데이터가 있을 때만 날짜 필터 적용. 없으면 항상 표시.
  if (f.startDate && f.startDate > today) return false;
  if (f.endDate   && f.endDate   < today) return false;
  if (IGNORE_TIME_SLOTS_FOR_HOME) return true;
  return true;
}


// ════════════════════════════════════════════════════════════
//  5. 공유 자료 폴더 파일 목록 (대입 설명회 / 전형 요강)
//     앱 내에서 파일 목록 보고 다운로드/미리보기 가능
// ════════════════════════════════════════════════════════════

// 공유 자료 폴더 ID
var SHARE_FOLDERS = {
  briefing:  '1Zzc6yxO4QAIIikNlyDF_KhW0673wjDCv',  // 대입 설명회 배포 자료집
  admission: '1SgEzFPVmf8uBIoIHg2QGdYOQ9-_Ngs-3'   // 최신 수시/정시 전형 요강
};

function getShareFiles(folderKey) {
  try {
    var folderId = SHARE_FOLDERS[folderKey];
    if (!folderId) return { success: false, error: '알 수 없는 폴더입니다.' };

    var folder = DriveApp.getFolderById(folderId);
    var result = [];

    var it = folder.getFiles();
    while (it.hasNext()) {
      var file = it.next();
      var mime = file.getMimeType() || '';
      var name = file.getName();

      // 파일 종류 판별
      var type = 'file';
      if (mime.indexOf('pdf')   !== -1) type = 'pdf';
      else if (mime.indexOf('image') !== -1) type = 'image';
      else if (mime.indexOf('video') !== -1) type = 'video';
      else if (mime.indexOf('word')  !== -1 || mime.indexOf('document') !== -1) type = 'doc';
      else if (mime.indexOf('sheet') !== -1 || mime.indexOf('excel')    !== -1) type = 'sheet';
      else if (mime.indexOf('presentation') !== -1 || mime.indexOf('powerpoint') !== -1) type = 'slide';

      result.push({
        id:           file.getId(),
        name:         name,
        type:         type,
        mimeType:     mime,
        size:         file.getSize(),
        modifiedTime: file.getLastUpdated().toISOString(),
        viewUrl:      'https://drive.google.com/file/d/' + file.getId() + '/view',
        downloadUrl:  'https://drive.google.com/uc?export=download&id=' + file.getId(),
        previewUrl:   'https://drive.google.com/file/d/' + file.getId() + '/preview'
      });
    }

    // 폴더 안의 하위 폴더도 (한 단계만) 포함
    var folders = folder.getFolders();
    var subfolders = [];
    while (folders.hasNext()) {
      var sub = folders.next();
      subfolders.push({
        id: sub.getId(),
        name: sub.getName(),
        url: 'https://drive.google.com/drive/folders/' + sub.getId()
      });
    }

    // 최신 수정일 순 정렬
    result.sort(function(a, b) {
      return new Date(b.modifiedTime) - new Date(a.modifiedTime);
    });

    return {
      success: true,
      files: result,
      subfolders: subfolders,
      count: result.length
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}


function _todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + _pad2(d.getMonth() + 1) + '-' + _pad2(d.getDate());
}
function _pad2(n) { return n < 10 ? '0' + n : String(n); }
