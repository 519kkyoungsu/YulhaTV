// ============================================================
//  김해율하고등학교 공지 디스플레이 — Code.gs (통합본)
//  • 관리자 앱  : 3채널 (TV1 중앙현관 / TV2 복도 / TV3 학부모)
//  • 학부모 앱  : 학부모 TV 폴더의 공지를 가정에서 열람
//
//  접속 URL:
//    관리자  →  [웹앱URL]                  (또는 ?view=admin)
//    학부모  →  [웹앱URL]?view=home
// ============================================================

// ── 채널별 설정 ────────────────────────────────────────────
var CHANNELS = {
  tv1: {
    name:     '중앙현관 TV',
    folderId: '1I9lE8O-xRSuk-_ohKU8cg59QVds7d9Od',
    metaKey:  'meta_tv1_'
  },
  tv2: {
    name:     '복도 TV',
    folderId: '1ZS5SwN3JVPAJuI1ObAPQ9t2UkHAB2brX',
    metaKey:  'meta_tv2_'
  },
  tv3: {
    name:     '학부모 TV',
    folderId: '199YWDq-br6haQQKS1-OaIehOPjD9gG1Y',
    metaKey:  'meta_tv3_'
  }
};

var SCHOOL_NAME = '김해율하고등학교';
var PROPS       = PropertiesService.getScriptProperties();

// 동영상 base64 프리로드 한도 (45MB) — Apps Script 응답 한도(~50MB) 고려
var VIDEO_BASE64_MAX_BYTES = 45 * 1024 * 1024;

// 가정 알림판은 24시간 접속 가능하므로 시간대 슬롯을 무시할지 결정
// true  → 날짜 기간만 검사 (학부모는 언제 봐도 게시 가능한 공지를 모두 봄)
// false → 관리자 앱과 동일하게 현재 시각의 슬롯도 검사
var IGNORE_TIME_SLOTS_FOR_HOME = true;

// 가정 알림판이 기본으로 표시할 채널
var HOME_DEFAULT_CHANNEL = 'tv3';

// ── 시간대 슬롯 (가정 알림판 서버측 검사용) ────────────────
var SERVER_TIME_SLOTS = {
  arrival:   { startMin: 0,           endMin: 8*60+40  },
  morning:   { startMin: 8*60+40,     endMin: 12*60+30 },
  lunch:     { startMin: 12*60+30,    endMin: 13*60+35 },
  afternoon: { startMin: 13*60+35,    endMin: 17*60+30 },
  evening:   { startMin: 17*60+30,    endMin: 18*60+30 },
  always:    { startMin: 0,           endMin: 24*60    }
};

// ── 채널 검증 ──────────────────────────────────────────────
function getChannel(ch) {
  if (!ch || !CHANNELS[ch]) {
    throw new Error('잘못된 채널입니다: ' + ch);
  }
  return CHANNELS[ch];
}

// ══════════════════════════════════════════════════════════════
//  웹앱 진입점 — view 파라미터로 관리자/학부모 분기
// ══════════════════════════════════════════════════════════════
function doGet(e) {
  var view = (e && e.parameter && e.parameter.view) ? e.parameter.view : 'admin';

  if (view === 'home') {
    // 학부모 가정 알림판
    return HtmlService.createHtmlOutputFromFile('IndexHome')
      .setTitle(SCHOOL_NAME + ' 가정 알림판')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
  }

  // 관리자 앱 (기본)
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(SCHOOL_NAME + ' 공지 디스플레이')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// ── 웹앱 배포 URL ───────────────────────────────────────────
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

// ── 채널 정보 일괄 반환 (관리자 앱용) ───────────────────────
function getChannelsInfo() {
  return {
    channels: {
      tv1: { name: CHANNELS.tv1.name },
      tv2: { name: CHANNELS.tv2.name },
      tv3: { name: CHANNELS.tv3.name }
    }
  };
}

// ══════════════════════════════════════════════════════════════
//  ★ 학부모 가정 알림판 전용 API
// ══════════════════════════════════════════════════════════════
function getHomeNotices(channel) {
  try {
    var ch   = channel && CHANNELS[channel] ? channel : HOME_DEFAULT_CHANNEL;
    var conf = CHANNELS[ch];
    var folder = DriveApp.getFolderById(conf.folderId);
    var today  = todayStr_();
    var result = [];

    var IMAGE_MIMES = {
      'image/jpeg':1,'image/jpg':1,'image/png':1,
      'image/gif':1,'image/webp':1,'image/bmp':1
    };
    var VIDEO_MIMES = {
      'video/mp4':1,'video/mpeg4':1,'video/x-m4v':1,
      'video/quicktime':1,'video/x-msvideo':1,
      'video/webm':1,'video/x-ms-wmv':1,'video/3gpp':1
    };

    var it = folder.getFiles();
    while (it.hasNext()) {
      var file = it.next();
      var mime = (file.getMimeType() || '').toLowerCase();
      var type = null;
      if (IMAGE_MIMES[mime])      type = 'image';
      else if (VIDEO_MIMES[mime]) type = 'video';
      if (!type) continue;

      var id      = file.getId();
      var metaStr = PROPS.getProperty(conf.metaKey + id);
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

      if (!isPlayableForHome_(notice, today)) continue;
      result.push(notice);
    }

    // 정렬: 게시 시작일/수정일 기준 최신순
    result.sort(function(a, b) {
      var aStart = a.startDate || a.modifiedTime;
      var bStart = b.startDate || b.modifiedTime;
      return new Date(bStart) - new Date(aStart);
    });

    return { success: true, notices: result, count: result.length, channel: ch };

  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function isPlayableForHome_(f, today) {
  if (f.startDate && f.startDate > today) return false;
  if (f.endDate   && f.endDate   < today) return false;

  if (IGNORE_TIME_SLOTS_FOR_HOME) return true;

  var slots = f.timeSlots || [];
  if (!slots.length) return true;
  if (slots.indexOf('always') !== -1) return true;

  var nm = nowMinutes_();
  for (var i = 0; i < slots.length; i++) {
    var k = slots[i];
    if (!SERVER_TIME_SLOTS[k]) continue;
    if (nm >= SERVER_TIME_SLOTS[k].startMin && nm < SERVER_TIME_SLOTS[k].endMin) return true;
  }
  return false;
}

function todayStr_() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
}
function nowMinutes_() {
  var d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function pad2_(n) { return n < 10 ? '0' + n : String(n); }

// ══════════════════════════════════════════════════════════════
//  관리자 앱 — 파일/메타/업로드/플레이리스트/설정
// ══════════════════════════════════════════════════════════════

// ── 파일 목록 조회 ──────────────────────────────────────────
function getFiles(channel) {
  try {
    var conf = getChannel(channel);
    var folder = DriveApp.getFolderById(conf.folderId);
    var result = [];

    var IMAGE_MIMES = {
      'image/jpeg':1,'image/jpg':1,'image/png':1,
      'image/gif':1,'image/webp':1,'image/bmp':1
    };
    var VIDEO_MIMES = {
      'video/mp4':1,'video/mpeg4':1,'video/x-m4v':1,
      'video/quicktime':1,'video/x-msvideo':1,
      'video/webm':1,'video/x-ms-wmv':1,'video/3gpp':1
    };

    var it = folder.getFiles();
    while (it.hasNext()) {
      var file = it.next();
      var mime = (file.getMimeType() || '').toLowerCase();
      if (IMAGE_MIMES[mime])      result.push(fileToObj(file, 'image', conf));
      else if (VIDEO_MIMES[mime]) result.push(fileToObj(file, 'video', conf));
    }

    result.sort(function(a, b) {
      return new Date(b.modifiedTime) - new Date(a.modifiedTime);
    });
    return { success: true, files: result, channel: channel };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function fileToObj(file, type, conf) {
  var id      = file.getId();
  var metaStr = PROPS.getProperty(conf.metaKey + id);
  var meta    = metaStr ? JSON.parse(metaStr) : {};
  return {
    id:           id,
    name:         file.getName(),
    type:         type,
    mimeType:     file.getMimeType() || (type === 'video' ? 'video/mp4' : 'image/jpeg'),
    size:         file.getSize(),
    modifiedTime: file.getLastUpdated().toISOString(),
    startDate:    meta.startDate  || '',
    endDate:      meta.endDate    || '',
    memo:         meta.memo       || '',
    timeSlots:    meta.timeSlots  || []
  };
}

// ── 게시기간 저장 ───────────────────────────────────────────
function saveMeta(channel, data) {
  try {
    var conf = getChannel(channel);
    PROPS.setProperty(conf.metaKey + data.id, JSON.stringify({
      startDate: data.startDate || '',
      endDate:   data.endDate   || '',
      memo:      data.memo      || '',
      timeSlots: Array.isArray(data.timeSlots) ? data.timeSlots : []
    }));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ── 이미지 Base64 ────────────────────────────────────────────
function getImageBase64(fileId) {
  try {
    var file     = DriveApp.getFileById(fileId);
    var blob     = file.getBlob();
    var mimeType = blob.getContentType();
    var base64   = Utilities.base64Encode(blob.getBytes());
    return { success: true, base64: base64, mimeType: mimeType };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ── 동영상 Base64 (프리로드용, 크기 제한 적용) ──────────────
function getVideoBase64(fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    var size = file.getSize();
    if (size > VIDEO_BASE64_MAX_BYTES) {
      return {
        success: false,
        tooLarge: true,
        size: size,
        sizeMB: Math.round(size / 1048576),
        error: '영상이 너무 큽니다 (' + Math.round(size/1048576) + 'MB). 45MB 이하로 인코딩 권장.'
      };
    }
    var blob     = file.getBlob();
    var mimeType = blob.getContentType() || 'video/mp4';
    var base64   = Utilities.base64Encode(blob.getBytes());
    return { success: true, base64: base64, mimeType: mimeType, size: size };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ── 파일 업로드 ─────────────────────────────────────────────
function uploadFile(channel, data) {
  try {
    var conf = getChannel(channel);
    var mime = data.mimeType;
    if (!mime || mime === 'null' || mime === 'undefined') {
      var ext = data.name.split('.').pop().toLowerCase();
      mime = {
        jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',
        gif:'image/gif',webp:'image/webp',bmp:'image/bmp',
        mp4:'video/mp4',mov:'video/quicktime',
        avi:'video/x-msvideo',webm:'video/webm'
      }[ext] || 'application/octet-stream';
    }
    var folder  = DriveApp.getFolderById(conf.folderId);
    var decoded = Utilities.base64Decode(data.base64);
    var blob    = Utilities.newBlob(decoded, mime, data.name);
    var file    = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { success: true, id: file.getId(), name: file.getName() };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ── 파일 삭제 ───────────────────────────────────────────────
function deleteFile(channel, fileId) {
  try {
    var conf = getChannel(channel);
    DriveApp.getFileById(fileId).setTrashed(true);
    PROPS.deleteProperty(conf.metaKey + fileId);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ── 동영상 길이 조회 ────────────────────────────────────────
function getVideoDuration(fileId) {
  try {
    var url = 'https://www.googleapis.com/drive/v3/files/' + fileId
            + '?fields=videoMediaMetadata';
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    var json = JSON.parse(res.getContentText());
    var ms   = json.videoMediaMetadata && json.videoMediaMetadata.durationMillis;
    if (ms) {
      return { success: true, seconds: Math.ceil(parseInt(ms) / 1000) };
    }
    return { success: true, seconds: 0 };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ── 재생목록 저장/불러오기 ──────────────────────────────────
function savePlaylist(channel, playlist) {
  try {
    getChannel(channel);
    PROPS.setProperty('playlist_' + channel, JSON.stringify(playlist || []));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function loadPlaylist(channel) {
  try {
    getChannel(channel);
    var raw = PROPS.getProperty('playlist_' + channel);
    return { success: true, playlist: raw ? JSON.parse(raw) : [] };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ── 설정 저장/불러오기 ──────────────────────────────────────
function saveSettings(channel, settings) {
  try {
    getChannel(channel);
    PROPS.setProperty('settings_' + channel, JSON.stringify(settings || {}));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function loadSettings(channel) {
  try {
    getChannel(channel);
    var raw = PROPS.getProperty('settings_' + channel);
    var defaults = {
      defDur: 10, clockPos: 'none', fitMode: 'contain', transMode: 'fade',
      loop: true, watermark: true, sound: false
    };
    if (!raw) return { success: true, settings: defaults };
    var saved = JSON.parse(raw);
    for (var k in defaults) {
      if (saved[k] === undefined) saved[k] = defaults[k];
    }
    return { success: true, settings: saved };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}
