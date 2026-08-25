// 2126年 架空iPadOS型 脱出ゲームシステム - アプリ制御ロジック (app.js)

// --- デバッグ用グローバルエラーハンドラー ---
window.onerror = function(message, source, lineno, colno, error) {
  const errMsg = `【JSエラー検知】\nメッセージ: ${message}\nファイル: ${source}\n行番号: ${lineno}:${colno}`;
  console.error(errMsg, error);
  alert(errMsg);
  return false;
};

// --- グローバルステート管理 ---
let gameState = {
  loop: 1,
  teamId: "チームA",
  clockStartISO: "2126-08-22T10:00:00",
  clockSetTime: Date.now(), // 設定されたタイミングの現実タイムスタンプ
  unlockedHints: [],
  manabaUser: null,
  addedFriends: ["jinnai", "fukasawa", "committee_group"], // 初期友達
  activeApp: null,
  activeMetaTab: "rules",
  activeManabaTab: "mypage",
  activeGSheetTab: "名簿データ",
  currentBrowserPage: "home", // home, results, webpage
  browserHistory: [],
  browserSearchQuery: "",
  activeChatContact: null,
  phoneInput: "",
  alertDismissed: true,
  timerInterval: null,
  timeRemaining: 3600 // 60分 (秒単位)
};

// --- PWA Service Worker 登録 ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered.', reg))
      .catch(err => console.log('Service Worker registration failed.', err));
  });
}

// --- データベースキャッシュロード ---
function loadGameDatabase() {
  const cache = localStorage.getItem('game_db_cache');
  if (cache) {
    try {
      const parsed = JSON.parse(cache);
      // スキーマの整合性を検証
      if (parsed && parsed.browser && parsed.linkApp && parsed.manaba && parsed.metaApp) {
        window.GAME_DATABASE = parsed;
        console.log("Loaded game database from LocalStorage cache.");
        return;
      }
      console.warn("Cache data is missing core properties. Falling back to data.js.");
    } catch (e) {
      console.warn("Failed to parse game_db_cache, falling back to data.js");
    }
  }
}

// --- 起動処理 ---
window.addEventListener('DOMContentLoaded', () => {
  try {
    // キャッシュDBの読み込み
    loadGameDatabase();

    // アイコン描画
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }

    // ローカルストレージから状態復元
    loadStateFromStorage();

    // 嘘の時計を開始
    startFakeClock();

    // メモ帳の復元と自動保存イベント
    const memoArea = document.getElementById('meta-memo-area');
    if (memoArea) {
      memoArea.value = localStorage.getItem('game_memo') || '';
      memoArea.addEventListener('input', (e) => {
        localStorage.setItem('game_memo', e.target.value);
      });
    }

    // 操作制限の適用
    applyOperationalRestrictions();

    // LocalStorage変更イベント購読（運営画面からのリアルタイム変更をキャッチ）
    window.addEventListener('storage', handleStorageEvent);

    // ロック解除ボタンのイベント登録
    const unlockBtn = document.getElementById('swipe-to-unlock-btn');
    if (unlockBtn) {
      unlockBtn.addEventListener('click', unlockScreen);
    }

    // 画面上端からの下スワイプでロック画面（カバーシート）を呼び出し
    initTopSwipeForLockScreen();

    // 初期画面構築（ローカルデータで即時描画）
    updateAppUI();
    
    // 60分タイマー開始
    startCountdownTimer();

    // スプレッドシート（Google Sheets / GAS）から10秒おきに自動同期（リロード不要）
    startAutoSpreadsheetSync();

  } catch(startupError) {
    // 起動時エラーを画面に直接表示（デバッグ用）
    document.body.style.background = '#fff';
    document.body.innerHTML = `
      <div style="font-family:monospace; padding:30px; color:#c00; font-size:14px; max-width:600px; margin:0 auto;">
        <h2>⚠️ 起動エラー検知</h2>
        <p style="margin:10px 0;">アプリの起動処理中にJavaScriptエラーが発生しました。</p>
        <pre style="background:#f5f5f5; padding:16px; border-radius:8px; overflow:auto; font-size:12px;">${startupError.stack || startupError.message}</pre>
        <p style="margin-top:10px; color:#666;">このエラー内容をスタッフに報告してください。</p>
      </div>
    `;
  }
});

// --- スプレッドシート（Google Sheets / GAS Web API）からの最新データ自動同期 ＆ 遠隔統制コマンド受信 ---
let lastDataHash = "";
let lastExecutedCommandId = localStorage.getItem('last_exec_cmd_id') || "";
window.CLOUD_SYNC_STATUS = {
  connected: false,
  lastSyncTime: null,
  lastError: null,
  latencyMs: 0
};

function getResolvedGasUrl() {
  const fromStorage = (localStorage.getItem('gas_url') || "").trim();
  if (fromStorage) return fromStorage;
  if (window.GAME_DATABASE && window.GAME_DATABASE.system && window.GAME_DATABASE.system.gasUrl) {
    const fromDb = window.GAME_DATABASE.system.gasUrl.trim();
    if (fromDb) return fromDb;
  }
  return "https://script.google.com/macros/s/AKfycbwKAWMjn0ywOYor7_EQ63HDyoxw_Ag5gH81Efs45ttVKa3vdi6HyOveZrBADpkycIpaYw/exec";
}

function fetchLatestDataFromSpreadsheet() {
  const gasUrl = getResolvedGasUrl();
  if (!gasUrl) {
    window.CLOUD_SYNC_STATUS.connected = false;
    window.CLOUD_SYNC_STATUS.lastError = "GAS URLが設定されていません";
    updateStaffSyncUI();
    return;
  }

  const startTime = Date.now();
  const url = gasUrl.includes('?') ? `${gasUrl}&action=get_data` : `${gasUrl}?action=get_data`;
  
  fetch(url)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
      return res.json();
    })
    .then(json => {
      window.CLOUD_SYNC_STATUS.latencyMs = Date.now() - startTime;
      window.CLOUD_SYNC_STATUS.lastSyncTime = Date.now();
      window.CLOUD_SYNC_STATUS.connected = true;
      window.CLOUD_SYNC_STATUS.lastError = null;
      updateStaffSyncUI();

      if (json && (json.success || json.data) && json.data) {
        // 1. 運営コマンドの受信 ＆ リアルタイム実行
        if (json.data.latestCommand) {
          executeRemoteAdminCommand(json.data.latestCommand);
        }

        // 2. スプレッドシートデータ差分更新
        const rawJsonStr = JSON.stringify(json.data);
        if (rawJsonStr !== lastDataHash) {
          lastDataHash = rawJsonStr;
          console.log("🔄 スプレッドシートの変更を検知し、リアルタイム反映しました！", json.data);
          
          if (json.data.browser && json.data.browser.pagesContent) {
            Object.assign(window.GAME_DATABASE.browser.pagesContent, json.data.browser.pagesContent);
          }
          if (json.data.browser && json.data.browser.news) {
            window.GAME_DATABASE.browser.news = json.data.browser.news;
          }
          if (json.data.browser && json.data.browser.searchResults) {
            window.GAME_DATABASE.browser.searchResults = json.data.browser.searchResults;
          }
          if (json.data.linkApp && json.data.linkApp.chats) {
            window.GAME_DATABASE.linkApp.chats = json.data.linkApp.chats;
          }
          if (json.data.mailApp) {
            window.GAME_DATABASE.mailApp = json.data.mailApp;
          }
          if (json.data.lockNotifications) {
            window.GAME_DATABASE.lockNotifications = json.data.lockNotifications;
          }
          if (json.data.system) {
            Object.assign(window.GAME_DATABASE.system, json.data.system);
          }

          updateAppUI();

          if (gameState.activeChatContact) {
            const linkApp = document.getElementById('app-link-app');
            if (linkApp && linkApp.style.display !== 'none') {
              openLinkChat(gameState.activeChatContact);
            }
          }
          if (gameState.activeMailId) {
            const mailApp = document.getElementById('app-mail-app');
            if (mailApp && mailApp.style.display !== 'none') {
              openMailDetail(gameState.activeMailId);
            }
          }
        }
      }

      // 3. 自分の進捗ステータスをGASへ定期送信（ハートビート）
      sendDeviceStatusHeartbeat();
    })
    .catch(err => {
      window.CLOUD_SYNC_STATUS.connected = false;
      window.CLOUD_SYNC_STATUS.lastError = err.message || "ネットワーク通信エラー";
      console.warn("⚠️ クラウド同期エラー:", err);
      updateStaffSyncUI();
    });
}

// 運営からの遠隔コマンドを実行
function executeRemoteAdminCommand(cmd) {
  if (!cmd || !cmd.id) return;
  if (cmd.id === lastExecutedCommandId) return; // 実行済み

  // 宛先判定（ALL または 自分のteamId）
  const myTeam = gameState.teamId || 'iPad-01';
  if (cmd.target && cmd.target !== 'ALL' && cmd.target !== myTeam) {
    return; // 自分宛てではない
  }

  // params のアンパック（2重ネスト・文字列JSONを完全吸収）
  let p = cmd.params || {};
  if (typeof p === 'string') {
    try { p = JSON.parse(p); } catch (e) {}
  }
  if (p.params && typeof p.params === 'object') {
    p = Object.assign({}, p, p.params);
  }

  // コマンドが古すぎる場合はスキップ（10分以上前）
  const cmdTimestamp = p.timestamp || cmd.timestamp || 0;
  const cmdAge = cmdTimestamp ? (Date.now() - cmdTimestamp) : 0;
  if (cmdAge > 600000) return;

  console.log("⚡ 運営からの遠隔コマンドを受信・実行します:", cmd, p);
  lastExecutedCommandId = cmd.id;
  localStorage.setItem('last_exec_cmd_id', cmd.id);

  const type = cmd.type || p.type;
  const isLoopChange = (p.loop !== undefined && p.loop !== null && p.loop !== "");

  // ① 全画面緊急アラート（※周回変化プリセット時は通知を出さず、直接ロック画面へ）
  const alertMsg = p.alertMsg || p.message || cmd.message;
  if (alertMsg && (type === 'alert' || (type === 'preset' && !isLoopChange))) {
    showSystemAlert(alertMsg);
  }

  // ② 効果音・サイレン再生
  const soundName = p.sound || (type === 'sound' ? (alertMsg || cmd.message) : null);
  if (soundName) {
    playSystemSound(soundName);
  }

  // ③ 周回強制移行 ＆ 時刻09:04リセット ＆ 勝手にロック画面へ移行
  if (isLoopChange) {
    const nextLoop = parseInt(p.loop, 10);
    if (!isNaN(nextLoop)) {
      gameState.loop = nextLoop;
      localStorage.setItem('game_loop', String(nextLoop));
      
      // 時刻を 09:04 に強制リセット
      const loopClockISO = "2126-08-22T09:04:00";
      localStorage.setItem('fake_clock_start_iso', loopClockISO);
      gameState.clockStartISO = loopClockISO;

      // 通知は出さず、勝手にロック画面へ強制移行
      showLockScreen();
      updateAppUI();
    }
  } else if (p.forceLock === true || p.lock === true) {
    // ④ ロック画面強制
    showLockScreen();
  }

  // ⑤ 時計強制同期（周回変化以外の場合）
  if (p.clockISO && !isLoopChange) {
    localStorage.setItem('fake_clock_start_iso', p.clockISO);
    gameState.clockStartISO = p.clockISO;
    updateAppUI();
  }

  // ⑥ マスターデータ初期化（本番前一斉リセット）
  if (type === 'master_reset') {
    console.log("🚨 運営よりマスターデータリセットを受信しました。全データを初期化します。");
    const currentTeam = gameState.teamId || 'iPad-01';
    localStorage.clear();
    localStorage.setItem('team_id', currentTeam);
    localStorage.setItem('game_loop', '1');
    showPushNotification("公演前データリセット", "端末データが完全初期化されました（1周目）", "rotate-ccw");
    playSystemSound("fanfare");
    setTimeout(() => {
      location.reload();
    }, 800);
    return;
  }
}

// 自分の進捗ステータスをGASへ送信（GET+POST ハイブリッド送信：100%確実通信）
function sendDeviceStatusHeartbeat() {
  const gasUrl = getResolvedGasUrl();
  if (!gasUrl) return;

  const myTeam = gameState.teamId || 'iPad-01';
  const myLoop = parseInt(gameState.loop || 1, 10);
  const hintsCount = (gameState.unlockedHints || []).length;
  const myManaba = gameState.manabaLoggedInUser ? `ログイン中: ${gameState.manabaLoggedInUser}` : "未ログイン";

  // 1. GETパラメータでの送信（CORSフリー・Google Apps Script最適化）
  const getUrl = gasUrl.includes('?') 
    ? `${gasUrl}&action=update_status&teamId=${encodeURIComponent(myTeam)}&loop=${myLoop}&hints=${hintsCount}&manaba=${encodeURIComponent(myManaba)}&_t=${Date.now()}`
    : `${gasUrl}?action=update_status&teamId=${encodeURIComponent(myTeam)}&loop=${myLoop}&hints=${hintsCount}&manaba=${encodeURIComponent(myManaba)}&_t=${Date.now()}`;

  fetch(getUrl).catch(() => {});

  // 2. 同一端末テスト用 LocalStorage 更新
  localStorage.setItem('team_id', myTeam);
  localStorage.setItem('game_loop', String(myLoop));
  localStorage.setItem('game_unlocked_hints', JSON.stringify(gameState.unlockedHints || []));
  localStorage.setItem('game_manaba_user', gameState.manabaLoggedInUser || "");
  localStorage.setItem('mon_last_update', String(Date.now()));
}

function updateStaffSyncUI() {
  const statusEl = document.getElementById('staff-sync-status');
  if (!statusEl) return;

  if (window.CLOUD_SYNC_STATUS.connected) {
    statusEl.innerHTML = `
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; padding:8px 10px; border-radius:8px; font-size:11px; display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
        <span style="display:flex; align-items:center; gap:6px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#22c55e;"></span>
          <strong>クラウド連携中 (正常)</strong>
        </span>
        <span style="color:#65a30d;">応答: ${window.CLOUD_SYNC_STATUS.latencyMs}ms</span>
      </div>
    `;
  } else {
    statusEl.innerHTML = `
      <div style="background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px 10px; border-radius:8px; font-size:11px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:6px; font-weight:700;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ef4444;"></span>
          通信エラー / 未接続
        </div>
        <div style="font-size:10px; color:#b91c1c; margin-top:2px;">${window.CLOUD_SYNC_STATUS.lastError || "GAS接続を確認してください"}</div>
      </div>
    `;
  }
}

function startAutoSpreadsheetSync() {
  fetchLatestDataFromSpreadsheet();
  // 6秒おきに裏側で自動チェック・コマンド受信（リロード不要）
  setInterval(fetchLatestDataFromSpreadsheet, 6000);
}

// --- 操作制限 (デフォルト挙動の無効化・Pull-to-refresh完全防止) ---
function applyOperationalRestrictions() {
  // 右クリック・長押しコンテキストメニュー禁止
  document.addEventListener('contextmenu', e => e.preventDefault());
  
  // ピンチイン・アウトによる拡大縮小禁止（マルチタッチのみ、シングルタップは影響なし）
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
      e.preventDefault();
    }
  }, { passive: false });

  // Pull-to-refresh（上からの引っ張りリロード）および画面全体のオーバースクロールを完全防止
  let touchStartY = 0;
  let scrollTarget = null;

  function findScrollableParent(el) {
    while (el && el !== document.body && el !== document.documentElement) {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      const isScrollable = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
      if (isScrollable) return el;
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
      scrollTarget = findScrollableParent(e.target);
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!scrollTarget) {
      // スクロール可能要素以外の場所（背景、ツールバー、Dock、ロック画面等）でのドラッグを全面禁止
      e.preventDefault();
      return;
    }

    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartY;
    const isAtTop = scrollTarget.scrollTop <= 0;
    const isAtBottom = scrollTarget.scrollTop + scrollTarget.clientHeight >= scrollTarget.scrollHeight - 1;

    // 最上部で下に引っ張った場合（Pull-to-refreshの発動条件）はリロードをブロック
    if (isAtTop && deltaY > 0) {
      e.preventDefault();
    }
    // 最下部で上に引っ張った場合（バウンススクロール）もブロック
    else if (isAtBottom && deltaY < 0) {
      e.preventDefault();
    }
  }, { passive: false });

  // マウスホイールによる最外枠バウンスも防止
  window.addEventListener('wheel', (e) => {
    const target = findScrollableParent(e.target);
    if (!target) {
      e.preventDefault();
    } else {
      const isAtTop = target.scrollTop <= 0;
      const isAtBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 1;
      if ((isAtTop && e.deltaY < 0) || (isAtBottom && e.deltaY > 0)) {
        e.preventDefault();
      }
    }
  }, { passive: false });
}

// --- 状態の読み込みと保存 ---
function loadStateFromStorage() {
  gameState.loop = parseInt(localStorage.getItem('game_loop') || '1');
  gameState.teamId = localStorage.getItem('team_id') || 'チームA';
  gameState.clockStartISO = localStorage.getItem('fake_clock_start_iso') || '2126-08-22T10:00:00';
  gameState.clockSetTime = parseInt(localStorage.getItem('fake_clock_set_time') || Date.now().toString());
  
  try {
    gameState.unlockedHints = JSON.parse(localStorage.getItem('unlocked_hints') || '[]');
  } catch (e) {
    gameState.unlockedHints = [];
  }

  try {
    gameState.addedFriends = JSON.parse(localStorage.getItem('added_friends') || '["jinnai", "fukasawa", "committee_group"]');
  } catch (e) {
    gameState.addedFriends = ["jinnai", "fukasawa", "committee_group"];
  }

  gameState.manabaUser = localStorage.getItem('manaba_user') || null;

  // 画面表示反映（nullチェック付き）
  const sbTeamEl = document.getElementById('sb-team-id');
  if (sbTeamEl) sbTeamEl.innerText = gameState.teamId;
  const settAppleEl = document.getElementById('settings-apple-id');
  if (settAppleEl) settAppleEl.innerText = gameState.teamId;
}

function saveStateToStorage() {
  localStorage.setItem('game_loop', gameState.loop);
  localStorage.setItem('team_id', gameState.teamId);
  localStorage.setItem('unlocked_hints', JSON.stringify(gameState.unlockedHints));
  localStorage.setItem('added_friends', JSON.stringify(gameState.addedFriends));
  if (gameState.manabaUser) {
    localStorage.setItem('manaba_user', gameState.manabaUser);
  } else {
    localStorage.removeItem('manaba_user');
  }
}

// --- 運営画面など外部からの同期制御 ---
function handleStorageEvent(e) {
  if (e.key === 'game_loop_trigger') {
    // 周回変更
    const newLoop = parseInt(localStorage.getItem('game_loop') || '1');
    if (gameState.loop !== newLoop) {
      triggerLoopTransition(newLoop);
    }
  } else if (e.key === 'game_alert_trigger') {
    // 全画面アラート表示
    const alertMsg = localStorage.getItem('game_alert');
    if (alertMsg) {
      showSystemAlert(alertMsg);
    }
  } else if (e.key === 'game_reset') {
    // マスターリセット
    performMasterReset();
  } else if (e.key === 'fake_clock_start_iso') {
    // 時計更新
    loadStateFromStorage();
  } else if (e.key === 'game_db_cache_trigger') {
    // キャッシュ更新（エディタからのリアルタイム反映）
    loadGameDatabase();
    updateAppUI();
    // アクティブなアプリがあれば再描画
    if (gameState.activeApp) {
      openApp(gameState.activeApp);
    }
    console.log("Hot-reloaded game data and UI.");
  }
}

// --- 嘘の時計ロジック ---
function startFakeClock() {
  function updateClock() {
    const elapsed = Date.now() - gameState.clockSetTime;
    const startMs = Date.parse(gameState.clockStartISO);
    const fakeCurrent = new Date(startMs + elapsed);

    const hh = String(fakeCurrent.getHours()).padStart(2, '0');
    const mm = String(fakeCurrent.getMinutes()).padStart(2, '0');
    const clockStr = `${hh}:${mm}`;

    const sbClock = document.getElementById('sb-clock');
    if (sbClock) sbClock.innerText = clockStr;

    const lockClock = document.getElementById('lock-clock');
    if (lockClock) lockClock.innerText = clockStr;

    // 日付表示 (ロック画面)
    const month = fakeCurrent.getMonth() + 1;
    const day = fakeCurrent.getDate();
    const dayOfWeek = ["日", "月", "火", "水", "木", "金", "土"][fakeCurrent.getDay()];
    const lockDate = document.getElementById('lock-date');
    if (lockDate) lockDate.innerText = `2126年 ${month}月${day}日 ${dayOfWeek}曜日`;
    
    // manabaのヘッダー日付 (時間割に合わせた日付表記)
    const mDateEl = document.getElementById('manaba-header-date');
    if (mDateEl) {
      mDateEl.innerText = `2026-08-22 (${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][fakeCurrent.getDay()]})`;
    }
  }

  updateClock();
  setInterval(updateClock, 1000);
}

// --- 探索残り時間タイマー ---
function startCountdownTimer() {
  if (gameState.timerInterval) clearInterval(gameState.timerInterval);
  
  gameState.timeRemaining = parseInt(localStorage.getItem('time_remaining') || '3600');

  gameState.timerInterval = setInterval(() => {
    if (gameState.timeRemaining > 0) {
      gameState.timeRemaining--;
      localStorage.setItem('time_remaining', gameState.timeRemaining);
      
      const mm = String(Math.floor(gameState.timeRemaining / 60)).padStart(2, '0');
      const ss = String(gameState.timeRemaining % 60).padStart(2, '0');
      const timerEl = document.getElementById('meta-timer');
      if (timerEl) timerEl.innerText = `探索残り時間 ${mm}:${ss}`;
    } else {
      const timerEl = document.getElementById('meta-timer');
      if (timerEl) timerEl.innerText = `探索時間終了`;
    }
  }, 1000);
}

// --- 周回（ループ）の強制切り替え演出 ---
function triggerLoopTransition(nextLoop) {
  // 効果音（ブラウザのAudio制限対策としてエラーハンドリング）
  playSystemSound("beep");

  // 1. 強制的にロック画面をフェードイン
  const lockScreen = document.getElementById('lock-screen');
  lockScreen.classList.remove('hidden');
  
  // 2. 状態更新
  gameState.loop = nextLoop;
  saveStateToStorage();

  // 3. アプリをすべて閉じる (裏側でサイレント切替)
  closeAllWindowsSilent();

  // 4. コンテンツUI更新
  updateAppUI();

  // 5. ロック画面の日常通知を更新
  renderLockNotifications();

  // 6. プッシュ通知でさりげなく新着通知演出
  showPushNotification("LINK", "新着メッセージを受信しました", "message-square", "LINK");

  logWriteToGAS("LOOP_TRANSITION", `端末が強制的に周回 ${nextLoop} へ移行しました。`);
}

// --- アプリUIの周回ごとの更新 ---
function updateAppUI() {
  if (!window.GAME_DATABASE) return;

  // ロック画面の通知更新
  renderLockNotifications();

  // ブラウザニュース更新
  renderBrowserNews();

  // LINK友達リスト＆メッセージ更新
  renderLinkChatList();

  // manabaのお知らせ
  const notice = window.GAME_DATABASE.manaba ? window.GAME_DATABASE.manaba.maintenanceNotice : "";
  const mNoticeEl = document.getElementById('manaba-notice');
  if (mNoticeEl && notice) mNoticeEl.innerText = notice;

  // 設定スペックの更新
  const spec = (window.GAME_DATABASE.system && window.GAME_DATABASE.system.spec) || {};
  if (document.getElementById('spec-os') && spec.os) document.getElementById('spec-os').innerText = spec.os;
  if (document.getElementById('spec-processor') && spec.processor) document.getElementById('spec-processor').innerText = spec.processor;
  if (document.getElementById('spec-ram') && spec.ram) document.getElementById('spec-ram').innerText = spec.ram;
  if (document.getElementById('spec-storage') && spec.storage) document.getElementById('spec-storage').innerText = spec.storage;
  if (document.getElementById('spec-serial') && spec.serial) document.getElementById('spec-serial').innerText = spec.serial;

  // メタアプリ：ルール/あらすじ/相関図の読み込み
  const metaRulesEl = document.getElementById('meta-rules-text');
  if (metaRulesEl && window.GAME_DATABASE.metaApp) metaRulesEl.innerText = window.GAME_DATABASE.metaApp.rules || "";
  
  renderMetaSynopsis();

  // メタアプリ：入手済みのヒント描画
  renderUnlockedHints();

  // メールリスト更新
  renderMailList();
}

// --- ロック画面の日常通知レンダリング（タップで該当アプリへアクセス） ---
function renderLockNotifications() {
  const container = document.getElementById('lock-notifications-list');
  if (!container) return;

  const notifs = (window.GAME_DATABASE && window.GAME_DATABASE.lockNotifications && window.GAME_DATABASE.lockNotifications[gameState.loop]) || [];
  container.innerHTML = "";

  notifs.forEach((n, idx) => {
    const card = document.createElement('div');
    card.className = 'notification-card';
    card.style.marginBottom = '8px';
    card.innerHTML = `
      <div class="notif-header">
        <div style="display:flex; align-items:center; gap:6px;">
          <i data-lucide="${n.icon || 'bell'}" class="notif-icon"></i>
          <span>${n.app}</span>
        </div>
        <span class="notif-time">${n.time}</span>
      </div>
      <div class="notif-title">${n.title}</div>
      <div class="notif-body">${n.body}</div>
    `;
    card.onclick = () => handleLockNotificationClick(n);
    container.appendChild(card);
  });

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// ロック画面通知タップ時のシームレスアクセス処理
function handleLockNotificationClick(n) {
  unlockScreen();
  setTimeout(() => {
    if (n.targetApp === 'link') {
      openApp('link-app');
      if (n.contactId) {
        setTimeout(() => {
          openLinkChat(n.contactId);
        }, 120);
      }
    } else if (n.targetApp === 'mail') {
      openApp('mail-app');
      if (n.mailId) {
        setTimeout(() => {
          openMailDetail(n.mailId);
        }, 120);
      }
    } else if (n.targetApp === 'browser') {
      openApp('browser-app');
      if (n.pageId) {
        setTimeout(() => {
          openBrowserPage(n.pageId);
        }, 120);
      }
    } else if (n.targetApp === 'manaba') {
      openApp('manaba-app');
    } else if (n.targetApp === 'meta') {
      openApp('meta-app');
    }
  }, 150);
}

// --- iPadOS風 オリジナル通知システム ---
let currentPushAction = null;

function showPushNotification(app, title, body, icon = "bell", onClick = null) {
  const banner = document.getElementById('push-notification-banner');
  if (!banner) return;

  const appEl = document.getElementById('push-notif-app');
  if (appEl) appEl.innerText = app;
  const titleEl = document.getElementById('push-notif-title');
  if (titleEl) titleEl.innerText = title;
  const descEl = document.getElementById('push-notif-desc');
  if (descEl) descEl.innerText = body;
  
  const iconEl = document.getElementById('push-notif-icon');
  if (iconEl) iconEl.setAttribute('data-lucide', icon);
  if (typeof lucide !== 'undefined') lucide.createIcons();

  currentPushAction = onClick;
  banner.classList.add('show');
  playSystemSound("notif");

  setTimeout(() => {
    banner.classList.remove('show');
  }, 4500);
}

function handleBannerClick() {
  const banner = document.getElementById('push-notification-banner');
  if (banner) banner.classList.remove('show');
  if (currentPushAction) {
    currentPushAction();
  }
}

// --- フロストグラス調 iPadOS風モーダル（alert完全置換） ---
let currentModalCallback = null;

function showIpadModal(title, msg, onOk = null, isConfirm = false) {
  const overlay = document.getElementById('ipad-modal-overlay');
  if (!overlay) {
    alert(`${title}\n\n${msg}`);
    if (onOk) onOk();
    return;
  }

  const titleEl = document.getElementById('ipad-modal-title');
  if (titleEl) titleEl.innerText = title;
  const msgEl = document.getElementById('ipad-modal-msg');
  if (msgEl) msgEl.innerText = msg;

  const actions = document.getElementById('ipad-modal-actions');
  if (actions) {
    actions.innerHTML = "";

    if (isConfirm) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'ipad-modal-btn cancel';
      cancelBtn.innerText = 'キャンセル';
      cancelBtn.onclick = closeIpadModal;
      actions.appendChild(cancelBtn);
    }

    const okBtn = document.createElement('button');
    okBtn.className = 'ipad-modal-btn';
    okBtn.innerText = 'OK';
    okBtn.onclick = () => {
      closeIpadModal();
      if (onOk) onOk();
    };
    actions.appendChild(okBtn);
  }

  overlay.style.display = 'flex';
}

function closeIpadModal() {
  const overlay = document.getElementById('ipad-modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

// --- ロック画面表示（カバーシート呼び出し） ---
function showLockScreen() {
  const lockScreen = document.getElementById('lock-screen');
  if (lockScreen) {
    lockScreen.classList.remove('hidden');
    renderLockNotifications();
    playSystemSound("dtmf");
    logWriteToGAS("LOCK_TRIGGERED", "ロック画面が表示されました。");
  }
}

// --- 画面上端からの下スワイプでロック画面を呼び出し（iPadOSジェスチャー） ---
function initTopSwipeForLockScreen() {
  let touchStartY = 0;
  let touchStartX = 0;
  let isTrackingTopSwipe = false;

  document.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 1) {
      const touch = e.touches[0];
      // 画面上部75px以内でタッチ開始された場合のみ追跡
      if (touch.clientY <= 75) {
        touchStartY = touch.clientY;
        touchStartX = touch.clientX;
        isTrackingTopSwipe = true;
      } else {
        isTrackingTopSwipe = false;
      }
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!isTrackingTopSwipe || !e.touches || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const deltaY = touch.clientY - touchStartY;
    const deltaX = Math.abs(touch.clientX - touchStartX);

    // 下方向に60px以上スワイプかつ横ブレが少ない場合
    if (deltaY > 60 && deltaX < 80) {
      isTrackingTopSwipe = false;
      showLockScreen();
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    isTrackingTopSwipe = false;
  }, { passive: true });

  // ステータスバー（PC用マウスクリック対応）
  const statusBar = document.getElementById('status-bar');
  if (statusBar) {
    let mouseStartY = 0;
    statusBar.addEventListener('mousedown', (e) => {
      mouseStartY = e.clientY;
    });
    document.addEventListener('mouseup', (e) => {
      if (mouseStartY > 0 && (e.clientY - mouseStartY) > 50) {
        showLockScreen();
      }
      mouseStartY = 0;
    });
  }
}

// --- ロック画面解除 ---
function unlockScreen() {
  const lockScreen = document.getElementById('lock-screen');
  if (lockScreen) {
    lockScreen.classList.add('hidden');
    playSystemSound("notif");
    logWriteToGAS("LOCK_DISMISS", "ロック解除されました。");
  }
}

// --- 画面ナビゲーション ＆ アプリ開閉 ---
function openApp(appId) {
  // ロック中は開けない
  const lockScreen = document.getElementById('lock-screen');
  if (lockScreen && !lockScreen.classList.contains('hidden')) return;

  closeAllWindowsSilent();
  
  const win = document.getElementById(`app-${appId}`);
  if (win) {
    win.classList.add('active');
    gameState.activeApp = appId;
    
    // アプリ固有の初期起動ロジック
    if (appId === 'meta-app') {
      switchMetaTab(gameState.activeMetaTab);
    } else if (appId === 'browser-app') {
      goBrowserHome();
    } else if (appId === 'link-app') {
      renderLinkChatList();
    } else if (appId === 'manaba-app') {
      initManabaApp();
    } else if (appId === 'mail-app') {
      renderMailList();
    }
    
    logWriteToGAS("APP_OPEN", `アプリを開きました: ${appId}`);
  }
}

function goHome() {
  // ロック中はホームに行けない
  const lockScreen = document.getElementById('lock-screen');
  if (lockScreen && !lockScreen.classList.contains('hidden')) return;

  // すべてのカメラストリームを停止
  stopAllCameraStreams();

  closeAllWindowsSilent();
  gameState.activeApp = null;
}

function closeAllWindowsSilent() {
  document.querySelectorAll('.app-window').forEach(win => {
    win.classList.remove('active');
  });
  closeHacking();
}

// --- 全画面アラート（運営指示） ---
function showSystemAlert(msg) {
  playSystemSound("alarm");
  const msgEl = document.getElementById('system-alert-message');
  if (msgEl) msgEl.innerText = msg;
  const overlay = document.getElementById('system-alert-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function dismissSystemAlert() {
  const overlay = document.getElementById('system-alert-overlay');
  if (overlay) overlay.style.display = 'none';
  logWriteToGAS("ALERT_DISMISS", "全画面アラートが解除されました。");
}

// --- 隠しセットアップ画面（スタッフ用 30台＆ユーザー名対応GUI） ---
let tempStaffLoop = 1;

function showStaffModal() {
  const modal = document.getElementById('staff-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  
  const inputEl = document.getElementById('staff-team-id');
  if (inputEl) inputEl.value = gameState.teamId || 'iPad-01';

  tempStaffLoop = parseInt(gameState.loop || 1, 10);
  updateStaffLoopButtons();
  updateStaffSyncUI();
  fetchLatestDataFromSpreadsheet();

  // iPad 01〜30 のボタングリッドを生成
  const grid = document.getElementById('staff-ipad-grid');
  if (grid) {
    grid.innerHTML = "";
    for (let i = 1; i <= 30; i++) {
      const padNum = String(i).padStart(2, '0');
      const padName = `iPad-${padNum}`;
      const isSelected = gameState.teamId === padName;
      grid.innerHTML += `
        <button type="button" class="btn-subtle staff-ipad-btn ${isSelected ? 'selected' : ''}" 
                onclick="selectStaffIpad('${padName}')"
                style="padding:6px 2px; font-size:11px; font-weight:700; ${isSelected ? 'background:var(--system-blue); color:#fff;' : ''}">
          ${padNum}
        </button>
      `;
    }
  }
}

function selectStaffIpad(name) {
  const inputEl = document.getElementById('staff-team-id');
  if (inputEl) inputEl.value = name;
  document.querySelectorAll('.staff-ipad-btn').forEach(b => {
    if (b.innerText.trim() === name.replace('iPad-', '')) {
      b.style.background = 'var(--system-blue)';
      b.style.color = '#fff';
    } else {
      b.style.background = '';
      b.style.color = '';
    }
  });
}

function setStaffLoop(loopNum) {
  tempStaffLoop = loopNum;
  updateStaffLoopButtons();
}

function updateStaffLoopButtons() {
  [1, 2, 3].forEach(l => {
    const btn = document.getElementById(`staff-loop-btn-${l}`);
    if (btn) {
      if (tempStaffLoop === l) {
        btn.style.background = 'var(--system-blue)';
        btn.style.color = '#fff';
        btn.style.fontWeight = '700';
      } else {
        btn.style.background = '';
        btn.style.color = '';
        btn.style.fontWeight = 'normal';
      }
    }
  });
}

function closeStaffModal() {
  const modal = document.getElementById('staff-modal');
  if (modal) modal.style.display = 'none';
}

function saveStaffConfig() {
  const inputEl = document.getElementById('staff-team-id');
  const newTeamId = inputEl ? inputEl.value.trim() : 'iPad-01';
  if (newTeamId) {
    gameState.teamId = newTeamId;
    gameState.loop = tempStaffLoop;
    saveStateToStorage();
    
    const sbTeam = document.getElementById('sb-team-id');
    if (sbTeam) sbTeam.innerText = newTeamId;
    const settApple = document.getElementById('settings-apple-id');
    if (settApple) settApple.innerText = newTeamId;
    const settIcon = document.getElementById('settings-avatar-icon');
    if (settIcon) settIcon.innerText = newTeamId;

    logWriteToGAS("STAFF_CONFIG_SAVED", `端末名: ${newTeamId}, 周回: ${tempStaffLoop} に設定保存されました。`);
    showPushNotification("設定完了", `端末名: ${newTeamId} (周回: ${tempStaffLoop})`, "check-circle");
  }
  closeStaffModal();
  updateAppUI();
}

function performMasterReset() {
  if (confirm("⚠️ 【確認】このiPadの全データを消去し、1周目の初期状態（ロック画面）に戻しますか？")) {
    const currentTeam = gameState.teamId || 'iPad-01';
    localStorage.clear();
    localStorage.setItem('team_id', currentTeam);
    localStorage.setItem('game_loop', '1');
    showPushNotification("端末初期化完了", "全データを初期化し、再読み込みします...", "rotate-ccw");
    setTimeout(() => {
      location.reload();
    }, 400);
  }
}

// ==========================================================================
// ① メタアプリ「26__0094」ロジック
// ==========================================================================
function switchMetaTab(tabId) {
  gameState.activeMetaTab = tabId;

  document.querySelectorAll('.meta-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.meta-panel').forEach(panel => panel.classList.remove('active'));

  const activeBtn = Array.from(document.querySelectorAll('.meta-tab-btn')).find(btn => {
    const oc = btn.getAttribute('onclick');
    return oc && oc.includes(tabId);
  });
  if (activeBtn) activeBtn.classList.add('active');
  
  const panel = document.getElementById(`meta-panel-${tabId}`);
  if (panel) panel.classList.add('active');

  stopAllCameraStreams();
  const inlineScanner = document.getElementById('meta-qr-inline-scanner');
  if (inlineScanner) inlineScanner.style.display = 'none';
}

// あらすじ・タイムライン描画
function renderMetaSynopsis() {
  const container = document.getElementById('meta-synopsis-timeline');
  if (!container) return;

  const currentSynopsis = window.GAME_DATABASE.metaApp.synopsis[gameState.loop];
  if (!currentSynopsis) return;

  let objHtml = "";
  if (currentSynopsis.objectives) {
    objHtml = `
      <div class="timeline-obj-list">
        <strong>現在の調査目標:</strong>
        <ul style="margin:0; padding-left:16px; color:#555;">
          ${currentSynopsis.objectives.map(o => `<li>${o}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="timeline-step-card">
      <div class="timeline-step-header">
        <span class="rel-sym" style="background:#e0f2fe; color:#0369a1;">周回 ${gameState.loop}</span>
        <span class="timeline-step-title">${currentSynopsis.title}</span>
      </div>
      <div class="timeline-step-body">${currentSynopsis.summary}</div>
      ${objHtml}
    </div>
  `;
}

// 入手済みアーカイブ情報描画
function renderUnlockedHints() {
  const container = document.getElementById('meta-hints-list');
  if (!container) return;

  if (gameState.unlockedHints.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size:13px;">探索中にQRコードをスキャンして入手した機密データがここにアーカイブされます。</p>`;
    return;
  }

  container.innerHTML = "";
  gameState.unlockedHints.forEach(hintId => {
    const hint = window.GAME_DATABASE.metaApp.qrHints[hintId];
    if (hint) {
      const imgHtml = hint.image ? `<img src="${hint.image}" class="archive-hint-img" alt="hint">` : '';
      container.innerHTML += `
        <div class="archive-hint-card">
          ${imgHtml}
          <div class="archive-hint-content">
            <span class="archive-hint-category">${hint.category || '調査データ'}</span>
            <div class="archive-hint-title">${hint.title}</div>
            <div class="archive-hint-text">${hint.content}</div>
          </div>
        </div>
      `;
    }
  });
}

// インラインQRスキャナートグル
let metaQrActive = false;

function toggleMetaQrScanner() {
  const scannerBox = document.getElementById('meta-qr-inline-scanner');
  if (!scannerBox) return;

  metaQrActive = !metaQrActive;
  if (metaQrActive) {
    scannerBox.style.display = 'block';
    startQrScanner('meta-video', 'meta-canvas', handleMetaQrScan);
  } else {
    scannerBox.style.display = 'none';
    stopAllCameraStreams();
  }
}

// --- カメラ/QRコード読み取り統合ロジック ---
let activeStream = null;
let qrScanTimeout = null;

function startQrScanner(videoId, canvasId, callback, resultBoxId = 'meta-qr-result') {
  stopAllCameraStreams();

  const video = document.getElementById(videoId);
  const canvas = document.getElementById(canvasId);
  const resultBox = document.getElementById(resultBoxId);
  
  if (resultBox) {
    resultBox.innerText = "カメラを起動しています...";
    resultBox.className = "qr-result-box";
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (resultBox) {
      resultBox.innerText = "⚠️ この端末はカメラAPIに対応していません。手動入力をご利用ください。";
      resultBox.className = "qr-result-box error";
    }
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    .then(stream => {
      activeStream = stream;
      if (video) {
        video.srcObject = stream;
        video.setAttribute("playsinline", true);
        video.play();
      }
      if (resultBox) {
        resultBox.innerText = "🔍 QRコードをスキャン枠に合わせてください...";
        resultBox.className = "qr-result-box";
      }
      
      qrScanTimeout = requestAnimationFrame(tick);
    })
    .catch(err => {
      console.warn("カメラアクセス失敗/拒否:", err);
      if (resultBox) {
        resultBox.innerText = "📷 カメラへのアクセスが許可されていません（手動入力をご利用ください）";
        resultBox.className = "qr-result-box error";
      }
    });

  function tick() {
    if (video && video.readyState === video.HAVE_ENOUGH_DATA && canvas) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      canvas.height = video.videoHeight;
      canvas.width = video.videoWidth;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = (typeof jsQR !== 'undefined') ? jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      }) : null;

      if (code && code.data) {
        stopAllCameraStreams();
        callback(code.data, resultBox);
        return;
      }
    }
    qrScanTimeout = requestAnimationFrame(tick);
  }
}

function stopAllCameraStreams() {
  if (qrScanTimeout) {
    cancelAnimationFrame(qrScanTimeout);
    qrScanTimeout = null;
  }
  if (activeStream) {
    activeStream.getTracks().forEach(track => track.stop());
    activeStream = null;
  }
  metaQrActive = false;
}

// メタQRの判定
function handleMetaQrScan(data, resultBox) {
  const hint = window.GAME_DATABASE.metaApp.qrHints[data];
  if (hint) {
    if (gameState.unlockedHints.includes(data)) {
      resultBox.innerText = "取得済みです。";
      resultBox.className = "qr-result-box error";
      playSystemSound("error");
    } else {
      gameState.unlockedHints.push(data);
      saveStateToStorage();
      renderUnlockedHints();
      resultBox.innerText = `成功: ${hint.title} を入手しました！`;
      resultBox.className = "qr-result-box success";
      playSystemSound("success");
      logWriteToGAS("QR_METADATA_UNLOCKED", `メタ情報取得: ${data}`);
    }
  } else {
    resultBox.innerText = "無効なコードです。";
    resultBox.className = "qr-result-box error";
    playSystemSound("error");
  }

  // 3秒後に再開
  setTimeout(() => {
    if (gameState.activeMetaTab === 'qr' && !activeStream) {
      startQrScanner('meta-video', 'meta-canvas', handleMetaQrScan);
    }
  }, 3000);
}

// ==========================================================================
// ② Googleブラウザロジック（Yahoo!ニュース風リッチUI）
// ==========================================================================
let currentNewsCategory = 'all';

function switchNewsCategory(cat) {
  currentNewsCategory = cat;
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  
  const activeTab = Array.from(document.querySelectorAll('.cat-tab')).find(t => {
    const oc = t.getAttribute('onclick');
    return oc && oc.includes(cat);
  });
  if (activeTab) activeTab.classList.add('active');

  renderBrowserNews();
}

function renderBrowserNews() {
  const heroContainer = document.getElementById('news-hero-container');
  const gridContainer = document.getElementById('news-grid-container');
  if (!heroContainer || !gridContainer) return;

  const newsList = (window.GAME_DATABASE && window.GAME_DATABASE.browser && window.GAME_DATABASE.browser.news[gameState.loop]) || [];
  
  // カテゴリフィルタリング
  let filtered = newsList;
  if (currentNewsCategory === 'it') {
    filtered = newsList.filter(n => n.category === 'IT・科学');
  } else if (currentNewsCategory === 'ent') {
    filtered = newsList.filter(n => n.category === 'エンタメ');
  } else if (currentNewsCategory === 'campus') {
    filtered = newsList.filter(n => n.category === '学内' || n.category === '社会');
  }

  // Top Hero記事（1件目またはisHero）
  const heroItem = filtered.find(n => n.isHero) || filtered[0];
  const gridItems = filtered.filter(n => n !== heroItem);

  if (heroItem) {
    heroContainer.innerHTML = `
      <div class="news-hero-card" onclick="openBrowserPage('${heroItem.target}')">
        <div class="news-hero-img-wrap">
          <img src="${heroItem.image}" class="news-hero-img" alt="hero">
          <span class="news-cat-badge">${heroItem.category || '主要'}</span>
        </div>
        <div class="news-hero-body">
          <div class="news-hero-title">${heroItem.title}</div>
          <div class="news-hero-desc">${heroItem.desc}</div>
          <div class="news-meta-info">
            <span>${heroItem.source || '東金タイムズ'}</span>
            <span>•</span>
            <span>${heroItem.time || '10分前'}</span>
          </div>
        </div>
      </div>
    `;
  } else {
    heroContainer.innerHTML = "";
  }

  // 2列グリッド
  gridContainer.innerHTML = "";
  gridItems.forEach(item => {
    gridContainer.innerHTML += `
      <div class="news-card" onclick="openBrowserPage('${item.target}')">
        <div class="news-card-img-wrap">
          <img src="${item.image}" class="news-card-img" alt="thumb">
          <span class="news-cat-badge">${item.category || 'ニュース'}</span>
        </div>
        <div class="news-card-body">
          <div class="news-card-title">${item.title}</div>
          <div class="news-meta-info">
            <span>${item.source || '全日本日報'}</span>
            <span>•</span>
            <span>${item.time || '1時間前'}</span>
          </div>
        </div>
      </div>
    `;
  });

  // サジェスト表示 (3周目のみ)
  const suggestsContainer = document.getElementById('search-suggests');
  const suggestsTags = document.getElementById('suggest-tags');
  if (suggestsContainer && suggestsTags) {
    if (gameState.loop === 3 && window.GAME_DATABASE.browser.suggests) {
      suggestsContainer.style.display = 'block';
      suggestsTags.innerHTML = "";
      window.GAME_DATABASE.browser.suggests.forEach(tag => {
        suggestsTags.innerHTML += `<span class="suggest-tag" onclick="searchBrowserKeyword('${tag}')">${tag}</span>`;
      });
    } else {
      suggestsContainer.style.display = 'none';
    }
  }
}

// 記事本文のメモ転記
let currentWebpageTitle = "";
let currentWebpageText = "";

function clipCurrentPageToMemo() {
  const memoArea = document.getElementById('meta-memo-area');
  if (!memoArea) return;

  const clipText = `\n【転記: ${currentWebpageTitle}】\n${currentWebpageText}\n`;
  memoArea.value = (memoArea.value + clipText).trim();
  localStorage.setItem('game_memo', memoArea.value);

  showPushNotification("26__0094", "記事を調査メモへ転記しました", "clipboard-check");
  playSystemSound("success");
}

function handleBrowserSearch(e) {
  if (e.key === 'Enter') {
    const q = e.target.value.trim();
    if (q) {
      searchBrowserKeyword(q);
    }
  }
}

function searchBrowserKeyword(q) {
  gameState.browserSearchQuery = q;
  const input1 = document.getElementById('browser-search-input');
  if (input1) input1.value = q;
  const input2 = document.getElementById('browser-main-search');
  if (input2) input2.value = q;

  const curLoop = parseInt(gameState.loop || 1, 10);
  let results = (window.GAME_DATABASE.browser.searchResults && window.GAME_DATABASE.browser.searchResults[q]) || [];

  // もし完全一致で見つからない場合は部分一致でキーを検索
  if (results.length === 0 && window.GAME_DATABASE.browser.searchResults) {
    for (const key in window.GAME_DATABASE.browser.searchResults) {
      if (q.includes(key) || key.includes(q)) {
        results = results.concat(window.GAME_DATABASE.browser.searchResults[key]);
      }
    }
  }
  
  // 周回制限で厳密にフィルタリング（型安全：数値・文字列どちらでも確実判定）
  const filtered = results.filter(item => {
    const min = (item.minLoop !== undefined && item.minLoop !== "" && item.minLoop !== null) ? parseInt(item.minLoop, 10) : null;
    const max = (item.maxLoop !== undefined && item.maxLoop !== "" && item.maxLoop !== null) ? parseInt(item.maxLoop, 10) : null;
    if (min !== null && !isNaN(min) && curLoop < min) return false;
    if (max !== null && !isNaN(max) && curLoop > max) return false;
    return true;
  });

  // 画面切り替え
  const bHome = document.getElementById('browser-home');
  if (bHome) bHome.style.display = 'none';
  const bPage = document.getElementById('browser-webpage');
  if (bPage) bPage.style.display = 'none';
  const bResults = document.getElementById('browser-results');
  if (bResults) bResults.style.display = 'block';
  
  const qText = document.getElementById('search-query-text');
  if (qText) qText.innerText = q;
  const countEl = document.getElementById('search-count');
  if (countEl) countEl.innerText = filtered.length;

  const listContainer = document.getElementById('search-results-list');
  if (listContainer) {
    listContainer.innerHTML = "";
    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div style="padding:20px 0; text-align:center;">
          <strong>見つかりません。別のワードで検索してください。</strong>
          <p style="color:var(--text-muted); font-size:12px; margin-top:8px;">学内データアクセス権が不足しているか、無効なURLです。</p>
        </div>
      `;
    } else {
      filtered.forEach(item => {
        listContainer.innerHTML += `
          <div class="search-result-item">
            <a href="#" onclick="openBrowserPage('${item.url}')">${item.title}</a>
            <p>${item.desc}</p>
          </div>
        `;
      });
    }
  }

  pushBrowserHistory("results");
  logWriteToGAS("BROWSER_SEARCH", `検索実行: ${q}`);
}

function openBrowserPage(pageId) {
  const page = window.GAME_DATABASE.browser.pagesContent[pageId];
  if (!page) {
    showIpadModal("404 Not Found", "お探しの記事またはページは見つかりませんでした。\nURLが変更されたか、掲載が終了した可能性があります。");
    return;
  }

  currentWebpageTitle = page.title;
  currentWebpageText = page.content.replace(/<[^>]*>?/gm, '');

  const bHome = document.getElementById('browser-home');
  if (bHome) bHome.style.display = 'none';
  const bResults = document.getElementById('browser-results');
  if (bResults) bResults.style.display = 'none';
  const bPage = document.getElementById('browser-webpage');
  if (bPage) bPage.style.display = 'block';

  const wTitle = document.getElementById('webpage-title');
  if (wTitle) wTitle.innerHTML = page.title;
  
  const wMeta = document.getElementById('webpage-meta');
  if (wMeta) {
    const sourceName = page.source || "東金タイムズ";
    const postTime = page.date || "2126/08/22 10:00 配信";
    wMeta.innerText = `${postTime} | ${sourceName}`;
  }

  const wContent = document.getElementById('webpage-content');
  if (wContent) wContent.innerHTML = page.content;

  const backBtn = document.getElementById('browser-back-btn');
  if (backBtn) backBtn.disabled = false;

  pushBrowserHistory("webpage");
  logWriteToGAS("BROWSER_PAGE_VIEW", `ページ閲覧: ${pageId}`);
}

function goBrowserHome() {
  const bResults = document.getElementById('browser-results');
  if (bResults) bResults.style.display = 'none';
  const bPage = document.getElementById('browser-webpage');
  if (bPage) bPage.style.display = 'none';
  const bHome = document.getElementById('browser-home');
  if (bHome) bHome.style.display = 'block';
  
  const input1 = document.getElementById('browser-search-input');
  if (input1) input1.value = "";
  const input2 = document.getElementById('browser-main-search');
  if (input2) input2.value = "";
  
  gameState.browserHistory = [];
  const backBtn = document.getElementById('browser-back-btn');
  if (backBtn) backBtn.disabled = true;
}

function pushBrowserHistory(state) {
  gameState.browserHistory.push(state);
  const backBtn = document.getElementById('browser-back-btn');
  if (backBtn) backBtn.disabled = false;
}

function backBrowserPage() {
  if (gameState.browserHistory.length <= 1) {
    goBrowserHome();
    return;
  }
  
  gameState.browserHistory.pop(); // 現在を破棄
  const prevState = gameState.browserHistory[gameState.browserHistory.length - 1];

  if (prevState === "results") {
    document.getElementById('browser-webpage').style.display = 'none';
    document.getElementById('browser-home').style.display = 'none';
    document.getElementById('browser-results').style.display = 'block';
  } else {
    goBrowserHome();
  }
}

// ==========================================================================
// ③ メッセージアプリ「LINK」ロジック
// ==========================================================================
function renderLinkChatList() {
  const container = document.getElementById('link-chat-list');
  container.innerHTML = "";

  // 3周目の場合は不気味変化後の友達リストを使用
  const contactSource = (gameState.loop === 3) 
    ? window.GAME_DATABASE.linkApp.contactsLoop3 
    : window.GAME_DATABASE.linkApp.contacts;

  // 現在追加されている友達のみにフィルター
  const visible = contactSource.filter(c => gameState.addedFriends.includes(c.id));

  visible.forEach(c => {
    const isActive = gameState.activeChatContact === c.id ? "active" : "";
    container.innerHTML += `
      <div class="link-chat-item ${isActive}" onclick="openLinkChat('${c.id}')">
        <div class="link-avatar">${c.icon}</div>
        <div class="link-item-info">
          <div class="link-item-name">${c.name}</div>
          <div class="link-item-preview">${c.desc}</div>
        </div>
      </div>
    `;
  });
}

function openLinkChat(contactId) {
  gameState.activeChatContact = contactId;
  renderLinkChatList();

  const contactSource = (gameState.loop === 3) 
    ? window.GAME_DATABASE.linkApp.contactsLoop3 
    : window.GAME_DATABASE.linkApp.contacts;
  
  const c = contactSource.find(item => item.id === contactId);
  const headerNameEl = document.getElementById('chat-contact-name');
  if (headerNameEl) headerNameEl.innerText = c ? c.name : "トークルーム";

  const messageArea = document.getElementById('link-messages-container');
  if (!messageArea) return;
  messageArea.innerHTML = "";

  const messages = window.GAME_DATABASE.linkApp.chats[contactId] || [];
  const filteredMessages = messages.filter(msg => {
    if (msg.minLoop && gameState.loop < msg.minLoop) return false;
    if (msg.maxLoop && gameState.loop > msg.maxLoop) return false;
    return true;
  });
  
  filteredMessages.forEach(msg => {
    const isMe = msg.sender === "me" || msg.sender === "yada";
    const bubbleClass = isMe ? "outgoing" : "incoming";
    messageArea.innerHTML += `
      <div class="message-bubble ${bubbleClass}">
        ${msg.text}
        <span class="message-time">${msg.time}</span>
      </div>
    `;
  });

  // 3周目の不気味演出
  if (gameState.loop === 3 && contactId === 'fukasawa') {
    messageArea.innerHTML += `<div class="link-welcome-msg" style="color:var(--system-red); font-size:11px; margin-top:8px; text-align:center;">⚠️ 警告：接続中の相手はシステム保安局により物理的に排除された可能性があります。</div>`;
  }

  messageArea.scrollTop = messageArea.scrollHeight;
  logWriteToGAS("LINK_CHAT_OPEN", `LINKトークを開きました: ${contactId}`);
}

// LINKメッセージ送信（リアルな送信失敗エラー演出）
function handleLinkInputKey(e) {
  if (e.key === 'Enter') {
    sendCustomLinkMessage();
  }
}

function sendCustomLinkMessage() {
  const input = document.getElementById('link-input-text');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  if (!gameState.activeChatContact) {
    showIpadModal("LINK", "左のリストから送信先のトークルームを選択してください。");
    return;
  }

  const messageArea = document.getElementById('link-messages-container');
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const msgId = "msg_" + Date.now();

  // 1. 自分の吹き出しを即座に追加
  messageArea.innerHTML += `
    <div class="message-bubble outgoing" id="${msgId}">
      ${text}
      <span class="message-time">${timeStr}</span>
      <div class="msg-status-sending" style="font-size:10px; color:#a1a1aa; margin-top:2px;">送信中…</div>
    </div>
  `;
  input.value = "";
  messageArea.scrollTop = messageArea.scrollHeight;
  playSystemSound("dtmf");

  // 2. 2秒後に「送信失敗」のリアルなシステムエラー表示
  setTimeout(() => {
    const bubbleEl = document.getElementById(msgId);
    if (bubbleEl) {
      const sendingTag = bubbleEl.querySelector('.msg-status-sending');
      if (sendingTag) {
        sendingTag.outerHTML = `
          <div class="msg-error-tag">
            <i data-lucide="alert-circle" style="width:12px; height:12px;"></i> 送信できませんでした（通信エラー）
          </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    }
    showPushNotification("LINK", "メッセージの送信に失敗しました", "alert-circle");
    playSystemSound("error");
  }, 2000);

  logWriteToGAS("LINK_SEND_ATTEMPT", `メッセージ送信試行 (${gameState.activeChatContact}): ${text}`);
}

// --- LINK専用 QRコード友達追加 ---
function openLinkQr() {
  const modal = document.getElementById('link-qr-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  
  const resultBox = document.getElementById('link-qr-result');
  if (resultBox) {
    resultBox.innerText = "カメラを起動しています...";
    resultBox.className = "qr-result-box";
  }

  startQrScanner('link-video', 'link-canvas', handleLinkQrScan, 'link-qr-result');
  if (typeof lucide !== 'undefined') lucide.createIcons();
  logWriteToGAS("LINK_QR_MODAL_OPEN", "LINK友達追加QRリーダーを起動しました。");
}

function closeLinkQr() {
  const modal = document.getElementById('link-qr-modal');
  if (modal) modal.style.display = 'none';
  stopAllCameraStreams();
}

function handleLinkQrScan(data, resultBox) {
  const cleanData = (data || '').trim();
  const friendMap = window.GAME_DATABASE.linkApp.addFriendQr || {};
  const friend = friendMap[cleanData];

  if (friend) {
    // 友達リストに追加
    if (!gameState.addedFriends.includes(friend.id)) {
      gameState.addedFriends.push(friend.id);
      saveStateToStorage();
    }

    if (resultBox) {
      resultBox.innerText = `✅ ${friend.name} を友達に追加しました！`;
      resultBox.className = "qr-result-box success";
    }

    showPushNotification("LINK", `${friend.name} を友達に追加しました`, "user-plus");
    playSystemSound("fanfare");
    logWriteToGAS("LINK_FRIEND_ADDED", `LINK友達追加成功: ${friend.name} (${cleanData})`);

    // 1秒後にモーダルを閉じてトーク画面を自動オープン
    setTimeout(() => {
      closeLinkQr();
      renderLinkChatList();
      openLinkChat(friend.id);
    }, 1100);
  } else {
    // 未知のコード
    if (resultBox) {
      resultBox.innerText = `⚠️ 未登録のQRコードです: ${cleanData}`;
      resultBox.className = "qr-result-box error";
    }
    playSystemSound("error");
    logWriteToGAS("LINK_QR_UNKNOWN", `LINK未登録QRコードスキャン: ${cleanData}`);
  }
}

function handleManualLinkQr() {
  const input = document.getElementById('link-manual-qr-input');
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;
  
  const resultBox = document.getElementById('link-qr-result');
  handleLinkQrScan(val, resultBox);
  input.value = "";
}

function simulateQrScan(qrCode) {
  const resultBox = document.getElementById('link-qr-result');
  handleLinkQrScan(qrCode, resultBox);
}

// ==========================================================================
// ④ 偽Googleフォーム & 偽スプレッドシート（ハッキング）
// ==========================================================================
function openHackingForm() {
  const modal = document.getElementById('hacking-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.getElementById('gform-view').style.display = 'block';
  document.getElementById('gsheet-view').style.display = 'none';
  
  const form = window.GAME_DATABASE.hacking.form;
  document.getElementById('gform-title').innerText = form.title;
  document.getElementById('gform-desc').innerText = form.description;

  if (typeof lucide !== 'undefined') lucide.createIcons();
  logWriteToGAS("HACKING_FORM_OPEN", "2126年メンタルヘルス・スキャンを表示しました。");
}

function submitGForm() {
  showIpadModal("アクセス権限エラー", "エラー：送信に必要なネットワーク権限が不足しています。\n学友会執行委員会またはU.Z.W.の編集者アカウントで実行してください。");
  logWriteToGAS("HACKING_FORM_SUBMIT_FAILED", "メンタルヘルススキャンの送信を試みましたが、権限不足で弾かれました。");
}

function openGSpreadsheet(e) {
  if (e) e.preventDefault();
  document.getElementById('gform-view').style.display = 'none';
  document.getElementById('gsheet-view').style.display = 'flex';

  if (!gameState.activeGSheetTab) {
    const ss = window.GAME_DATABASE.hacking.spreadsheet;
    gameState.activeGSheetTab = (ss && ss.sheets && ss.sheets.length > 0) ? ss.sheets[0] : "名簿データ";
  }
  gameState.isGSheetEditing = false;

  renderGSpreadsheet();
  showPushNotification("システム保安局", "機密スプレッドシートへの侵入を検知しました", "database");
  logWriteToGAS("HACKING_SPREADSHEET_OPEN", "偽スプレッドシートに侵入しました！");
}

function toggleGSheetEdit() {
  gameState.isGSheetEditing = !gameState.isGSheetEditing;
  const btn = document.getElementById('gsheet-edit-btn');
  const label = document.getElementById('gsheet-edit-label');
  
  if (btn && label) {
    if (gameState.isGSheetEditing) {
      btn.classList.add('editing');
      label.innerText = "閲覧モードに戻す";
      showPushNotification("スプレッドシート", "セルを直接タップして編集できます", "edit-3");
    } else {
      btn.classList.remove('editing');
      label.innerText = "編集モード";
    }
  }
  renderGSpreadsheet();
}

function renderGSpreadsheet() {
  const ss = window.GAME_DATABASE.hacking.spreadsheet;
  if (!ss) return;

  const filenameEl = document.getElementById('gsheet-filename');
  if (filenameEl) filenameEl.innerText = ss.title;

  const tabsContainer = document.getElementById('gsheet-tabs');
  if (tabsContainer) {
    tabsContainer.innerHTML = "";
    ss.sheets.forEach(sheetName => {
      const activeClass = gameState.activeGSheetTab === sheetName ? "active" : "";
      tabsContainer.innerHTML += `
        <button class="gsheet-tab-btn ${activeClass}" onclick="switchGSheetTab('${sheetName}')">${sheetName}</button>
      `;
    });
  }

  const table = document.getElementById('gsheet-table');
  if (!table) return;

  const currentTab = gameState.activeGSheetTab || ss.sheets[0] || "名簿データ";
  const headers = (ss.headers && ss.headers[currentTab]) || [];
  const rows = (ss.rows && ss.rows[currentTab]) || (ss.data && ss.data[currentTab]) || [];
  const isEditing = !!gameState.isGSheetEditing;

  // 列記号 (A, B, C, D...)
  const colLetters = headers.map((_, i) => String.fromCharCode(65 + i));

  let html = `<thead><tr><th class="gsheet-row-num">#</th>`;
  headers.forEach((h, i) => {
    html += `<th>${colLetters[i] || ''} <span style="color:#202124; font-weight:normal; margin-left:4px;">(${h})</span></th>`;
  });
  html += `</tr></thead><tbody>`;

  rows.forEach((row, rIdx) => {
    html += `<tr><td class="gsheet-row-num">${rIdx + 1}</td>`;
    row.forEach((cell, cIdx) => {
      const editableAttr = isEditing ? 'contenteditable="true" onblur="handleCellEdit(this, \'' + currentTab + '\', ' + rIdx + ', ' + cIdx + ')"' : '';
      html += `<td class="gsheet-cell" ${editableAttr}>${cell}</td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody>`;
  table.innerHTML = html;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function handleCellEdit(cellEl, tab, rIdx, cIdx) {
  const ss = window.GAME_DATABASE.hacking.spreadsheet;
  if (ss && ss.rows && ss.rows[tab] && ss.rows[tab][rIdx]) {
    ss.rows[tab][rIdx][cIdx] = cellEl.innerText;
  }
}

function switchGSheetTab(sheetName) {
  gameState.activeGSheetTab = sheetName;
  renderGSpreadsheet();
}

function closeHacking() {
  const modal = document.getElementById('hacking-modal');
  if (modal) modal.style.display = 'none';
}

// ==========================================================================
// ⑤ LMS「manaba」（千葉工業大学）
// ==========================================================================
function initManabaApp() {
  if (gameState.manabaUser) {
    document.getElementById('manaba-login-view').style.display = 'none';
    document.getElementById('manaba-portal-view').style.display = 'block';
    renderManabaPortal();
  } else {
    document.getElementById('manaba-login-view').style.display = 'flex';
    document.getElementById('manaba-portal-view').style.display = 'none';
  }
}

function handleManabaLogin() {
  const id = document.getElementById('manaba-id-input').value.trim();
  const pass = document.getElementById('manaba-pass-input').value.trim();
  const user = window.GAME_DATABASE.manaba.users[id];

  if (user && user.pass === pass) {
    gameState.manabaUser = id;
    saveStateToStorage();
    playSystemSound("success");
    showPushNotification("manaba", `ようこそ、${user.name} さん`, "check-circle");
    initManabaApp();
    logWriteToGAS("MANABA_LOGIN_SUCCESS", `manabaログイン成功: ${user.name} (${id})`);
  } else {
    playSystemSound("error");
    showIpadModal("認証エラー", "ユーザーIDまたはパスワードが正しくありません。\n学生証裏面の初期パスワード、またはPC設定を確認してください。");
    logWriteToGAS("MANABA_LOGIN_FAILED", `ログイン失敗試行: ${id}`);
  }
}

const loginManaba = handleManabaLogin;

function handleManabaLogout() {
  gameState.manabaUser = null;
  saveStateToStorage();
  initManabaApp();
  logWriteToGAS("MANABA_LOGOUT", "manabaからログアウトしました。");
}

const logoutManaba = handleManabaLogout;

function switchManabaTab(tabId) {
  gameState.activeManabaTab = tabId;
  document.querySelectorAll('.manaba-nav-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.manaba-panel').forEach(panel => panel.classList.remove('active'));

  const activeBtn = Array.from(document.querySelectorAll('.manaba-nav-btn')).find(b => {
    const oc = b.getAttribute('onclick');
    return oc && oc.includes(tabId);
  });
  if (activeBtn) activeBtn.classList.add('active');

  const panel = document.getElementById(`manaba-panel-${tabId}`);
  if (panel) panel.classList.add('active');
}

function renderManabaPortal() {
  const user = window.GAME_DATABASE.manaba.users[gameState.manabaUser];
  if (!user) return;

  const userEl = document.getElementById('manaba-user-display') || document.getElementById('manaba-user-name');
  if (userEl) {
    userEl.innerText = `${user.name} (${user.studentId})`;
  }

  // 時間割描画
  const tbody = document.getElementById('manaba-timetable-body');
  if (tbody) {
    tbody.innerHTML = "";
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    for (let period = 0; period < 5; period++) {
      let rowHtml = `<tr><td class="timetable-period">${period + 1}限</td>`;
      days.forEach(day => {
        const subject = (user.timetable && user.timetable[day]) ? user.timetable[day][period] : "空き";
        const isTarget = subject && (subject.includes("21世紀会計史") || subject.includes("情報科学特論") || subject.includes("時間軸"));
        const highlightStyle = isTarget ? "color:var(--manaba-green); font-weight:bold; cursor:pointer;" : "";
        const clickAction = isTarget ? "onclick='openManabaCourse()'" : "";
        rowHtml += `<td class="timetable-cell" style="${highlightStyle}" ${clickAction}>${subject || '空き'}</td>`;
      });
      rowHtml += "</tr>";
      tbody.innerHTML += rowHtml;
    }
  }
}

function openManabaCourse() {
  document.getElementById('manaba-panel-mypage').classList.remove('active');
  document.getElementById('manaba-panel-courses').classList.remove('active');
  document.getElementById('manaba-course-detail-view').style.display = 'block';

  const course = window.GAME_DATABASE.manaba.courseDetail;
  document.getElementById('manaba-course-title').innerText = course.name;
  document.getElementById('manaba-course-teacher').innerText = course.teacher;
  document.getElementById('manaba-course-term').innerText = course.term;

  const newsList = document.getElementById('manaba-course-news-list');
  newsList.innerHTML = "";
  course.news.forEach(news => {
    newsList.innerHTML += `<li><strong>${news.date}</strong><br>${news.title}</li>`;
  });

  const materialsList = document.getElementById('manaba-materials-list');
  materialsList.innerHTML = "";
  course.materials.forEach(mat => {
    materialsList.innerHTML += `
      <div class="course-material-item" onclick="openPdfViewer(${mat.id})">
        <div>
          <strong>${mat.title}</strong>
          <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">ファイル: ${mat.file}</div>
        </div>
        <i data-lucide="file-text" style="width:18px; height:18px; color:var(--manaba-green);"></i>
      </div>
    `;
  });
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  
  logWriteToGAS("MANABA_COURSE_OPEN", "manabaコース詳細を開きました。");
}

function backToManabaPortal() {
  document.getElementById('manaba-course-detail-view').style.display = 'none';
  switchManabaTab(gameState.activeManabaTab);
}

function openPdfViewer(materialId) {
  const course = window.GAME_DATABASE.manaba.courseDetail;
  const mat = course.materials.find(m => m.id === materialId);
  if (mat) {
    document.getElementById('manaba-pdf-viewer').style.display = 'flex';
    document.getElementById('pdf-filename').innerText = mat.file;
    document.getElementById('pdf-viewer-body').innerHTML = `
      <div style="border-bottom: 2px solid var(--manaba-green); padding-bottom:12px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h3 style="margin:0 0 4px 0;">千葉工業大学 講義配付資料</h3>
          <strong>授業名: ${course.name} (第${mat.id}回)</strong>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="clipTextToMemo('${mat.title}', '${mat.content.replace(/'/g, "\\'")}')"><i data-lucide="clipboard-copy"></i> メモに転記</button>
      </div>
      <p style="font-size:14px; font-weight:700; color:#333; margin-bottom:10px;">${mat.title}</p>
      <div style="background:#fafafa; border:1px solid #ddd; padding:15px; border-radius:6px; font-family:monospace; line-height:1.8; font-size:13px; color:#222;">
        ${mat.content}
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    logWriteToGAS("MANABA_PDF_VIEW", `授業資料PDF閲覧: ${mat.file}`);
  }
}

function clipTextToMemo(title, text) {
  const memoArea = document.getElementById('meta-memo-area');
  if (!memoArea) return;

  const clipText = `\n【資料転記: ${title}】\n${text}\n`;
  memoArea.value = (memoArea.value + clipText).trim();
  localStorage.setItem('game_memo', memoArea.value);

  showPushNotification("26__0094", "講義資料を調査メモへ転記しました", "clipboard-check");
  playSystemSound("success");
}

function closePdfViewer() {
  document.getElementById('manaba-pdf-viewer').style.display = 'none';
}

// ==========================================================================
// ⑥ メールアプリ
// ==========================================================================
function renderMailList() {
  const container = document.getElementById('mail-list');
  if (!container) return;
  container.innerHTML = "";

  const mails = window.GAME_DATABASE.mailApp[gameState.loop] || [];
  mails.forEach(mail => {
    container.innerHTML += `
      <div class="mail-item" onclick="openMail('${mail.id}')" id="mail-item-${mail.id}">
        <div class="mail-item-sender">${mail.sender}</div>
        <div class="mail-item-title">${mail.subject || mail.title}</div>
        <div class="mail-item-date">${mail.date}</div>
      </div>
    `;
  });
}

function openMail(mailId) {
  document.querySelectorAll('.mail-item').forEach(el => el.classList.remove('active'));
  const activeItem = document.getElementById(`mail-item-${mailId}`);
  if (activeItem) activeItem.classList.add('active');

  const mails = window.GAME_DATABASE.mailApp[gameState.loop] || [];
  const mail = mails.find(m => m.id === mailId);

  if (mail) {
    document.getElementById('mail-body-header').innerHTML = `
      <div class="mail-body-title">${mail.subject || mail.title}</div>
      <div style="font-size:12px; color:var(--text-muted);">
        差出人: <strong>${mail.sender}</strong> &lt;学内通信サーバー&gt;<br>
        日付: ${mail.date}
      </div>
    `;
    document.getElementById('mail-body-content').innerText = mail.body;
    logWriteToGAS("MAIL_OPEN", `メールを開きました: ${mailId}`);
  }
}

// ==========================================================================
// ⑦ 電話アプリ（コール音 ＆ 音声ガイダンス演出 ＆ **##** 隠しコマンド）
// ==========================================================================
let phoneCallAudioTimer = null;

function pressPhoneKey(key) {
  if (gameState.phoneInput.length < 15) {
    gameState.phoneInput += key;
    document.getElementById('phone-display').innerText = gameState.phoneInput;
    playSystemSound("dtmf");

    // 『**##**』が入力された瞬間に隠しスタッフ画面を起動
    if (gameState.phoneInput === '**##**') {
      clearPhoneKey();
      playSystemSound("fanfare");
      showStaffModal();
      return;
    }
  }
}

function clearPhoneKey() {
  gameState.phoneInput = "";
  const display = document.getElementById('phone-display');
  if (display) display.innerText = "";
}

function makePhoneCall() {
  if (!gameState.phoneInput) {
    showIpadModal("電話", "電話番号を入力してください。");
    return;
  }
  
  const dialNum = gameState.phoneInput.trim();

  // 隠しコマンド判定（『**##**』のみ）
  if (dialNum === '**##**') {
    clearPhoneKey();
    playSystemSound("fanfare");
    showStaffModal();
    return;
  }

  const overlay = document.getElementById('phone-calling-overlay');
  document.getElementById('phone-calling-number').innerText = dialNum;
  document.getElementById('phone-calling-status').innerText = "発信中...";
  document.getElementById('phone-audio-subtitles').innerText = "プルルル…… プルルル……";
  overlay.style.display = 'flex';

  playSystemSound("ringback");
  // 1.5秒後に2回目の「プルルルルル……」
  setTimeout(() => {
    if (overlay && overlay.style.display !== 'none') {
      playSystemSound("ringback");
    }
  }, 1400);

  logWriteToGAS("PHONE_CALL_ATTEMPT", `発信試行: ${dialNum}`);

  // 3.0秒後に音声ガイダンスアナウンスへ移行
  phoneCallAudioTimer = setTimeout(() => {
    document.getElementById('phone-calling-status').innerText = "ガイダンス応答";
    const guidanceText = "おかけになった電話番号は、現在使われておりません。または時間線の不整合により接続できません。番号をお確かめになって、もう一度お掛け直しください。";
    document.getElementById('phone-audio-subtitles').innerText = `「${guidanceText}」`;
    
    // Web Speech API で音声合成アナウンス（日本語女性トーン）
    speakGuidanceAudio(guidanceText);

    // 6.5秒後に自動切断
    setTimeout(() => {
      endPhoneCall();
    }, 6500);
  }, 3000);
}

function speakGuidanceAudio(text) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = 0.95;
    utterance.pitch = 1.1;
    window.speechSynthesis.speak(utterance);
  }
}

function endPhoneCall() {
  if (phoneCallAudioTimer) {
    clearTimeout(phoneCallAudioTimer);
    phoneCallAudioTimer = null;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  const overlay = document.getElementById('phone-calling-overlay');
  if (overlay) overlay.style.display = 'none';
  clearPhoneKey();
  playSystemSound("error");
}

// 端末完全再読み込み（リロード）
function reloadIpadPage() {
  showPushNotification("システム再読み込み", "iPad画面を完全リフレッシュしています...", "refresh-cw");
  setTimeout(() => {
    location.reload();
  }, 350);
}

// ==========================================================================
// ⑧ 設定アプリ
// ==========================================================================
function switchSettingsTab(tabId) {
  document.querySelectorAll('.settings-menu-item').forEach(btn => btn.classList.remove('active'));
  const activeBtn = Array.from(document.querySelectorAll('.settings-menu-item')).find(btn => {
    const oc = btn.getAttribute('onclick');
    return oc && oc.includes(tabId);
  });
  if (activeBtn) activeBtn.classList.add('active');
}

function triggerSettingsRestriction(itemName) {
  showIpadModal("アクセス制限", `「${itemName}」へのアクセスは、大学保安局および学友会執行委員会システム監視室の保安ポリシーにより制限されています。`);
  logWriteToGAS("SETTINGS_RESTRICTED_ACCESS", `制限機能へのアクセス試行: ${itemName}`);
}

// ==========================================================================
// 音響効果 ＆ ログ送信ユーティリティ（Safari完全対応 Web Audio シンセサイザー）
// ==========================================================================
let globalAudioCtx = null;

function getAudioContext() {
  if (!globalAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      globalAudioCtx = new AudioContextClass();
    }
  }
  if (globalAudioCtx && globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume().catch(() => {});
  }
  return globalAudioCtx;
}

// ユーザーの画面タッチ時に Safari の AudioContext ロックを一発解除
function unlockSafariAudio() {
  const ctx = getAudioContext();
  if (ctx) {
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        console.log("🔊 Safari AudioContext unlocked successfully!");
      }).catch(() => {});
    }
    // 無音バッファを1回再生して確実にアンロック
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch (e) {}
  }
}

// 画面タッチ・クリックで自動アンロックを登録
['touchstart', 'touchend', 'click', 'pointerdown'].forEach(evt => {
  document.addEventListener(evt, unlockSafariAudio, { once: false, passive: true });
});

// WAV PCM Data-URI 生成エンジン（Safari完全互換）
function generateWavDataUri(type) {
  const sampleRate = 22050;
  let duration = 0.25;
  let samples = [];

  if (type === "notif" || type === "success") {
    duration = 0.35;
    const totalSamples = Math.floor(sampleRate * duration);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let freq = t < 0.12 ? 587.33 : 880.00;
      let env = Math.exp(-t * 6);
      samples.push(Math.sin(2 * Math.PI * freq * t) * env * 0.7);
    }
  } else if (type === "alarm" || type === "error") {
    duration = 0.75;
    const totalSamples = Math.floor(sampleRate * duration);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let freq = type === "alarm" ? (440 + Math.sin(2 * Math.PI * 4 * t) * 220) : 180;
      let env = type === "error" ? Math.exp(-t * 5) : 0.8;
      samples.push((Math.sin(2 * Math.PI * freq * t) > 0 ? 0.7 : -0.7) * env);
    }
  } else if (type === "fanfare") {
    duration = 0.85;
    const totalSamples = Math.floor(sampleRate * duration);
    const freqs = [523.25, 659.25, 783.99, 1046.50];
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const noteIdx = Math.min(3, Math.floor(t / 0.2));
      const freq = freqs[noteIdx];
      let env = Math.exp(-(t % 0.2) * 5);
      samples.push(Math.sin(2 * Math.PI * freq * t) * env * 0.8);
    }
  } else if (type === "distortion") {
    duration = 1.0;
    const totalSamples = Math.floor(sampleRate * duration);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let freq = 120 + (t < 0.5 ? t * 1200 : (1.0 - t) * 1200);
      samples.push((Math.sin(2 * Math.PI * freq * t) + Math.sin(4 * Math.PI * freq * t) * 0.4) * 0.7);
    }
  } else if (type === "ringback") {
    // 日本の電話呼出音（400Hz + 16Hz 振幅変調「プルルルルル……」）
    duration = 1.0;
    const totalSamples = Math.floor(sampleRate * duration);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      // 400Hz の正弦波に 16Hz の振幅変調を適用
      const carrier = Math.sin(2 * Math.PI * 400 * t);
      const modulation = 0.5 + 0.5 * Math.sin(2 * Math.PI * 16 * t);
      // エンベロープ（最初と最後をわずかにフェード）
      let env = 1.0;
      if (t < 0.02) env = t / 0.02;
      if (t > 0.98) env = (1.0 - t) / 0.02;
      samples.push(carrier * modulation * env * 0.75);
    }
  } else {
    // beep / dtmf
    duration = 0.18;
    const totalSamples = Math.floor(sampleRate * duration);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let freq = type === "dtmf" ? 697 : 800;
      samples.push(Math.sin(2 * Math.PI * freq * t) * 0.6);
    }
  }

  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

function playSystemSound(type) {
  // 1. HTML5 <audio> エレメントでの直接再生（Safariの最も確実な再生方式）
  try {
    const audioEl = document.getElementById('master-system-audio');
    if (audioEl) {
      audioEl.src = generateWavDataUri(type);
      audioEl.volume = 1.0;
      audioEl.play().catch(e => {
        console.warn("HTML5 audio playback error:", e);
      });
    }
  } catch (err) {
    console.warn("Audio Element fallback error:", err);
  }

  // 2. Web Audio API での同時シンセサイズ再生（ハイブリッドバックアップ）
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    if (type === "beep" || type === "dtmf") {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(type === "dtmf" ? 697 : 800, ctx.currentTime);
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === "success" || type === "notif") {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc2.frequency.setValueAtTime(880.00, ctx.currentTime + 0.08);
      osc1.connect(ctx.destination);
      osc2.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.08);
      osc2.start(ctx.currentTime + 0.08);
      osc2.stop(ctx.currentTime + 0.3);
    } else if (type === "error" || type === "alarm") {
      const osc = ctx.createOscillator();
      osc.type = type === "alarm" ? "sawtooth" : "square";
      osc.frequency.setValueAtTime(type === "alarm" ? 440 : 150, ctx.currentTime);
      if (type === "alarm") {
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.4);
      }
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (type === "alarm" ? 0.6 : 0.25));
    } else if (type === "fanfare") {
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
        osc.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.12);
        osc.stop(ctx.currentTime + i * 0.12 + 0.3);
      });
    }
  } catch (e) {
    console.warn("Audio Context playback error:", e);
  }
}

// GASへの非同期通信ログ送信
function logWriteToGAS(logType, message) {
  console.log(`[LOG - ${logType}] ${message}`);

  localStorage.setItem('mon_last_update', Date.now());
  localStorage.setItem('mon_log_latest', `[${logType}] ${message}`);
  
  const gasUrl = localStorage.getItem('gas_url') || window.GAME_DATABASE.system.gasUrl;
  if (!gasUrl) return;

  const payload = {
    action: "write_log",
    teamId: gameState.teamId,
    loopNum: gameState.loop,
    logType: logType,
    message: message
  };

  fetch(gasUrl, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(err => console.warn("GAS log sending failed: ", err));

  const statusPayload = {
    action: "update_status",
    teamId: gameState.teamId,
    loopNum: gameState.loop,
    statusData: {
      hints: gameState.unlockedHints,
      manabaUser: gameState.manabaUser
    }
  };

  fetch(gasUrl, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(statusPayload)
  }).catch(err => console.warn("GAS status update failed: ", err));
}

// --- 運営画面からのリモートトリガー受信（ホットリロード ＆ 音響同期） ---
window.addEventListener('storage', (e) => {
  if (e.key === 'admin_sound_trigger') {
    const soundType = e.newValue;
    if (soundType) playSystemSound(soundType);
  } else if (e.key === 'admin_alert_trigger') {
    const alertMsg = e.newValue;
    if (alertMsg) showSystemAlert(alertMsg);
  } else if (e.key === 'admin_preset_trigger') {
    try {
      const presetData = JSON.parse(e.newValue);
      if (presetData) {
        if (presetData.loop) triggerLoopReset(presetData.loop);
        if (presetData.alertMsg) showSystemAlert(presetData.alertMsg);
        if (presetData.sound) playSystemSound(presetData.sound);
        if (presetData.forceLock) {
          document.getElementById('lock-screen').classList.remove('hidden');
        }
      }
    } catch(err) {}
  } else if (e.key === 'game_db_cache_trigger') {
    loadGameDatabase();
    updateAppUI();
    showPushNotification("システム", "運営設定が更新されました", "refresh-cw");
  }
});
