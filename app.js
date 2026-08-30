// 2126年 架空iPadOS型 脱出ゲームシステム - アプリ制御ロジック (app.js)

// ⚡ 超軽量スコープ付きLucideアイコンレンダラー（全画面再スキャンを防止し高速化）
function safeCreateIcons(target = null) {
  if (typeof lucide === 'undefined') return;
  try {
    if (target && target.nodeType === 1) {
      lucide.createIcons({ root: target });
    } else {
      lucide.createIcons();
    }
  } catch(e) {
    try { lucide.createIcons(); } catch(err) {}
  }
}

// 🔄 通信中・ロード中インジケータ表示コントローラ
let loadingIndicatorTimer = null;
function showNetworkLoadingIndicator(text = "ロード中…") {
  const indicator = document.getElementById('network-loading-indicator');
  const textEl = document.getElementById('network-loading-text');
  if (indicator) {
    if (textEl) textEl.innerText = text;
    indicator.classList.add('show');
    if (loadingIndicatorTimer) clearTimeout(loadingIndicatorTimer);
    // 3秒後に自動で非表示（タイムアウト安全策）
    loadingIndicatorTimer = setTimeout(() => {
      hideNetworkLoadingIndicator();
    }, 3000);
  }
}

function hideNetworkLoadingIndicator() {
  const indicator = document.getElementById('network-loading-indicator');
  if (indicator) {
    indicator.classList.remove('show');
  }
  if (loadingIndicatorTimer) {
    clearTimeout(loadingIndicatorTimer);
    loadingIndicatorTimer = null;
  }
}

// --- グローバルエラーハンドラー（alertによる画面停止を防止） ---
window.onerror = function(message, source, lineno, colno, error) {
  console.warn(`[JSエラー検知] ${message} at ${source}:${lineno}:${colno}`, error);
  return true; // ブラウザの同期エラー中断を抑制
};

// --- グローバルステート管理 ---
let gameState = {
  loop: 1,
  teamId: "チームA",
  clockStartISO: "2126-09-04T09:04:00",
  clockSetTime: Date.now(), // 設定されたタイミングの現実タイムスタンプ
  timerRunning: false, // スタートするまでは時が進まない（09:04で静止待機）
  unlockedHints: [],
  manabaUser: null,
  addedFriends: ["committee_group"], // 初期友達（全体連絡グループのみ）
  activeApp: null,
  activeMetaTab: "observation",
  activeManabaTab: "mypage",
  activeGSheetTab: "名簿データ",
  currentBrowserPage: "home", // home, results, webpage
  browserHistory: [],
  browserSearchQuery: "",
  activeChatContact: null,
  phoneInput: "",
  alertDismissed: true,
  memoTabs: [{ title: "メモ 1", text: "", drawData: null }],
  activeMemoTabIndex: 0,
  memoMode: "text"
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
        // 基本マスタ構造を最新化しつつ、追加されたチャットメッセージ履歴は確実に保持
        if (window.INITIAL_GAME_DATABASE && window.INITIAL_GAME_DATABASE.linkApp) {
          const cachedChats = (parsed.linkApp && parsed.linkApp.chats) ? parsed.linkApp.chats : null;
          window.GAME_DATABASE.linkApp.contacts = window.INITIAL_GAME_DATABASE.linkApp.contacts;
          window.GAME_DATABASE.linkApp.contactsLoop3 = window.INITIAL_GAME_DATABASE.linkApp.contactsLoop3;
          if (cachedChats && cachedChats['committee_group']) {
            window.GAME_DATABASE.linkApp.chats = cachedChats;
          }
        }
        console.log("Loaded game database from LocalStorage cache (preserved linkApp chat history).");
        return;
      }
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

    // 📝 メモ帳の復元と初期化
    initMetaMemo();

    // 操作制限の適用
    applyOperationalRestrictions();

    // LocalStorage変更イベント購読（運営画面＋演者ツールからのリアルタイム変更をキャッチ）
    window.addEventListener('storage', handleStorageEvent);

    // 🎭 BroadcastChannelリスナー（同一ブラウザ内のactor.html / admin.htmlからの即時受信）
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const actorChannel = new BroadcastChannel('escape_game_channel');
        actorChannel.onmessage = (event) => {
          if (!event.data) return;
          const { type, payload } = event.data;
          if (type === 'actor_message' && payload) {
            console.log('🎭 BroadcastChannel経由で演者メッセージを受信:', payload);
            executeRemoteAdminCommand(payload);
          } else if (type === 'loop_change' && payload && payload.loop) {
            console.log('🌀 BroadcastChannel経由で周回変更を受信:', payload.loop);
            triggerLoopTransition(payload.loop);
          } else if (type === 'preset' && payload && payload.loop) {
            console.log('🎬 BroadcastChannel経由でプリセットを受信:', payload.loop);
            triggerLoopTransition(payload.loop);
          } else if (type === 'master_reset' || type === 'reset_actor_triggers') {
            console.log('🚨 BroadcastChannel経由でマスターリセットを受信');
            performMasterReset();
          }
        };
        console.log('✅ BroadcastChannelリスナーを起動しました (escape_game_channel)');
      } catch(e) {
        console.warn('BroadcastChannel初期化エラー:', e);
      }
    }

    // 🎭 localStorage ポーリング（別端末からの演者コマンドをGAS経由で受信できない場合のフォールバック）
    let _lastActorCmdTime = parseInt(localStorage.getItem('latest_actor_command_time') || '0');
    setInterval(() => {
      const savedTime = parseInt(localStorage.getItem('latest_actor_command_time') || '0');
      if (savedTime > _lastActorCmdTime) {
        _lastActorCmdTime = savedTime;
        try {
          const raw = localStorage.getItem('latest_actor_command');
          if (raw) {
            const cmd = JSON.parse(raw);
            if (cmd && cmd.action === 'actor_message') {
              console.log('🎭 localStorage ポーリング経由で演者コマンドを検出:', cmd);
              executeRemoteAdminCommand(cmd);
            }
          }
        } catch(e) { console.warn('actor command parse error:', e); }
      }
    }, 1000);

    // ロック画面の解除ジェスチャー ＆ タップイベント登録
    initLockScreenGestures();

    // 画面上端からの下スワイプでロック画面（カバーシート）を呼び出し
    initTopSwipeForLockScreen();

    // 画面最下部ホームバーの即時タッチ判定＆上フリックイベント
    initHomeBarEvents();

    // 初期画面構築（ローカルデータで即時描画）
    updateAppUI();

    // 🔋 実機バッテリー連動の開始
    initBatterySync();

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

  // 通信中の微かなパルスアニメーション
  updateWifiStatusIndicator('syncing');

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
          // linkApp & mailAppはdata.jsで一元管理するため、GASによる古いデータ上書きを防止
          if (window.INITIAL_GAME_DATABASE) {
            if (window.INITIAL_GAME_DATABASE.linkApp && (!window.GAME_DATABASE.linkApp || !window.GAME_DATABASE.linkApp.chats)) {
              window.GAME_DATABASE.linkApp = JSON.parse(JSON.stringify(window.INITIAL_GAME_DATABASE.linkApp));
            }
            if (window.INITIAL_GAME_DATABASE.mailApp) {
              window.GAME_DATABASE.mailApp = JSON.parse(JSON.stringify(window.INITIAL_GAME_DATABASE.mailApp));
            }
          }
          if (json.data.lockNotifications) {
            window.GAME_DATABASE.lockNotifications = json.data.lockNotifications;
          }
          if (json.data.system) {
            Object.assign(window.GAME_DATABASE.system, json.data.system);
          }

          updateAppUI();
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

  // コマンドが古い場合はスキップ（30秒以上前の過去コマンドは再実行しない）
  const cmdTimestamp = p.timestamp || cmd.timestamp || 0;
  const cmdAge = cmdTimestamp ? (Date.now() - cmdTimestamp) : 0;
  if (cmdTimestamp && cmdAge > 30000) {
    lastExecutedCommandId = cmd.id;
    localStorage.setItem('last_exec_cmd_id', cmd.id);
    return;
  }

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

  // ③ 周回強制移行（ホーム初期化 ＆ ロック画面 ＆ 09:04静止待機を完全徹底）
  if (isLoopChange) {
    const nextLoop = parseInt(p.loop, 10);
    if (!isNaN(nextLoop)) {
      triggerLoopTransition(nextLoop);
    }
  } else if (p.forceLock === true || p.lock === true) {
    // ④ 明示的なロック画面強制指示
    showLockScreen();
  }

  // ⑤ 時計強制同期（周回変化以外の場合）
  if (p.clockISO && !isLoopChange) {
    localStorage.setItem('fake_clock_start_iso', p.clockISO);
    gameState.clockStartISO = p.clockISO;
    updateAppUI();
  }

  // ⑥ 個別・全体 遠隔リロード（画面フリーズ・キャッシュリフレッシュ）
  if (type === 'device_reload' || type === 'reload' || p.action === 'reload' || cmd.action === 'reload') {
    const target = cmd.target || p.target || 'ALL';
    const myTeam = gameState.teamId || 'iPad-01';
    if (target === 'ALL' || target === myTeam) {
      console.log(`🔄 運営より遠隔リロードを受信しました (対象: ${target})。即時リロードを実行します。`);
      playSystemSound("beep");
      setTimeout(() => {
        location.reload(true);
      }, 300);
      return;
    }
  }

  // ⑦ 公演終了後の一斉データ完全消去＆初期化（マスターリセット）
  if (type === 'master_reset' || p.action === 'master_reset' || cmd.action === 'master_reset') {
    const target = cmd.target || p.target || 'ALL';
    const myTeam = gameState.teamId || 'iPad-01';
    if (target === 'ALL' || target === myTeam) {
      console.log("🚨 運営より公演終了後一斉初期化を受信しました。全データを完全初期化します。");
      const currentTeam = myTeam;
      const gasUrl = localStorage.getItem('gas_url');
      
      // 端末識別子とGAS設定以外を完全消去 ＆ 09:04静止待機に設定
      localStorage.clear();
      localStorage.setItem('team_id', currentTeam);
      localStorage.setItem('game_loop', '1');
      localStorage.setItem('game_timer_running', 'false');
      localStorage.setItem('fake_clock_start_iso', '2126-09-04T09:04:00');
      localStorage.setItem('fake_clock_set_time', String(Date.now()));
      if (gasUrl) localStorage.setItem('gas_url', gasUrl);

      playSystemSound("fanfare");
      setTimeout(() => {
        location.reload(true);
      }, 600);
      return;
    }
  }

  // ⑧ 演者トリガーによるリアルタイムLINKメッセージ配信
  const isActorMsg = (cmd.action === 'actor_message' || type === 'actor_message' || p.action === 'actor_message' || p.type === 'actor_message' || (p.text && p.actor));
  if (isActorMsg) {
    const actor = cmd.actor || p.actor;
    const triggerId = cmd.triggerId || p.triggerId || "";
    const text = cmd.text || p.text;
    const autoReplySender = cmd.autoReplySender || p.autoReplySender;
    const autoReplyText = cmd.autoReplyText || p.autoReplyText;
    
    // 🕒 送信時刻は現実時間ではなく、常にこのiPadの世界線時刻（09:04からのバーチャル時間）を採用
    const msgTime = getFormattedFakeTime();

    if (text) {
      addActorMessageToLinkChat(actor, text, msgTime, triggerId);

      // J（陣内）からの送信でF（深澤）の自動返信が指定されている場合
      // 人間らしい自然なチャット間隔として18秒後（15〜20秒）に深澤が「おけ」と返信・通知
      if (autoReplySender && autoReplyText) {
        setTimeout(() => {
          addActorMessageToLinkChat(autoReplySender, autoReplyText, getFormattedFakeTime(), triggerId ? triggerId + "_autoreply" : "");
        }, 18000);
      }
    }
    return;
  }
}

// 🕒 チャット時刻を常に「HH:mm」形式（例: 09:09）に正規化する関数
function formatChatTime(rawTime) {
  if (!rawTime) return getFormattedFakeTime();
  const str = String(rawTime).trim();
  
  // すでに "09:09" や "15:38" 形式の場合
  if (/^\d{1,2}:\d{2}$/.test(str)) {
    const parts = str.split(':');
    return `${parts[0].padStart(2, '0')}:${parts[1]}`;
  }

  // ISO 8601 文字列 (例: 2026-08-27T15:38:23.000Z) の場合
  if (str.includes('T') || str.includes('-') || str.includes('Z')) {
    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
      }
    } catch(e) {}
  }

  // 文字列中から "HH:mm" を抽出
  const match = str.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }

  return getFormattedFakeTime();
}

// 🎭 演者メッセージをLINKチャットへリアルタイム注入（全体連絡グループ）
function addActorMessageToLinkChat(senderCode, text, timeStr, triggerId) {
  const actorMap = {
    'J': { id: 'jinnai', name: '陣内 樹', icon: 'J' },
    'G': { id: 'sotozono', name: '外園 胡春', icon: 'G' },
    'H': { id: 'higa', name: '比嘉 俊希', icon: 'H' },
    'F': { id: 'fukasawa', name: '深澤 文哉', icon: 'F' },
    'jinnai': { id: 'jinnai', name: '陣内 樹', icon: 'J' },
    'fukasawa': { id: 'fukasawa', name: '深澤 文哉', icon: 'F' },
    'sotozono': { id: 'sotozono', name: '外園 胡春', icon: 'G' },
    'higa': { id: 'higa', name: '比嘉 俊希', icon: 'H' }
  };

  const senderInfo = actorMap[senderCode] || { id: senderCode, name: senderCode, icon: '💬' };
  const targetRoom = 'committee_group';

  if (!window.GAME_DATABASE.linkApp) window.GAME_DATABASE.linkApp = { chats: {} };
  if (!window.GAME_DATABASE.linkApp.chats) window.GAME_DATABASE.linkApp.chats = {};
  if (!window.GAME_DATABASE.linkApp.chats[targetRoom]) window.GAME_DATABASE.linkApp.chats[targetRoom] = [];

  // メッセージの重複登録を防止（同一タイムスタンプまたは同一テキスト）
  const existingList = window.GAME_DATABASE.linkApp.chats[targetRoom];
  const isDuplicate = existingList.some(m => m.sender === senderInfo.id && m.text === text && (Date.now() - (m._addedAt || 0) < 5000));
  if (isDuplicate) {
    console.log(`⚠️ 重複演者メッセージのためスキップ: ${senderInfo.name}「${text}」`);
    return;
  }

  // 1. 全体連絡グループへメッセージを追加
  const cleanTime = formatChatTime(timeStr);
  window.GAME_DATABASE.linkApp.chats[targetRoom].push({
    sender: senderInfo.id,
    date: "今日",
    text: text,
    time: cleanTime,
    _addedAt: Date.now()
  });

  // LocalStorageキャッシュを最新データで保存
  try {
    localStorage.setItem('game_db_cache', JSON.stringify(window.GAME_DATABASE));
  } catch(e) {}

  // 2. LINKアプリが開いている場合は即座に画面へ描画 ＆ スクロール
  if (gameState.activeApp === 'link') {
    openLinkChat('committee_group');
    const msgContainer = document.getElementById('link-messages-container');
    if (msgContainer) {
      msgContainer.scrollTop = msgContainer.scrollHeight;
    }
  }

  // 3. 【重要】LINK上で吹き出しが確実に作成・反映された直後に通知を発火させる
  setTimeout(() => {
    const badge = document.getElementById('dock-link-badge');
    if (badge) {
      badge.style.display = 'flex';
      badge.innerText = String((parseInt(badge.innerText || '0') || 0) + 1);
    }

    playSystemSound("notif");
    showPushNotification("LINK", senderInfo.name, text, "message-circle", () => {
      openApp('link-app');
      openLinkChat('committee_group');
    });

    // 📱 ロック画面の通知センターにもリアルタイムに追加
    if (!gameState.dynamicLockNotifications) gameState.dynamicLockNotifications = [];
    gameState.dynamicLockNotifications.unshift({
      id: "dyn_msg_" + Date.now(),
      app: "LINK",
      icon: "message-circle",
      title: senderInfo.name,
      body: text,
      time: cleanTime,
      targetApp: "link",
      contactId: "committee_group"
    });
    renderLockNotifications();

    const msgContainer = document.getElementById('link-messages-container');
    if (msgContainer) {
      msgContainer.scrollTop = msgContainer.scrollHeight;
    }
  }, 120);

  // 演者ツールへ「LINK反映完了（ACK）」を通知
  if (triggerId) {
    const cleanId = triggerId.replace('_autoreply', '');
    localStorage.setItem(`actor_ack_${cleanId}`, String(Date.now()));
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel('escape_game_channel');
        bc.postMessage({ type: 'actor_message_ack', triggerId: cleanId, timestamp: Date.now() });
      } catch(e) {}
    }
    console.log(`✅ 演者トリガー [${cleanId}] のLINK反映ACKを送信しました`);
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

// 📶 左上Wi-Fiアイコンによるスプレッドシート（GAS）接続状態の隠しインジケーター
function updateWifiStatusIndicator(status) {
  const wrapper = document.getElementById('sb-wifi-wrapper');
  if (!wrapper) return;

  if (status === 'syncing') {
    const icon = wrapper.querySelector('.wifi-icon');
    if (icon) {
      icon.classList.remove('syncing');
      void icon.offsetWidth; // リフロー
      icon.classList.add('syncing');
    }
    return;
  }

  if (status === 'connected') {
    // 🟢 正常接続時：通常のWi-Fiアイコン（白色・クリア点灯）
    wrapper.innerHTML = `<i data-lucide="wifi" class="wifi-icon connected"></i>`;
  } else {
    // 🔴 未接続・通信エラー時：Wi-Fiマークに斜線（wifi-off）かつ灰色
    wrapper.innerHTML = `<i data-lucide="wifi-off" class="wifi-icon disconnected"></i>`;
  }

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function updateStaffSyncUI() {
  // 左上Wi-Fiアイコンの隠しステータスを即時連動
  if (window.CLOUD_SYNC_STATUS.connected) {
    updateWifiStatusIndicator('connected');
  } else {
    updateWifiStatusIndicator('disconnected');
  }

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
      if (el.classList && el.classList.contains('gsheet-grid-viewport')) return el;
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;
      const isScrollableY = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
      const isScrollableX = (overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth;
      if (isScrollableY || isScrollableX) return el;
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

    // スプレッドシート内は全方位スクロールを完全に許可
    if (scrollTarget.classList && scrollTarget.classList.contains('gsheet-grid-viewport')) {
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
      if (target.classList && target.classList.contains('gsheet-grid-viewport')) {
        return;
      }
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
  gameState.clockStartISO = localStorage.getItem('fake_clock_start_iso') || '2126-09-04T09:04:00';
  gameState.clockSetTime = parseInt(localStorage.getItem('fake_clock_set_time') || Date.now().toString());
  gameState.timerRunning = (localStorage.getItem('game_timer_running') === 'true');
  
  try {
    gameState.unlockedHints = JSON.parse(localStorage.getItem('unlocked_hints') || '[]');
  } catch (e) {
    gameState.unlockedHints = [];
  }

  // 📦 調査資料アイテムリスト復元
  try {
    gameState.collectedEvidence = JSON.parse(localStorage.getItem('collected_evidence') || '[]');
  } catch (e) {
    gameState.collectedEvidence = [];
  }

  // 📝 メモ帳タブ復元
  try {
    const savedTabs = JSON.parse(localStorage.getItem('game_memo_tabs_data') || 'null');
    if (savedTabs && Array.isArray(savedTabs) && savedTabs.length > 0) {
      gameState.memoTabs = savedTabs;
    } else {
      const oldMemo = localStorage.getItem('game_memo') || '';
      gameState.memoTabs = [{ title: "メモ 1", text: oldMemo, drawData: null }];
    }
  } catch (e) {
    gameState.memoTabs = [{ title: "メモ 1", text: "", drawData: null }];
  }

  try {
    gameState.addedFriends = JSON.parse(localStorage.getItem('added_friends') || '["jinnai", "fukasawa", "committee_group"]');
  } catch (e) {
    gameState.addedFriends = ["jinnai", "fukasawa", "committee_group"];
  }

  gameState.manabaUser = localStorage.getItem('manaba_user') || null;

  // 📊 カスタムスプレッドシート編集データの復元
  try {
    const customRows = JSON.parse(localStorage.getItem('game_custom_gsheet_rows') || 'null');
    if (customRows && window.GAME_DATABASE && window.GAME_DATABASE.hacking && window.GAME_DATABASE.hacking.spreadsheet) {
      window.GAME_DATABASE.hacking.spreadsheet.rows = customRows;
    }
  } catch (e) {}

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
  localStorage.setItem('collected_evidence', JSON.stringify(gameState.collectedEvidence || []));
  localStorage.setItem('game_memo_tabs_data', JSON.stringify(gameState.memoTabs || []));
  localStorage.setItem('added_friends', JSON.stringify(gameState.addedFriends));
  if (gameState.manabaUser) {
    localStorage.setItem('manaba_user', gameState.manabaUser);
  } else {
    localStorage.removeItem('manaba_user');
  }
}

// --- 運営画面など外部からの同期制御 ---
function handleStorageEvent(e) {
  if (e.key === 'game_loop_trigger' || e.key === 'game_loop') {
    // 周回変更
    const newLoop = parseInt(localStorage.getItem('game_loop') || e.newValue || '1', 10);
    if (!isNaN(newLoop) && gameState.loop !== newLoop) {
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
  } else if (e.key === 'latest_actor_command') {
    // 🎭 演者ツールからのコマンド（同一ブラウザのStorageイベント）
    try {
      const raw = e.newValue;
      if (raw) {
        const cmd = JSON.parse(raw);
        if (cmd && cmd.action === 'actor_message') {
          console.log('🎭 StorageEvent経由で演者コマンドを検出:', cmd);
          executeRemoteAdminCommand(cmd);
        }
      }
    } catch(err) { console.warn('actor storage event parse error:', err); }
  }
}

// --- 嘘の時計ロジック ---
function getFormattedFakeTime() {
  try {
    if (!gameState.timerRunning) {
      return '09:04';
    }
    const elapsed = Date.now() - (gameState.clockSetTime || Date.now());
    const startMs = Date.parse(gameState.clockStartISO || '2126-09-04T09:04:00');
    const fakeCurrent = new Date(startMs + elapsed);
    const hh = String(fakeCurrent.getHours()).padStart(2, '0');
    const mm = String(fakeCurrent.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch (e) {
    return '09:04';
  }
}

function startFakeClock() {
  let lastClockStr = "";
  let lastDateStr = "";

  function updateClock() {
    let clockStr = "09:04";
    let dateStr = "9月4日";
    let manabaDateStr = "2026-09-04 (Fri)";

    if (gameState.timerRunning) {
      const elapsed = Date.now() - (gameState.clockSetTime || Date.now());
      const startMs = Date.parse(gameState.clockStartISO || '2126-09-04T09:04:00');
      const fakeCurrent = new Date(startMs + elapsed);

      const hh = String(fakeCurrent.getHours()).padStart(2, '0');
      const mm = String(fakeCurrent.getMinutes()).padStart(2, '0');
      clockStr = `${hh}:${mm}`;

      const month = fakeCurrent.getMonth() + 1;
      const day = fakeCurrent.getDate();
      dateStr = `${month}月${day}日`;
      manabaDateStr = `2026-09-04 (${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][fakeCurrent.getDay()]})`;
    }

    if (clockStr !== lastClockStr) {
      lastClockStr = clockStr;
      const sbClock = document.getElementById('sb-clock');
      if (sbClock) sbClock.innerText = clockStr;
      const lockClock = document.getElementById('lock-clock');
      if (lockClock) lockClock.innerText = clockStr;
    }

    if (dateStr !== lastDateStr) {
      lastDateStr = dateStr;
      const lockDate = document.getElementById('lock-date');
      if (lockDate) lockDate.innerText = dateStr;
      
      const mDateEl = document.getElementById('manaba-header-date');
      if (mDateEl) {
        mDateEl.innerText = manabaDateStr;
      }
    }
  }

  // 起動時に最速で即時09:04を描画
  updateClock();
  setInterval(updateClock, 1000);
}

// --- 🔋 実機バッテリー連動ロジック (Battery Status API) ---
function initBatterySync() {
  function updateBatteryUI(level, charging) {
    const pct = Math.round(level * 100);
    const textEl = document.getElementById('sb-battery-text');
    const levelEl = document.getElementById('sb-battery-level');
    const iconEl = document.getElementById('sb-battery-icon');

    if (textEl) {
      textEl.innerText = `${pct}%`;
    }
    if (levelEl) {
      levelEl.style.width = `${Math.max(8, pct)}%`;
      if (pct <= 20) {
        levelEl.style.background = '#ef4444'; // 赤色（低残量）
      } else if (charging) {
        levelEl.style.background = '#10b981'; // 緑色（充電中）
      } else {
        levelEl.style.background = '#1e293b'; // 通常
      }
    }
  }

  if (navigator.getBattery) {
    navigator.getBattery().then(battery => {
      updateBatteryUI(battery.level, battery.charging);

      battery.addEventListener('levelchange', () => {
        updateBatteryUI(battery.level, battery.charging);
      });
      battery.addEventListener('chargingchange', () => {
        updateBatteryUI(battery.level, battery.charging);
      });
    }).catch(err => {
      console.warn("Battery API available but error:", err);
      updateBatteryUI(0.92, false);
    });
  } else {
    // iOS Safari等でBattery API非対応の場合の自然なフォールバック
    updateBatteryUI(0.88, false);
  }
}

// 🔄 周回切り替え時にLINKアプリのチャットデータ・友達リスト・未読状態をその周回の初期データへ復元する
function resetLinkAppForLoop() {
  if (window.INITIAL_GAME_DATABASE && window.INITIAL_GAME_DATABASE.linkApp) {
    // INITIAL_GAME_DATABASEから完全クローンして上書き復元（前の周回のメッセージを完全クリア）
    window.GAME_DATABASE.linkApp = JSON.parse(JSON.stringify(window.INITIAL_GAME_DATABASE.linkApp));
    try {
      localStorage.setItem('game_db_cache', JSON.stringify(window.GAME_DATABASE));
    } catch(e) {}
  }

  // 以前の周回で受信した動的ロック画面通知もクリア
  gameState.dynamicLockNotifications = [];

  // 未読バッジの初期化（3周目は0件、1・2周目は初期1件）
  const badge = document.getElementById('dock-link-badge');
  if (badge) {
    if (gameState.loop === 3) {
      badge.style.display = 'none';
      badge.innerText = '0';
    } else {
      badge.style.display = 'flex';
      badge.innerText = '1';
    }
  }

  // 友達リスト＆チャット画面の再描画
  renderLinkChatList();

  // もしLINKアプリが開いていたら、現在アクティブなトークルーム（または全体連絡）を再描画
  if (gameState.activeApp === 'link') {
    const activeContactId = gameState.activeContactId || 'committee_group';
    openLinkChat(activeContactId);
  }
}

// ==========================================================================
// 🔄 ループ（周回）移行時：メタアプリ以外の全アプリ状態を初期状態へ完全復元
// （※調査手帳・メタアプリのunlockedHintsのみループを超えて保持し続けます）
// ==========================================================================
function resetAllAppsForNewLoop() {
  // 1. 各アプリの内部ステートを初期化
  resetLinkAppForLoop();
  resetManabaForLoop();
  resetSafariForLoop();
  resetPhoneForLoop();
  resetMailForLoop();
  resetPhotoForLoop();

  // 2. 開いている全ウィンドウを閉じ、ホーム画面状態に戻す
  closeAllWindowsSilent();
  gameState.activeApp = null;
}

// --- 周回（ループ）の強制切り替え演出（ホーム画面初期化 ＆ ロック画面 ＆ 09:04静止待機を完全徹底） ---
function triggerLoopTransition(nextLoop) {
  const targetLoop = parseInt(nextLoop || 1, 10);
  if (isNaN(targetLoop)) return;

  // 効果音
  playSystemSound("beep");

  // 1. 開いている全アプリウィンドウを確実に非表示にし、背景を「ホーム画面」に完全初期化
  closeAllWindowsSilent();
  gameState.activeApp = null;

  // 2. メタアプリ以外の全アプリ（manaba, Safari, 電話, メール, LINK等）を完全初期化
  resetAllAppsForNewLoop();

  // 3. 状態更新
  gameState.loop = targetLoop;
  saveStateToStorage();
  localStorage.setItem('game_loop', String(targetLoop));

  // 4. 時刻を 09:04（9月4日）に完全固定・静止待機に設定（ロック解除されるまでタイマー停止・静止）
  const loopClockISO = "2126-09-04T09:04:00";
  gameState.timerRunning = false;
  gameState.clockStartISO = loopClockISO;
  gameState.clockSetTime = Date.now();
  localStorage.setItem('game_timer_running', 'false');
  localStorage.setItem('fake_clock_start_iso', loopClockISO);
  localStorage.setItem('fake_clock_set_time', String(Date.now()));

  // 5. 時計表示（ロック画面 ＆ ステータスバー）を即座に「09:04」「9月4日」に強制描画
  const statusTime = document.getElementById('status-time');
  if (statusTime) statusTime.innerText = "09:04";
  const lockClock = document.getElementById('lock-clock');
  if (lockClock) lockClock.innerText = "09:04";
  const lockDate = document.getElementById('lock-date');
  if (lockDate) lockDate.innerText = "9月4日";

  // 6. 前面にロック画面を全画面表示
  showLockScreen();

  // 7. 演者ツール（actor.html）へ周回移行を即時通知
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const bc = new BroadcastChannel('escape_game_channel');
      bc.postMessage({ type: 'loop_change', payload: { loop: targetLoop } });
    } catch(e) {}
  }

  // 8. コンテンツUI更新（ニュース・マスタデータの周回別表示切り替え）
  updateAppUI();

  logWriteToGAS("LOOP_TRANSITION", `端末が強制的に周回 ${targetLoop} へ移行しました（ホーム初期化・ロック画面・09:04静止待機）。`);
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

  // メタアプリ：観測＆調査資料の更新
  renderMetaObservation(metaObservationCurrentFolder);
  renderMetaEvidence();

  // メールリスト更新
  renderMailList();
}

// ロック画面用 デフォルト日常通知定義（データ未取得時の完全保護）
const DEFAULT_LOCK_NOTIFICATIONS = {
  1: [
    { id: "ln1", app: "LINK", icon: "message-circle", title: "深澤 文哉", body: "大ホールの施錠連絡忘れてただろ。ちゃんと施錠してから部屋出てくれよな。", time: "只今", targetApp: "link", contactId: "fukasawa" },
    { id: "ln2", app: "メール", icon: "mail", title: "学友会執行委員会 事務局", body: "【重要】本日の研修会および施設利用について", time: "10分前", targetApp: "mail", mailId: "m1" },
    { id: "ln3", app: "カレンダー", icon: "calendar", title: "予定のリマインダー", body: "10:00 執行部引き継ぎ定例会議（研修室2）", time: "30分前", targetApp: "manaba" }
  ],
  2: [
    { id: "ln1", app: "LINK", icon: "message-circle", title: "陣内 樹", body: "パソコン研修室1に忘れたかも…パスワードはJNNITMNRね！", time: "只今", targetApp: "link", contactId: "jinnai" },
    { id: "ln2", app: "メール", icon: "mail", title: "学友会執行委員会 事務局", body: "【重要】時間軸再同期に伴う注意喚起", time: "5分前", targetApp: "mail", mailId: "m1" },
    { id: "ln3", app: "LINK", icon: "message-circle", title: "深澤 文哉", body: "怪しいURL見つけたからLINKで送るね！", time: "1分前", targetApp: "link", contactId: "fukasawa" }
  ],
  3: [
    { id: "ln1", app: "LINK", icon: "message-circle", title: "犬飼 玲（U.Z.W.）", body: "鵜沢向希様。あなたの持つスマートフォンは重大な機密です。回収に応じなさい。", time: "只今", targetApp: "link", contactId: "inukai" },
    { id: "ln2", app: "システム警報", icon: "alert-triangle", title: "U.Z.W. セキュリティ統括部", body: "学内ネットワークへの外部ハッキング攻撃を検知。警戒レベル引き上げ。", time: "3分前", targetApp: "browser", pageId: "campus_hack_alert" }
  ]
};

// --- アプリ種別に応じた通知アプリアイコンHTML生成 ---
function getNotificationAppIconHtml(appName, iconName) {
  if (appName === 'LINK' || iconName === 'message-circle' || iconName === 'message-square' || iconName === 'LINK.png' || iconName === 'LINK') {
    return `<div class="notif-app-icon link-icon" style="overflow:hidden; border-radius:6px; display:flex; align-items:center; justify-content:center; background:#fff;"><img src="./LINK.png?v=2.48.0" style="width:100%; height:100%; object-fit:cover;" alt="LINK"></div>`;
  } else if (appName === 'メール' || iconName === 'mail') {
    return `<div class="notif-app-icon mail-icon"><img src="./mail.png" style="width:100%; height:100%; object-fit:cover;" alt="メール"></div>`;
  } else if (appName === 'カレンダー' || iconName === 'calendar') {
    return `<div class="notif-app-icon calendar-icon"><i data-lucide="calendar"></i></div>`;
  } else {
    return `<div class="notif-app-icon system-icon"><i data-lucide="${iconName || 'bell'}"></i></div>`;
  }
}

// --- ロック画面の通知レンダリング（通知センター非表示化） ---
function renderLockNotifications() {
  const container = document.getElementById('lock-notif-list') || document.getElementById('lock-notifications-list');
  if (container) {
    container.innerHTML = "";
  }
}

// ロック画面通知タップ時のシームレスアクセス処理（タップで即座にアプリを開く）
function handleLockNotificationClick(n) {
  unlockScreen();
  setTimeout(() => {
    if (n.targetApp === 'link' || n.app === 'LINK') {
      openApp('link-app');
      const contact = n.contactId || 'committee_group';
      setTimeout(() => {
        openLinkChat(contact);
      }, 120);
    } else if (n.targetApp === 'mail' || n.app === 'メール') {
      openApp('mail-app');
      if (n.mailId) {
        setTimeout(() => {
          openMailDetail(n.mailId);
        }, 120);
      }
    } else if (n.targetApp === 'browser' || n.app === 'ブラウザ') {
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
// --- iPadOS風 オリジナル通知システム ---
let currentPushAction = null;
let pushBannerTimer = null;

function showPushNotification(app, title, body, icon = "bell", onClick = null) {
  const banner = document.getElementById('push-notification-banner');
  if (!banner) return;

  const appEl = document.getElementById('push-notif-app');
  if (appEl) appEl.innerText = app || "通知";
  const titleEl = document.getElementById('push-notif-title');
  if (titleEl) titleEl.innerText = title || "";

  // 📝 本文の長文トリミング（2行で見やすくなるよう最大65文字に制限）
  let cleanBody = (body || "").trim();
  if (cleanBody.length > 65) {
    cleanBody = cleanBody.slice(0, 65) + "…";
  }
  const descEl = document.getElementById('push-notif-desc');
  if (descEl) descEl.innerText = cleanBody;
  
  const iconWrap = document.getElementById('push-notif-icon-wrap');
  if (iconWrap) {
    if (app === 'LINK' || icon === 'message-circle' || icon === 'message-square' || icon === 'LINK.png' || icon === 'LINK') {
      iconWrap.innerHTML = '<img src="./LINK.png?v=2.48.0" id="push-notif-icon" class="push-notif-img" alt="LINK">';
      iconWrap.style.background = '#ffffff';
    } else if (app === 'メール' || icon === 'mail') {
      iconWrap.innerHTML = '<img src="./mail.png" id="push-notif-icon" class="push-notif-img" alt="メール">';
      iconWrap.style.background = '#ffffff';
    } else {
      iconWrap.innerHTML = `<i data-lucide="${icon}" id="push-notif-icon" style="width:20px; height:20px; color:#fff;"></i>`;
      iconWrap.style.background = 'var(--system-blue)';
      if (typeof lucide !== 'undefined') {
        lucide.createIcons({ roots: [iconWrap] });
      }
    }
  }

  // デフォルトタップアクション（LINK通知なら自動でLINKアプリを開く）
  if (onClick) {
    currentPushAction = onClick;
  } else if (app === 'LINK') {
    currentPushAction = () => {
      openApp('link-app');
      openLinkChat('committee_group');
    };
  } else {
    currentPushAction = null;
  }

  banner.classList.add('show');
  playSystemSound("notif");

  if (pushBannerTimer) clearTimeout(pushBannerTimer);
  pushBannerTimer = setTimeout(() => {
    banner.classList.remove('show');
  }, 4500);
}

function handleBannerClick() {
  const banner = document.getElementById('push-notification-banner');
  if (banner) banner.classList.remove('show');
  if (pushBannerTimer) clearTimeout(pushBannerTimer);

  const action = currentPushAction;
  currentPushAction = null;

  // ⚡ UIスレッドのブロック・フリーズを防止するため、バナーが引っ込むアニメーションと非同期で実行
  if (action) {
    setTimeout(() => {
      try {
        action();
      } catch (err) {
        console.warn('通知タップアクション実行エラー:', err);
      }
    }, 40);
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

// --- ロック画面表示（カバーシート呼び出し：その下はホーム画面に戻す） ---
function showLockScreen() {
  const lockScreen = document.getElementById('lock-screen');
  if (lockScreen) {
    // 🏠 ロック画面の背面にあるアプリ・ウィンドウ・モーダルをすべて閉じ、ホーム画面状態に戻す
    closeAllWindowsSilent();
    gameState.activeApp = null;

    lockScreen.classList.remove('hidden');
    renderLockNotifications();
    playSystemSound("touch");
    logWriteToGAS("LOCK_TRIGGERED", "ロック画面が表示されました（背景をホーム画面に初期化）");
  }
}

// --- 画面上端からの下スワイプでロック画面を呼び出し（iPadOSカバーシートジェスチャー：誤爆防止厳格化） ---
function initTopSwipeForLockScreen() {
  let touchStartY = 0;
  let touchStartX = 0;
  let isTrackingTopSwipe = false;

  document.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 1) {
      const touch = e.touches[0];
      // 画面最上部（ステータスバー付近: 28px以内）でタッチ開始された場合のみ追跡
      if (touch.clientY <= 28) {
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

    // 下方向に80px以上しっかりスワイプかつ横ブレが少ない場合のみロック画面呼び出し
    if (deltaY >= 80 && deltaY > deltaX * 1.5) {
      isTrackingTopSwipe = false;
      showLockScreen();
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    isTrackingTopSwipe = false;
  }, { passive: true });

  // ステータスバー（PC用：明確に80px以上下ドラッグした場合のみ）
  const statusBar = document.getElementById('status-bar') || document.querySelector('.status-bar');
  if (statusBar) {
    let mouseStartY = 0;
    statusBar.addEventListener('mousedown', (e) => {
      mouseStartY = e.clientY;
    });
    document.addEventListener('mouseup', (e) => {
      if (mouseStartY > 0 && (e.clientY - mouseStartY) >= 80) {
        showLockScreen();
      }
      mouseStartY = 0;
    });
  }
}

// --- ロック画面操作 ＆ 解除ジェスチャー（純粋な上スワイプ操作のみ） ---
function initLockScreenGestures() {
  const lockScreen = document.getElementById('lock-screen');
  if (!lockScreen) return;

  let touchStartY = 0;
  let touchStartX = 0;
  let isDraggingLock = false;

  // 1. タッチスワイプ（iPad / スマホ実機：上方向にフリック/スワイプした時のみ解除）
  lockScreen.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
      isDraggingLock = true;
    }
  }, { passive: true });

  lockScreen.addEventListener('touchend', (e) => {
    if (isDraggingLock && e.changedTouches && e.changedTouches.length === 1) {
      const deltaY = touchStartY - e.changedTouches[0].clientY;
      const deltaX = Math.abs(touchStartX - e.changedTouches[0].clientX);
      // 上方向に35px以上しっかりスワイプ（フリック）した場合のみロック解除
      if (deltaY >= 35 && deltaY > deltaX) {
        unlockScreen();
      }
    }
    isDraggingLock = false;
  }, { passive: true });

  // 2. マウスドラッグ（PCブラウザ：マウスで上方向に35px以上ドラッグした時のみ解除）
  let mouseStartY = 0;
  lockScreen.addEventListener('mousedown', (e) => {
    mouseStartY = e.clientY;
  });

  lockScreen.addEventListener('mouseup', (e) => {
    if (mouseStartY > 0) {
      const deltaY = mouseStartY - e.clientY;
      if (deltaY >= 35) {
        unlockScreen();
      }
    }
    mouseStartY = 0;
  });

  // 3. キーボード操作（Space, Enter, ArrowUp）
  window.addEventListener('keydown', (e) => {
    const ls = document.getElementById('lock-screen');
    if (ls && !ls.classList.contains('hidden')) {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') {
        e.preventDefault();
        unlockScreen();
      }
    }
  });
}

// --- ロック画面解除 ---
function unlockScreen() {
  const lockScreen = document.getElementById('lock-screen');
  if (lockScreen) {
    lockScreen.classList.add('hidden');
    playSystemSound("notif");
    logWriteToGAS("LOCK_DISMISS", "ロック解除されました。");

    // 🚀 ロック解除でゲーム開始（時間が進み始める）
    if (!gameState.timerRunning) {
      gameState.timerRunning = true;
      gameState.clockSetTime = Date.now();
      localStorage.setItem('game_timer_running', 'true');
      localStorage.setItem('fake_clock_set_time', gameState.clockSetTime.toString());
    }
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
    
    if (appId === 'meta-app') {
      metaObservationCurrentFolder = 'root';
      switchMetaTab(gameState.activeMetaTab || 'observation');
    } else if (appId === 'browser-app') {
      goBrowserHome();
    } else if (appId === 'link-app') {
      renderLinkChatList();
      openLinkChat('committee_group');
    } else if (appId === 'manaba-app') {
      initManabaApp();
    } else if (appId === 'mail-app') {
      renderMailList();
    }
    
    logWriteToGAS("APP_OPEN", `アプリを開きました: ${appId}`);
  }
}

function closeApp(appId) {
  goHome();
}
window.closeApp = closeApp;

// 🏠 ホームバー操作（0ms即時反応 ＆ 最下部上フリックジェスチャー）
function initHomeBarEvents() {
  const homeBar = document.getElementById('home-bar');
  if (homeBar) {
    // タッチ開始で即時判定（300ms遅延ゼロ化）
    homeBar.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      goHome();
    }, { passive: true });
  }

  // 画面最下部エリア（下端50px）からの上フリックジェスチャーでホームに戻る
  let bottomTouchStartY = 0;
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const touchY = e.touches[0].clientY;
      const screenH = window.innerHeight;
      if (touchY > screenH - 55) {
        bottomTouchStartY = touchY;
      } else {
        bottomTouchStartY = 0;
      }
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (bottomTouchStartY > 0 && e.changedTouches.length === 1) {
      const deltaY = bottomTouchStartY - e.changedTouches[0].clientY;
      if (deltaY > 25) {
        goHome();
      }
    }
    bottomTouchStartY = 0;
  }, { passive: true });
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
  
  // すべてのモーダル・スキャナー・オーバーレイを確実に非表示化
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.style.display = 'none';
  });
  const inappForm = document.getElementById('link-inapp-form-overlay');
  if (inappForm) inappForm.style.display = 'none';
  const toast = document.getElementById('meta-evidence-toast');
  if (toast) toast.style.display = 'none';

  closeHacking();
  endPhoneCall(true);
  stopAllCameraStreams();
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
  }
  closeStaffModal();
  updateAppUI();
}

function performMasterReset() {
  if (confirm("⚠️ 【確認】このiPadの全データを消去し、1周目の初期状態（ロック画面）に戻しますか？")) {
    const currentTeam = gameState.teamId || 'iPad-01';
    const gasUrl = localStorage.getItem('gas_url');
    localStorage.clear();
    localStorage.setItem('team_id', currentTeam);
    localStorage.setItem('game_loop', '1');
    localStorage.setItem('game_timer_running', 'false');
    localStorage.setItem('fake_clock_start_iso', '2126-09-04T09:04:00');
    localStorage.setItem('fake_clock_set_time', String(Date.now()));
    if (gasUrl) localStorage.setItem('gas_url', gasUrl);
    setTimeout(() => {
      location.reload();
    }, 400);
  }
}

// ==========================================================================
// ① メタアプリ「26__0094」ロジック
// ==========================================================================
let metaObservationCurrentFolder = 'root';

function switchMetaTab(tabId) {
  if (tabId === 'overview') tabId = 'observation';
  gameState.activeMetaTab = tabId;

  document.querySelectorAll('.meta-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.meta-panel').forEach(panel => panel.classList.remove('active'));

  const btnId = `meta-tab-${tabId}-btn`;
  const activeBtn = document.getElementById(btnId) || Array.from(document.querySelectorAll('.meta-tab-btn')).find(btn => {
    const oc = btn.getAttribute('onclick');
    return oc && oc.includes(tabId);
  });
  if (activeBtn) activeBtn.classList.add('active');
  
  const panel = document.getElementById(`meta-panel-${tabId}`);
  if (panel) panel.classList.add('active');

  stopAllCameraStreams();
  const inlineScanner = document.getElementById('meta-qr-inline-scanner');
  if (inlineScanner) inlineScanner.style.display = 'none';

  if (tabId === 'observation') {
    renderMetaObservation(metaObservationCurrentFolder);
  } else if (tabId === 'evidence') {
    renderMetaEvidence();
  } else if (tabId === 'memo') {
    initMetaMemo();
  }
}

// 📁 Apple純正 iPadOS「ファイル」アプリ風 中身が入ったリアルなフォルダSVGジェネレーター
function generateIpadosFolderSvg() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 85" class="ipados-folder-svg" width="86" height="72" style="display:block; margin:0 auto; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.12));">
      <defs>
        <!-- 背面グラデーション -->
        <linearGradient id="folderBackGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#0284c7"/>
          <stop offset="100%" stop-color="#0369a1"/>
        </linearGradient>
        <!-- 前面フラップグラデーション -->
        <linearGradient id="folderFrontGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#38bdf8"/>
          <stop offset="60%" stop-color="#0ea5e9"/>
          <stop offset="100%" stop-color="#0284c7"/>
        </linearGradient>
        <!-- 書類1（奥側の書類） -->
        <linearGradient id="paperGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#f8fafc"/>
        </linearGradient>
        <!-- 書類2（手前側の写真・データ書類） -->
        <linearGradient id="paperGrad2" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#f1f5f9"/>
        </linearGradient>
      </defs>

      <!-- 1. 背面タブ付きフォルダベース -->
      <path d="M 10 18 C 10 12 15 12 19 12 L 36 12 C 41 12 45 18 49 18 L 81 18 C 86 18 90 22 90 27 L 90 70 C 90 76 86 78 80 78 L 20 78 C 14 78 10 76 10 70 Z" fill="url(#folderBackGrad)" />

      <!-- 2. 中身の書類1（奥側の書類・少し傾いた紙） -->
      <g transform="rotate(-6 35 30)">
        <rect x="20" y="8" width="34" height="42" rx="3" fill="url(#paperGrad1)" stroke="#cbd5e1" stroke-width="0.8" />
        <!-- 書類の罫線 -->
        <line x1="25" y1="14" x2="46" y2="14" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" />
        <line x1="25" y1="19" x2="42" y2="19" stroke="#cbd5e1" stroke-width="1.2" stroke-linecap="round" />
        <line x1="25" y1="23" x2="48" y2="23" stroke="#cbd5e1" stroke-width="1.2" stroke-linecap="round" />
      </g>

      <!-- 3. 中身の書類2（手前側の画像・写真付き書類） -->
      <g transform="rotate(4 60 32)">
        <rect x="42" y="6" width="36" height="44" rx="3" fill="url(#paperGrad2)" stroke="#cbd5e1" stroke-width="0.8" />
        <!-- 写真・グラフのサムネイル風エリア -->
        <rect x="46" y="11" width="28" height="17" rx="2" fill="#38bdf8" opacity="0.35" />
        <circle cx="52" cy="16" r="2.2" fill="#0284c7" />
        <path d="M 48 25 L 55 19 L 62 24 L 70 18 L 70 26 L 48 26 Z" fill="#0284c7" opacity="0.8" />
        <!-- 罫線 -->
        <line x1="46" y1="33" x2="72" y2="33" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" />
        <line x1="46" y1="38" x2="64" y2="38" stroke="#cbd5e1" stroke-width="1.2" stroke-linecap="round" />
      </g>

      <!-- 4. 前面フラップ（手前に開いて中身をしっかり抱えているフォルダポケット） -->
      <path d="M 8 30 C 8 25 13 25 18 25 L 82 25 C 87 25 92 27 92 32 L 92 70 C 92 76 87 78 81 78 L 19 78 C 13 78 8 76 8 70 Z" fill="url(#folderFrontGrad)" />
      
      <!-- 前面フラップの上端ハイライト光沢 -->
      <path d="M 12 26 L 88 26" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-linecap="round" />
    </svg>
  `;
}

// 観測タブ用デフォルトフォルダ定義（データ未取得時の完全保護）
const DEFAULT_OBSERVATION_FOLDERS = [
  {
    id: "obs_folder_root",
    folderName: "観測",
    unlockLoop: 1,
    files: [
      { id: "f_story_1", fileName: "あらすじ.png", title: "あらすじ", image: "./あらすじ.png", desc: "2126年 タイムリープ事件概要" },
      { id: "f_relation_1", fileName: "相関図.png", title: "相関図", image: "./相関図.png", desc: "関係者・学友会相関図" },
      { id: "f_route_a", fileName: "順路A.png", title: "順路A", image: "./順路A.png", desc: "大ホール・PCルーム 探索ルート" },
      { id: "f_route_b", fileName: "順路B.png", title: "順路B", image: "./順路B.png", desc: "研修室1〜3 探索ルート" },
      { id: "f_route_c", fileName: "順路C.png", title: "順路C", image: "./順路C.png", desc: "未来資料保管庫 探索ルート" },
      { id: "f_route_d", fileName: "順路D.png", title: "順路D", image: "./順路D.png", desc: "役員室・セキュリティエリア 探索ルート" },
      { id: "f_route_f", fileName: "順路F.png", title: "順路F", image: "./順路F.png", desc: "最上階タイムマシン到達ルート" }
    ]
  },
  {
    id: "obs_folder_1",
    folderName: "観測(1)",
    unlockLoop: 2,
    files: [
      { id: "f_story_2", fileName: "あらすじ(1).png", title: "あらすじ(1)", image: "./あらすじ(1).png", desc: "第2周回 世界線分岐あらすじ" },
      { id: "f_relation_2", fileName: "相関図(1).png", title: "相関図(1)", image: "./相関図(1).png", desc: "第2周回 改変後相関図" },
      { id: "f_route_1", fileName: "順路(1).png", title: "順路(1)", image: "./順路(1).png", desc: "第2周回 調査順路マップ" }
    ]
  },
  {
    id: "obs_folder_2",
    folderName: "観測(2)",
    unlockLoop: 3,
    files: [
      { id: "f_story_3", fileName: "あらすじ(2).png", title: "あらすじ(2)", image: "./あらすじ(2).png", desc: "第3周回 最終決戦あらすじ" },
      { id: "f_relation_3", fileName: "相関図(2).png", title: "相関図(2)", image: "./相関図(2).png", desc: "第3周回 完全真相相関図" },
      { id: "f_route_2", fileName: "順路(2).png", title: "順路(2)", image: "./順路(2).png", desc: "第3周回 最終脱出順路マップ" }
    ]
  }
];

// 📁 【観測】タブ描画: エクスプローラー風フォルダ・ファイル階層ビュー（周回解放対応）
function renderMetaObservation(folderId = 'root') {
  metaObservationCurrentFolder = folderId;
  const container = document.getElementById('meta-observation-grid') || document.getElementById('meta-overview-grid');
  const countEl = document.getElementById('observation-file-count') || document.getElementById('overview-file-count');
  const pathEl = document.getElementById('meta-observation-path');
  if (!container) return;

  const currentLoop = Number(gameState.loop) || 1;
  const dbFolders = (window.GAME_DATABASE && window.GAME_DATABASE.metaApp && window.GAME_DATABASE.metaApp.observationFolders);
  const allFolders = (dbFolders && dbFolders.length > 0) ? dbFolders : DEFAULT_OBSERVATION_FOLDERS;
  
  // 現在の周回以下で解放されているフォルダのみ取得（最低限第1周回フォルダは必ず含む）
  let visibleFolders = allFolders.filter(f => (f.unlockLoop || 1) <= currentLoop);
  if (visibleFolders.length === 0) {
    visibleFolders = [allFolders[0]];
  }

  if (folderId === 'root') {
    // 最上位階層: 周回に応じたフォルダ一覧を表示
    if (pathEl) {
      pathEl.innerHTML = `<i data-lucide="hard-drive" style="width:14px; height:14px; vertical-align:middle;"></i> PC &gt; 内部ストレージ`;
    }
    if (countEl) {
      countEl.innerText = `${visibleFolders.length} フォルダ`;
    }

    container.innerHTML = visibleFolders.map(folder => `
      <div class="finder-item folder-type" onclick="renderMetaObservation('${folder.id}')" title="タップして「${folder.folderName}」を開く">
        <div class="finder-thumb-wrapper">
          <div class="finder-folder-icon">
            ${generateIpadosFolderSvg()}
          </div>
        </div>
        <div class="finder-file-name">${folder.folderName}</div>
        <div class="finder-file-desc">${folder.files ? folder.files.length : 0} 項目</div>
      </div>
    `).join('');
  } else {
    // フォルダ内表示: 選択されたフォルダ内のファイル一覧（上へ戻るボタンは排除しパンくずでナビゲート）
    const targetFolder = allFolders.find(f => f.id === folderId) || visibleFolders.find(f => f.id === folderId) || visibleFolders[0];
    if (!targetFolder) {
      renderMetaObservation('root');
      return;
    }
    const files = targetFolder.files || [];

    if (pathEl) {
      pathEl.innerHTML = `<a href="javascript:void(0)" onclick="renderMetaObservation('root')" style="color:inherit; text-decoration:underline;"><i data-lucide="hard-drive" style="width:14px; height:14px; vertical-align:middle;"></i> PC &gt; 内部ストレージ</a> &gt; <strong>${targetFolder.folderName}</strong>`;
    }
    if (countEl) {
      countEl.innerText = `${files.length} 項目`;
    }

    if (files.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #94a3b8;">
          このフォルダにはファイルがありません。
        </div>
      `;
    } else {
      container.innerHTML = files.map(file => `
        <div class="finder-item" onclick="openMetaLightbox('${file.image}', '${file.fileName}')" title="ダブルクリック/タップでプレビュー">
          <div class="finder-thumb-wrapper">
            <img src="${file.image}" class="finder-thumb-img" alt="${file.fileName}" loading="lazy" decoding="async">
          </div>
          <div class="finder-file-name">${file.fileName}</div>
          <div class="finder-file-desc">${file.desc || '画像ファイル'}</div>
        </div>
      `).join('');
    }
  }

  safeCreateIcons(container);
}

// 🔍 フルスクリーン拡大プレビューモーダル（ギャラリーカルーセル・スワイプ・矢印送り対応）
let currentLightboxGallery = [];
let currentLightboxIndex = 0;
let lightboxSwipeInitialized = false;

function openMetaLightbox(imgUrl, title, galleryList = null) {
  const modal = document.getElementById('meta-lightbox-modal');
  const img = document.getElementById('lightbox-img');
  if (!modal || !img) return;

  // ギャラリーリストの特定（現在開いているフォルダの全ファイル）
  if (galleryList && galleryList.length > 0) {
    currentLightboxGallery = galleryList;
  } else {
    const currentLoop = Number(gameState.loop) || 1;
    const dbFolders = (window.GAME_DATABASE && window.GAME_DATABASE.metaApp && window.GAME_DATABASE.metaApp.observationFolders);
    const allFolders = (dbFolders && dbFolders.length > 0) ? dbFolders : DEFAULT_OBSERVATION_FOLDERS;
    const visibleFolders = allFolders.filter(f => (f.unlockLoop || 1) <= currentLoop);
    const targetFolder = allFolders.find(f => f.id === metaObservationCurrentFolder) || visibleFolders[0];
    currentLightboxGallery = (targetFolder && targetFolder.files && targetFolder.files.length > 0) ? targetFolder.files : [{ fileName: title || 'プレビュー', image: imgUrl }];
  }

  // 現在の画像のインデックスを特定
  const foundIdx = currentLightboxGallery.findIndex(item => item.image === imgUrl || item.fileName === title);
  currentLightboxIndex = foundIdx !== -1 ? foundIdx : 0;

  updateLightboxView();
  modal.style.display = 'flex';
  safeCreateIcons(modal);

  // スワイプ＆キーボードイベントの登録
  initLightboxSwipe();

  logWriteToGAS("META_LIGHTBOX_OPEN", `プレビュー拡大: ${title || imgUrl}`);
}

function updateLightboxView() {
  const img = document.getElementById('lightbox-img');
  const titleEl = document.getElementById('lightbox-title');
  const counterEl = document.getElementById('lightbox-counter');
  const prevBtn = document.getElementById('lightbox-prev-btn');
  const nextBtn = document.getElementById('lightbox-next-btn');
  if (!img || currentLightboxGallery.length === 0) return;

  const currentItem = currentLightboxGallery[currentLightboxIndex];
  if (!currentItem) return;

  img.style.opacity = '0.5';
  img.src = currentItem.image;
  img.onload = () => {
    img.style.opacity = '1';
  };

  if (titleEl) titleEl.innerText = currentItem.fileName || currentItem.title || "プレビュー";
  if (counterEl) {
    if (currentLightboxGallery.length > 1) {
      counterEl.style.display = 'inline-block';
      counterEl.innerText = `${currentLightboxIndex + 1} / ${currentLightboxGallery.length}`;
    } else {
      counterEl.style.display = 'none';
    }
  }

  if (prevBtn && nextBtn) {
    if (currentLightboxGallery.length <= 1) {
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'none';
    } else {
      prevBtn.style.display = 'flex';
      nextBtn.style.display = 'flex';
    }
  }
}

function navigateMetaLightbox(direction) {
  if (currentLightboxGallery.length <= 1) return;
  currentLightboxIndex = (currentLightboxIndex + direction + currentLightboxGallery.length) % currentLightboxGallery.length;
  updateLightboxView();
}

function initLightboxSwipe() {
  if (lightboxSwipeInitialized) return;
  lightboxSwipeInitialized = true;

  const swipeArea = document.getElementById('lightbox-body-swipe-area') || document.getElementById('meta-lightbox-modal');
  if (!swipeArea) return;

  let touchStartX = 0;
  let touchStartY = 0;

  swipeArea.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  swipeArea.addEventListener('touchend', (e) => {
    if (e.changedTouches.length === 1) {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;

      // 横スワイプ判定（40px以上の移動かつ縦より横の移動が大きい場合）
      if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX < 0) {
          // 左スワイプ -> 次の画像へ
          navigateMetaLightbox(1);
        } else {
          // 右スワイプ -> 前の画像へ
          navigateMetaLightbox(-1);
        }
      }
    }
  }, { passive: true });

  // キーボード左右矢印キー対応
  window.addEventListener('keydown', (e) => {
    const modal = document.getElementById('meta-lightbox-modal');
    if (modal && modal.style.display !== 'none') {
      if (e.key === 'ArrowRight') {
        navigateMetaLightbox(1);
      } else if (e.key === 'ArrowLeft') {
        navigateMetaLightbox(-1);
      } else if (e.key === 'Escape') {
        closeMetaLightbox();
      }
    }
  });
}

function closeMetaLightbox() {
  const modal = document.getElementById('meta-lightbox-modal');
  if (modal) modal.style.display = 'none';
}

// 📦 【調査資料】タブ描画: 2列カードグリッド & 周回別テキスト動的解決 & 保持
function renderMetaEvidence() {
  const container = document.getElementById('meta-evidence-grid');
  const badge = document.getElementById('evidence-count-badge');
  if (!container) return;

  const currentLoop = Number(gameState.loop) || 1;
  const collected = gameState.collectedEvidence || [];

  if (badge) {
    badge.innerText = `${collected.length}件 記録済み`;
  }

  if (collected.length === 0) {
    container.innerHTML = `
      <div class="evidence-empty-state">
        <i data-lucide="archive" class="empty-icon"></i>
        <p>記録された調査資料はありません。<br>右下の「＋」ボタンからQRコードを読み取ってください。</p>
      </div>
    `;
    safeCreateIcons(container);
    return;
  }

  const allItems = window.GAME_DATABASE.metaApp.evidenceItems || [];
  
  container.innerHTML = collected.map(entry => {
    const item = allItems.find(it => it.id === entry.id || it.qrKey === entry.id);
    if (!item) return '';

    // 周回に応じた名称・説明文の解決
    const itemName = (item.names && item.names[currentLoop]) || (item.names && item.names[1]) || item.id;
    const itemDesc = (item.shortDescs && item.shortDescs[currentLoop]) || (item.shortDescs && item.shortDescs[1]) || '';
    const timeStr = entry.collectedTime || "記録済み";

    return `
      <div class="evidence-card" onclick="openMetaEvidenceDetail('${item.id}', '${entry.collectedTime || ''}', ${entry.collectedLoop || currentLoop})">
        <img src="${item.image}" class="evidence-card-thumb" alt="${itemName}" loading="lazy">
        <div class="evidence-card-body">
          <div class="evidence-card-title">${itemName}</div>
          <div class="evidence-card-desc">${itemDesc}</div>
          <div class="evidence-card-time"><i data-lucide="clock" style="width:12px; height:12px;"></i> ${timeStr} 取得</div>
        </div>
      </div>
    `;
  }).join('');

  safeCreateIcons(container);
}

let evidenceScanCooldown = false;

// 📦 調査資料 専用QRスキャナーモーダル開閉
function openMetaEvidenceQrScanner() {
  const modal = document.getElementById('meta-evidence-qr-modal');
  const statusEl = document.getElementById('evidence-scanner-status');
  const errToast = document.getElementById('evidence-scanner-error-toast');
  if (!modal) return;

  evidenceScanCooldown = false;
  if (errToast) errToast.style.display = 'none';
  modal.style.display = 'flex';
  if (statusEl) {
    statusEl.innerText = "カメラを起動中...";
    statusEl.className = "scanner-status-msg";
  }

  startQrScanner('evidence-scanner-video', 'evidence-scanner-canvas', handleEvidenceQrDetected, 'evidence-scanner-status');
}

function closeMetaEvidenceQrScanner() {
  const modal = document.getElementById('meta-evidence-qr-modal');
  const errToast = document.getElementById('evidence-scanner-error-toast');
  if (modal) modal.style.display = 'none';
  if (errToast) errToast.style.display = 'none';
  evidenceScanCooldown = false;
  stopAllCameraStreams();
}

// 📦 調査資料 QRコード読み取り成功ハンドラー
function handleEvidenceQrDetected(decodedText, statusBox) {
  if (!decodedText || evidenceScanCooldown) return;
  const cleanKey = decodedText.trim();

  const allItems = window.GAME_DATABASE.metaApp.evidenceItems || [];
  const matched = allItems.find(it => it.qrKey === cleanKey || it.id === cleanKey);

  if (!matched) {
    evidenceScanCooldown = true;
    playSystemSound("error");

    // スキャナー画面の上に即時ポップアップバナーを表示
    const errToast = document.getElementById('evidence-scanner-error-toast');
    if (errToast) {
      errToast.style.display = 'flex';
      if (window.lucide) lucide.createIcons();
    }
    if (statusBox) {
      statusBox.innerText = "⚠️ 該当する調査資料がありません";
      statusBox.className = "scanner-status-msg error";
    }

    logWriteToGAS("EVIDENCE_SCAN_NOT_FOUND", `未登録のQRコード読み取り: ${cleanKey}`);

    // カメラは閉じず、約2.2秒後にポップアップを消して即座に再スキャン待機状態へ！
    setTimeout(() => {
      if (errToast) errToast.style.display = 'none';
      if (statusBox) {
        statusBox.innerText = "枠内にQRコードを合わせてください";
        statusBox.className = "scanner-status-msg";
      }
      evidenceScanCooldown = false;
    }, 2200);
    return;
  }

  // 既に所持しているか確認
  if (!gameState.collectedEvidence) gameState.collectedEvidence = [];
  const alreadyHas = gameState.collectedEvidence.some(e => e.id === matched.id);

  const currentLoop = Number(gameState.loop) || 1;
  const currentClock = getFormattedFakeTime();
  const itemName = (matched.names && matched.names[currentLoop]) || matched.id;

  if (!alreadyHas) {
    gameState.collectedEvidence.push({
      id: matched.id,
      collectedTime: currentClock,
      collectedLoop: currentLoop,
      timestamp: Date.now()
    });
    saveStateToStorage();
    logWriteToGAS("EVIDENCE_COLLECTED", `調査資料取得: ${itemName} (${matched.id})`);
  }

  // スキャナーを閉じる
  closeMetaEvidenceQrScanner();

  // 演出トースト表示 ＆ 効果音
  showEvidenceRecordToast(itemName);
  playSystemSound("fanfare");

  // 画面再描画
  renderMetaEvidence();
}

// 🎉 調査資料 記録完了ポップアップトースト
function showEvidenceRecordToast(itemName) {
  const toast = document.getElementById('meta-evidence-toast');
  const nameEl = document.getElementById('meta-toast-item-name');
  if (!toast) return;

  if (nameEl) nameEl.innerText = itemName;
  toast.style.display = 'flex';

  setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

// 🔍 調査資料 カード詳細モーダル開閉
function openMetaEvidenceDetail(itemId, timeStr, itemLoop) {
  const modal = document.getElementById('meta-evidence-detail-modal');
  const imgEl = document.getElementById('detail-item-img');
  const titleEl = document.getElementById('detail-item-title');
  const timeEl = document.getElementById('detail-item-time');
  const loopEl = document.getElementById('detail-item-loop');
  const descEl = document.getElementById('detail-item-desc');
  if (!modal) return;

  const currentLoop = Number(gameState.loop) || 1;
  const allItems = window.GAME_DATABASE.metaApp.evidenceItems || [];
  const item = allItems.find(it => it.id === itemId);
  if (!item) return;

  const name = (item.names && item.names[currentLoop]) || (item.names && item.names[1]) || item.id;
  const desc = (item.detailDescs && item.detailDescs[currentLoop]) || (item.detailDescs && item.detailDescs[1]) || '';

  if (imgEl) imgEl.src = item.image;
  if (titleEl) titleEl.innerText = name;
  if (timeEl) timeEl.innerText = `🕒 ${timeStr || getFormattedFakeTime()} 取得`;
  if (loopEl) loopEl.innerText = `周回 ${itemLoop || currentLoop}`;
  if (descEl) descEl.innerText = desc;

  modal.style.display = 'flex';
}

function closeMetaEvidenceDetail() {
  const modal = document.getElementById('meta-evidence-detail-modal');
  if (modal) modal.style.display = 'none';
}

// ==========================================================================
// 📝 【メモ】タブ ロジック: タブ増設 & テキスト/手書きCanvasデュアルモード & 永続保存
// ==========================================================================
let canvasDrawing = false;
let canvasColor = "#1e293b";
let canvasLineWidth = 2;
let canvasIsEraser = false;
let memoCanvasInitialized = false;

// --- カメラ/QRコード読み取り統合ロジック（iOS Safari / iPadOS 完全最適化版） ---
let activeStream = null;
let qrScanTimeout = null;

function startQrScanner(videoId, canvasId, callback, resultBoxId = 'meta-qr-result') {
  stopAllCameraStreams();

  const video = document.getElementById(videoId);
  const canvas = document.getElementById(canvasId);
  const resultBox = document.getElementById(resultBoxId);
  
  if (resultBox) {
    resultBox.innerText = "📷 カメラを起動しています...";
    resultBox.className = "qr-result-box";
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (resultBox) {
      resultBox.innerText = "⚠️ この端末はカメラAPIに対応していません。手動入力をご利用ください。";
      resultBox.className = "qr-result-box error";
    }
    return;
  }

  // 🍎 iOS Safari 必須プロパティの設定
  if (video) {
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
  }

  // 📷 多段階カメラストリーム取得（背面カメラ優先 ➔ 汎用カメラフォールバック）
  function tryGetCamera(constraints) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  const primaryConstraints = {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 }
    },
    audio: false
  };

  const fallbackConstraints = {
    video: { facingMode: "environment" },
    audio: false
  };

  const ultimateFallbackConstraints = {
    video: true,
    audio: false
  };

  tryGetCamera(primaryConstraints)
    .catch(() => tryGetCamera(fallbackConstraints))
    .catch(() => tryGetCamera(ultimateFallbackConstraints))
    .then(stream => {
      activeStream = stream;
      if (video) {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video.play().catch(e => console.warn("Video play error:", e));
        };
        // 即時playも呼び出し
        video.play().catch(() => {});
      }
      if (resultBox) {
        resultBox.innerText = "🔍 QRコードをスキャン枠に合わせてください...";
        resultBox.className = "qr-result-box";
      }
      
      let lastScanTime = 0;
      function tick(timestamp) {
        if (video && canvas && video.readyState >= 2) { // HAVE_CURRENT_DATA以上
          // 80ms（約12fps）ごとに解析してCPU負荷を劇的に低減
          if (!lastScanTime || timestamp - lastScanTime >= 80) {
            lastScanTime = timestamp;
            const vw = video.videoWidth || 640;
            const vh = video.videoHeight || 480;
            if (vw > 0 && vh > 0) {
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              canvas.width = vw;
              canvas.height = vh;
              ctx.drawImage(video, 0, 0, vw, vh);
              try {
                const imageData = ctx.getImageData(0, 0, vw, vh);
                const code = (typeof jsQR !== 'undefined') ? jsQR(imageData.data, imageData.width, imageData.height, {
                  inversionAttempts: "dontInvert",
                }) : null;

                if (code && code.data) {
                  callback(code.data, resultBox);
                }
              } catch (scanErr) {
                // コンテキストエラーを抑制
              }
            }
          }
        }
        qrScanTimeout = requestAnimationFrame(tick);
      }

      qrScanTimeout = requestAnimationFrame(tick);
    })
    .catch(err => {
      console.warn("📷 カメラアクセス失敗/拒否:", err);
      if (resultBox) {
        resultBox.innerText = "📷 カメラへのアクセスが許可されていません（ブラウザの設定でカメラを許可してください）";
        resultBox.className = "qr-result-box error";
      }
    });
}

function stopAllCameraStreams() {
  if (qrScanTimeout) {
    cancelAnimationFrame(qrScanTimeout);
    qrScanTimeout = null;
  }
  if (activeStream) {
    try {
      activeStream.getTracks().forEach(track => track.stop());
    } catch(e) {}
    activeStream = null;
  }
}

// メモ帳初期化 (起動時およびタブ表示時)
function initMetaMemo() {
  if (!gameState.memoTabs || !Array.isArray(gameState.memoTabs) || gameState.memoTabs.length === 0) {
    gameState.memoTabs = [{ title: "メモ 1", text: "", drawData: null }];
  }
  if (gameState.activeMemoTabIndex === undefined || gameState.activeMemoTabIndex >= gameState.memoTabs.length) {
    gameState.activeMemoTabIndex = 0;
  }

  renderMemoTabs();
  loadActiveMemoContent();
  setupMemoEventListeners();
}

// タブ一覧描画
function renderMemoTabs() {
  const bar = document.getElementById('memo-tabs-bar');
  if (!bar) return;

  const tabsHtml = (gameState.memoTabs || []).map((tab, idx) => {
    const isActive = idx === gameState.activeMemoTabIndex;
    const canDelete = gameState.memoTabs.length > 1;
    const delBtnHtml = canDelete ? `<button class="memo-tab-del-btn" onclick="deleteMemoTab(${idx}, event)" title="このメモを削除">✕</button>` : '';

    return `
      <div class="memo-tab-item ${isActive ? 'active' : ''}" onclick="selectMemoTab(${idx})">
        <span>${tab.title || `メモ ${idx + 1}`}</span>
        ${delBtnHtml}
      </div>
    `;
  }).join('');

  bar.innerHTML = `
    ${tabsHtml}
    <button class="memo-add-tab-btn" onclick="addNewMemoTab()" title="新しいメモページを追加">
      <i data-lucide="plus"></i>
    </button>
  `;

  if (window.lucide) lucide.createIcons();
}

// タブ選択
function selectMemoTab(index) {
  // 現在のタブの内容を保存
  saveCurrentMemoTabContent();

  gameState.activeMemoTabIndex = index;
  renderMemoTabs();
  loadActiveMemoContent();
}

// 新規タブ追加
function addNewMemoTab() {
  saveCurrentMemoTabContent();

  const newIndex = (gameState.memoTabs || []).length + 1;
  gameState.memoTabs.push({
    title: `メモ ${newIndex}`,
    text: "",
    drawData: null
  });
  gameState.activeMemoTabIndex = gameState.memoTabs.length - 1;

  saveStateToStorage();
  renderMemoTabs();
  loadActiveMemoContent();
}

// タブ削除
function deleteMemoTab(index, event) {
  if (event) event.stopPropagation();
  if (gameState.memoTabs.length <= 1) return;

  if (confirm(`「${gameState.memoTabs[index].title}」を削除しますか？`)) {
    gameState.memoTabs.splice(index, 1);
    if (gameState.activeMemoTabIndex >= gameState.memoTabs.length) {
      gameState.activeMemoTabIndex = gameState.memoTabs.length - 1;
    }
    saveStateToStorage();
    renderMemoTabs();
    loadActiveMemoContent();
  }
}

// 現在のアクティブタブの内容を画面にロード
function loadActiveMemoContent() {
  const activeTab = gameState.memoTabs[gameState.activeMemoTabIndex] || { text: "", drawData: null };
  
  // テキストエリア更新
  const textarea = document.getElementById('meta-memo-textarea');
  if (textarea) {
    textarea.value = activeTab.text || "";
  }

  // 手書きCanvas復元
  restoreCanvasImage(activeTab.drawData);
}

// 現在のアクティブタブの内容を保存
function saveCurrentMemoTabContent() {
  const activeTab = gameState.memoTabs[gameState.activeMemoTabIndex];
  if (!activeTab) return;

  const textarea = document.getElementById('meta-memo-textarea');
  if (textarea) {
    activeTab.text = textarea.value;
  }

  const canvas = document.getElementById('memo-canvas');
  if (canvas && memoCanvasInitialized) {
    try {
      activeTab.drawData = canvas.toDataURL();
    } catch (e) {}
  }

  saveStateToStorage();
}

// メモモード切り替え (text / draw)
function setMemoMode(mode) {
  gameState.memoMode = mode;
  const textBtn = document.getElementById('memo-mode-text-btn');
  const drawBtn = document.getElementById('memo-mode-draw-btn');
  const textView = document.getElementById('memo-text-view');
  const drawView = document.getElementById('memo-draw-view');

  if (mode === 'text') {
    if (textBtn) textBtn.classList.add('active');
    if (drawBtn) drawBtn.classList.remove('active');
    if (textView) textView.style.display = 'block';
    if (drawView) drawView.style.display = 'none';
  } else {
    if (textBtn) textBtn.classList.remove('active');
    if (drawBtn) drawBtn.classList.add('active');
    if (textView) textView.style.display = 'none';
    if (drawView) drawView.style.display = 'block';

    // Canvasの初期化とサイズ調整
    setTimeout(() => {
      initMemoCanvas();
    }, 50);
  }
}

// イベントリスナー設定
function setupMemoEventListeners() {
  const textarea = document.getElementById('meta-memo-textarea');
  if (textarea && !textarea._memoBound) {
    textarea._memoBound = true;
    textarea.addEventListener('input', () => {
      const activeTab = gameState.memoTabs[gameState.activeMemoTabIndex];
      if (activeTab) {
        activeTab.text = textarea.value;
        saveStateToStorage();
      }
    });
  }
}

// --- ✏️ Canvas手書き描画エンジン ---
function initMemoCanvas() {
  const canvas = document.getElementById('memo-canvas');
  const wrapper = document.getElementById('memo-canvas-wrapper');
  if (!canvas || !wrapper) return;

  const rect = wrapper.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    // 既存の画像データを一時退避
    let prevData = null;
    if (memoCanvasInitialized) {
      try { prevData = canvas.toDataURL(); } catch (e) {}
    } else {
      const activeTab = gameState.memoTabs[gameState.activeMemoTabIndex];
      if (activeTab && activeTab.drawData) prevData = activeTab.drawData;
    }

    canvas.width = rect.width;
    canvas.height = rect.height;

    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (prevData) {
      restoreCanvasImage(prevData);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  if (!canvas._drawBound) {
    canvas._drawBound = true;

    function getCoords(e) {
      const b = canvas.getBoundingClientRect();
      if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX - b.left, y: e.touches[0].clientY - b.top };
      }
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    }

    function startDraw(e) {
      e.preventDefault();
      canvasDrawing = true;
      const ctx = canvas.getContext('2d');
      const p = getCoords(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.strokeStyle = canvasIsEraser ? '#ffffff' : canvasColor;
      ctx.lineWidth = canvasIsEraser ? canvasLineWidth * 3 : canvasLineWidth;
    }

    function draw(e) {
      if (!canvasDrawing) return;
      e.preventDefault();
      const ctx = canvas.getContext('2d');
      const p = getCoords(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    function stopDraw(e) {
      if (!canvasDrawing) return;
      canvasDrawing = false;
      saveCurrentMemoTabContent();
    }

    // マウスイベント
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', stopDraw);

    // タッチイベント (iPad Safari)
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDraw, { passive: false });
  }

  memoCanvasInitialized = true;
}

function restoreCanvasImage(dataUrl) {
  const canvas = document.getElementById('memo-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!dataUrl) return;

  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
  };
  img.src = dataUrl;
}

function setCanvasColor(color) {
  canvasColor = color;
  canvasIsEraser = false;
  document.querySelectorAll('.canvas-color-dot').forEach(dot => {
    dot.classList.toggle('active', dot.style.background.includes(color) || dot.getAttribute('onclick').includes(color));
  });
  const eraserBtn = document.getElementById('canvas-eraser-btn');
  if (eraserBtn) eraserBtn.classList.remove('active');
}

function setCanvasLineWidth(width) {
  canvasLineWidth = width;
  document.querySelectorAll('.canvas-size-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick').includes(String(width)));
  });
}

function toggleCanvasEraser() {
  canvasIsEraser = !canvasIsEraser;
  const eraserBtn = document.getElementById('canvas-eraser-btn');
  if (eraserBtn) eraserBtn.classList.toggle('active', canvasIsEraser);
}

function clearCurrentCanvas() {
  if (confirm("このページの手書き内容をすべて消去しますか？")) {
    const canvas = document.getElementById('memo-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      saveCurrentMemoTabContent();
    }
  }
}



let metaQrCooldown = false;

// メタQRの判定
function handleMetaQrScan(data, resultBox) {
  if (metaQrCooldown) return;
  metaQrCooldown = true;

  const hint = window.GAME_DATABASE.metaApp.qrHints[data];
  if (hint) {
    if (gameState.unlockedHints.includes(data)) {
      if (resultBox) {
        resultBox.innerText = "取得済みです。";
        resultBox.className = "qr-result-box error";
      }
      playSystemSound("error");
    } else {
      gameState.unlockedHints.push(data);
      saveStateToStorage();
      renderUnlockedHints();
      if (resultBox) {
        resultBox.innerText = `成功: ${hint.title} を入手しました！`;
        resultBox.className = "qr-result-box success";
      }
      playSystemSound("success");
      logWriteToGAS("QR_METADATA_UNLOCKED", `メタ情報取得: ${data}`);
    }
  } else {
    if (resultBox) {
      resultBox.innerText = "無効なコードです。";
      resultBox.className = "qr-result-box error";
    }
    playSystemSound("error");
  }

  // 2秒後にクールダウン解除して再スキャン待機
  setTimeout(() => {
    if (resultBox && gameState.activeMetaTab === 'qr') {
      resultBox.innerText = "🔍 QRコードをスキャン枠に合わせてください...";
      resultBox.className = "qr-result-box";
    }
    metaQrCooldown = false;
  }, 2000);
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

  playSystemSound("success");
}

function handleBrowserSearch(e) {
  if (e.key === 'Enter') {
    const q = e.target.value.trim();
    if (q) {
      // GoogleフォームURLが入力された場合は直接フォームを開く
      if (q.includes('docs.google.com/forms') || q.includes('1FAIpQLSdXFpfSG')) {
        openLinkInAppForm('form_mental_scan');
        return;
      }
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
  if (!container) return;
  container.innerHTML = "";

  // 3周目の場合は不気味変化後の友達リストを使用
  const contactSource = (gameState.loop === 3) 
    ? window.GAME_DATABASE.linkApp.contactsLoop3 
    : window.GAME_DATABASE.linkApp.contacts;

  // 現在追加されている友達のみにフィルター
  const visible = contactSource.filter(c => gameState.addedFriends.includes(c.id));

  visible.forEach(c => {
    const isActive = gameState.activeChatContact === c.id ? "active" : "";
    const chats = window.GAME_DATABASE.linkApp.chats[c.id] || [];
    const lastMsg = chats.filter(m => (!m.minLoop || gameState.loop >= m.minLoop) && (!m.maxLoop || gameState.loop <= m.maxLoop)).pop();
    const lastTime = lastMsg ? lastMsg.time : "今日";
    const lastPreview = lastMsg ? (lastMsg.text || c.desc) : c.desc;

    container.innerHTML += `
      <div class="link-chat-item ${isActive}" onclick="openLinkChat('${c.id}')">
        <div class="link-avatar">${c.icon}</div>
        <div class="link-item-info">
          <div class="link-item-top-row">
            <span class="link-item-name">${c.name}</span>
            <span class="link-item-time">${lastTime}</span>
          </div>
          <div class="link-item-preview">${lastPreview}</div>
        </div>
      </div>
    `;
  });
}

function openLinkChat(contactId, forceScrollToBottom = false) {
  const isRoomChanged = (gameState.activeChatContact !== contactId);
  gameState.activeChatContact = contactId;
  renderLinkChatList();

  const contactSource = (gameState.loop === 3) 
    ? window.GAME_DATABASE.linkApp.contactsLoop3 
    : window.GAME_DATABASE.linkApp.contacts;
  
  const c = contactSource.find(item => item.id === contactId);
  const headerNameEl = document.getElementById('chat-contact-name');
  const memberCountEl = document.getElementById('chat-member-count');
  
  if (headerNameEl) headerNameEl.innerText = c ? c.name : "トークルーム";
  if (memberCountEl) {
    memberCountEl.innerText = (c && c.id === 'exec_group') ? "(5)" : "";
  }

  const messageArea = document.getElementById('link-messages-container');
  if (!messageArea) return;

  // 📜 現在のスクロール位置を記憶（ユーザーが上を読んでいる最中なら勝手に下に飛ばさない）
  const prevScrollTop = messageArea.scrollTop;
  const isNearBottom = (messageArea.scrollHeight - messageArea.scrollTop - messageArea.clientHeight) < 60;

  messageArea.innerHTML = "";

  const messages = window.GAME_DATABASE.linkApp.chats[contactId] || [];
  const filteredMessages = messages.filter(msg => {
    if (msg.minLoop && gameState.loop < msg.minLoop) return false;
    if (msg.maxLoop && gameState.loop > msg.maxLoop) return false;
    return true;
  });
  
  const SENDER_METAS = {
    "jinnai": { name: "陣内 樹", avatar: "J", avatarClass: "avatar-j" },
    "fukasawa": { name: "深澤 文哉", avatar: "F", avatarClass: "avatar-f" },
    "sotozono": { name: "外園 胡春", avatar: "G", avatarClass: "avatar-g" },
    "higa": { name: "比嘉 俊希", avatar: "H", avatarClass: "avatar-h" },
    "inukai": { name: "犬飼 玲", avatar: "犬", avatarClass: "avatar-inukai" },
    "morino": { name: "森野 航", avatar: "森", avatarClass: "avatar-default" },
    "renjo": { name: "連城 観", avatar: "L", avatarClass: "avatar-default" }
  };

  let lastMessageDate = null;

  filteredMessages.forEach((msg, idx) => {
    // 📅 LINE風 日付セパレーター判定（初期メッセージ=9月1日、演者メッセージ=今日）
    const msgDate = msg.date || (idx === 0 ? "9月1日" : "今日");
    if (msgDate && msgDate !== lastMessageDate) {
      lastMessageDate = msgDate;
      messageArea.innerHTML += `
        <div class="chat-date-separator">
          <span class="chat-date-badge">${msgDate}</span>
        </div>
      `;
    }

    const isMe = msg.sender === "me" || msg.sender === "yada";
    const meta = SENDER_METAS[msg.sender] || { name: msg.sender || "メンバー", avatar: (msg.sender || "M")[0].toUpperCase(), avatarClass: "avatar-default" };
    
    // URLの自動リンク化 ＆ OGPカード自動生成
    let formattedText = msg.text || '';
    let ogpHtml = '';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = formattedText.match(urlRegex);

    formattedText = formattedText.replace(urlRegex, (url) => {
      return `<a href="javascript:void(0)" onclick="openLinkInAppForm()" style="color:#0284c7; text-decoration:underline; word-break:break-all; font-weight:500;">${url}</a>`;
    });
    formattedText = formattedText.replace(/\n/g, '<br>');

    // LINE風 OGPカードHTML
    if (msg.ogpCard) {
      const ogp = msg.ogpCard;
      ogpHtml = `
        <div class="line-ogp-card" onclick="openLinkInAppForm('${ogp.formId || ''}')">
          <img src="${ogp.image}" class="line-ogp-thumb" alt="${ogp.title}" loading="lazy">
          <div class="line-ogp-body">
            <div class="line-ogp-title">${ogp.title}</div>
            <div class="line-ogp-desc">${ogp.desc}</div>
            <div class="line-ogp-url"><i data-lucide="globe" style="width:10px; height:10px;"></i> docs.google.com</div>
          </div>
        </div>
      `;
    } else if (urls && urls.length > 0) {
      const firstUrl = urls[0];
      const isGForm = firstUrl.includes('google.com/forms');
      const ogpTitle = isGForm ? "2126年 メンタルヘルス・スキャン" : "共有リンク";
      const ogpDesc = isGForm ? "学友会執行委員会 内部保管データ申請フォーム" : firstUrl;
      const ogpImg = isGForm 
        ? "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=600" 
        : "https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=600";

      ogpHtml = `
        <div class="line-ogp-card" onclick="openLinkInAppForm()">
          <img src="${ogpImg}" class="line-ogp-thumb" alt="${ogpTitle}" loading="lazy">
          <div class="line-ogp-body">
            <div class="line-ogp-title">${ogpTitle}</div>
            <div class="line-ogp-desc">${ogpDesc}</div>
            <div class="line-ogp-url"><i data-lucide="globe" style="width:10px; height:10px;"></i> docs.google.com</div>
          </div>
        </div>
      `;
    }

    const displayTime = formatChatTime(msg.time);

    if (isMe) {
      messageArea.innerHTML += `
        <div class="chat-message-row outgoing">
          <div class="chat-message-content">
            <div class="chat-bubble-wrapper">
              <div class="chat-meta-info">
                <span class="chat-read-status">既読</span>
                <span class="chat-time-str">${displayTime}</span>
              </div>
              <div class="message-bubble outgoing">
                ${formattedText}
              </div>
            </div>
            ${ogpHtml ? `
              <div class="chat-bubble-wrapper" style="margin-top:4px;">
                <div class="chat-meta-info">
                  <span class="chat-read-status">既読</span>
                  <span class="chat-time-str">${displayTime}</span>
                </div>
                <div class="message-bubble outgoing line-ogp-bubble" style="padding:0; background:transparent; box-shadow:none; border:none;">
                  ${ogpHtml}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    } else {
      messageArea.innerHTML += `
        <div class="chat-message-row incoming">
          <div class="chat-sender-avatar ${meta.avatarClass}">${meta.avatar}</div>
          <div class="chat-message-content">
            <div class="chat-sender-name">${meta.name}</div>
            <div class="chat-bubble-wrapper">
              <div class="message-bubble incoming">
                ${formattedText}
              </div>
              <div class="chat-meta-info">
                <span class="chat-time-str" style="color:rgba(255,255,255,0.85);">${displayTime}</span>
              </div>
            </div>
            ${ogpHtml ? `
              <div class="chat-bubble-wrapper" style="margin-top:4px;">
                <div class="message-bubble incoming line-ogp-bubble" style="padding:0; background:transparent; box-shadow:none; border:none;">
                  ${ogpHtml}
                </div>
                <div class="chat-meta-info">
                  <span class="chat-time-str" style="color:rgba(255,255,255,0.85);">${displayTime}</span>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }
  });

  // 3周目の不気味演出
  if (gameState.loop === 3 && contactId === 'fukasawa') {
    messageArea.innerHTML += `<div class="chat-system-event" style="background:rgba(239,68,68,0.25); color:#fee2e2; border:1px solid rgba(239,68,68,0.4);">⚠️ 警告：接続中の相手はシステム保安局により物理的に排除された可能性があります。</div>`;
  }

  safeCreateIcons(messageArea);

  // 📜 ユーザーが上を読んでいる最中ならスクロール位置を維持、部屋変更時または一番下にいる時は下へスクロール
  if (isRoomChanged || forceScrollToBottom || isNearBottom) {
    messageArea.scrollTop = messageArea.scrollHeight;
  } else {
    messageArea.scrollTop = prevScrollTop;
  }
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
  playSystemSound("touch");

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
        safeCreateIcons(bubbleEl);
      }
    }
    playSystemSound("error");
  }, 2000);

  logWriteToGAS("LINK_SEND_ATTEMPT", `メッセージ送信試行 (${gameState.activeChatContact}): ${text}`);
}

// ==========================================================================
// 🟢 LINK専用 LINE風 友だち追加 QRスキャナー (常時エラー仕様)
// ==========================================================================
function openLinkAddFriendScanner() {
  const modal = document.getElementById('link-qr-scanner-modal');
  const errorEl = document.getElementById('link-scanner-error');
  if (!modal) return;

  if (errorEl) errorEl.style.display = 'none';
  modal.style.display = 'flex';

  startQrScanner('link-scanner-video', 'link-scanner-canvas', handleLinkAddFriendQrScanned);
  safeCreateIcons(modal);
  logWriteToGAS("LINK_QR_SCANNER_OPEN", "LINE風 友だち追加スキャナーを起動しました。");
}

function closeLinkAddFriendScanner() {
  const modal = document.getElementById('link-qr-scanner-modal');
  if (modal) modal.style.display = 'none';
  stopAllCameraStreams();
}

// ★ 何を読み取っても常時エラーで読み取れない演出
function handleLinkAddFriendQrScanned(decodedText) {
  console.log("LINK QR Scanned (Always Error):", decodedText);
  const errorEl = document.getElementById('link-scanner-error');
  if (errorEl) {
    errorEl.style.display = 'flex';
  }
  playSystemSound("error");

  // 2秒後にエラーを消して再スキャン可能に
  setTimeout(() => {
    if (errorEl) errorEl.style.display = 'none';
    if (document.getElementById('link-qr-scanner-modal').style.display === 'flex') {
      startQrScanner('link-scanner-video', 'link-scanner-canvas', handleLinkAddFriendQrScanned);
    }
  }, 2200);
}

// ==========================================================================
// 🟢 LINK専用 LINE風 マイQRコード表示モーダル
// ==========================================================================
function openLinkMyQrModal() {
  closeLinkAddFriendScanner();
  const modal = document.getElementById('link-my-qr-modal');
  if (!modal) return;

  const myQrData = window.GAME_DATABASE.linkApp.myQr || {};
  const nameEl = document.getElementById('link-myqr-name');
  const imgEl = document.getElementById('link-myqr-img');

  if (nameEl && myQrData.teamName) nameEl.innerText = myQrData.teamName;
  if (imgEl && myQrData.qrImage) imgEl.src = myQrData.qrImage;

  modal.style.display = 'flex';
  safeCreateIcons(modal);
}

function closeLinkMyQrModal() {
  const modal = document.getElementById('link-my-qr-modal');
  if (modal) modal.style.display = 'none';
}

function copyLinkMyQrUrl() {
  const myQrData = window.GAME_DATABASE.linkApp.myQr || {};
  const url = myQrData.copyLinkUrl || "https://link.line.me/cit_student_council_2126";
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url);
  }
  playSystemSound("success");
}

function refreshLinkMyQr() {
  const imgEl = document.getElementById('link-myqr-img');
  if (imgEl) {
    imgEl.style.opacity = '0.3';
    setTimeout(() => {
      imgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=LINK_USER_PROFILE_2126_CIT_REFRESH_${Date.now()}`;
      imgEl.style.opacity = '1';
    }, 400);
  }
}

// ==========================================================================
// 📱 LINK専用 LINE風 アプリ内フォームオーバーレイ
// ==========================================================================
function openLinkInAppForm(formId) {
  const overlay = document.getElementById('link-inapp-form-overlay');
  const bodyEl = document.getElementById('link-inapp-form-body');
  if (!overlay || !bodyEl) {
    openHackingForm();
    return;
  }

  // Googleフォーム公式完全準拠UI
  const formData = {
    title: "部署業務の認知度",
    description: "学友会執行委員会 内部保管データ申請フォーム\n※ 会の活動を左右する重要なフォームのため、必ず期限までに回答してください。"
  };

  bodyEl.innerHTML = `
    <div class="gform-container">
      <!-- 1. 最上部ヘッダーカード -->
      <div class="gform-header">
        <div class="gform-header-bar"></div>
        <div>
          <h1>${formData.title}</h1>
          <p>${formData.description.replace(/\n/g, '<br>')}</p>
        </div>
        <div class="gform-account-bar">
          <div style="display:flex; align-items:center; gap:6px;">
            <i data-lucide="user-check" style="width:15px; height:15px; color:#1a73e8;"></i>
            <span>学友会アカウント (<strong>cit_student@cit.ac.jp</strong>) で回答中</span>
          </div>
          <span style="font-size:11px; color:#1a73e8; cursor:pointer;">アカウントを切り替える</span>
        </div>
        <div class="gform-required-note">* 必須</div>
      </div>

      <!-- 2. 質問1: 氏名 -->
      <div class="gform-card">
        <label class="gform-label">氏名 <span class="req">*</span></label>
        <input type="text" class="gform-input" id="inapp-form-name" placeholder="回答を入力">
      </div>

      <!-- 3. 質問2: 所属・学籍番号 -->
      <div class="gform-card">
        <label class="gform-label">所属・学籍番号 <span class="req">*</span></label>
        <input type="text" class="gform-input" id="inapp-form-dept" placeholder="回答を入力（例: M25b1046）">
      </div>

      <!-- 4. 質問3: 部署業務への理解度（段落記述） -->
      <div class="gform-card">
        <label class="gform-label">部署業務への理解度・意見 <span class="req">*</span></label>
        <textarea class="gform-textarea" id="inapp-form-reason" placeholder="回答を入力"></textarea>
      </div>

      <!-- 5. アクションボタン行 -->
      <div class="gform-actions-row">
        <button class="gform-submit-btn" type="button" onclick="submitInAppForm()">送信</button>
        <button class="gform-clear-btn" type="button" onclick="clearInAppForm()">フォームをクリア</button>
      </div>

      <!-- 6. Google公式フッター注記 -->
      <div class="gform-legal-footer">
        <div>パスワードを Google フォームで送信しないでください。</div>
        <div>このコンテンツは Google が作成または承認したものではありません。 <a href="#" style="color:#70757a; text-decoration:underline;">不正行為の報告</a> - <a href="#" style="color:#70757a; text-decoration:underline;">利用規約</a> - <a href="#" style="color:#70757a; text-decoration:underline;">プライバシー ポリシー</a></div>
        <div class="gform-branding">
          <span style="font-weight:700; color:#5f6368;">Google</span> フォーム
        </div>
      </div>
    </div>

    <!-- Googleフォーム右下公式フローティング編集ペン -->
    <div class="gform-edit-fab" onclick="openHackingEditor()" title="フォームを編集">
      <i data-lucide="edit-2"></i>
    </div>
  `;

  // スワイプで閉じる（右スワイプでLINKに戻る）
  let startX = 0;
  overlay.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  overlay.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    if (dx > 80) closeLinkInAppForm(); // 右スワイプ80px以上で閉じる
  }, { passive: true });

  overlay.style.display = 'flex';
  if (typeof lucide !== 'undefined') lucide.createIcons();
  logWriteToGAS("LINK_INAPP_FORM_OPEN", "LINE風アプリ内オーバーレイでフォームを開きました。");
}

function clearInAppForm() {
  const nameEl = document.getElementById('inapp-form-name');
  const deptEl = document.getElementById('inapp-form-dept');
  const reasonEl = document.getElementById('inapp-form-reason');
  if (nameEl) nameEl.value = '';
  if (deptEl) deptEl.value = '';
  if (reasonEl) reasonEl.value = '';
}

function closeLinkInAppForm() {
  const overlay = document.getElementById('link-inapp-form-overlay');
  if (overlay) overlay.style.display = 'none';
}

function refreshLinkInAppForm() {
  openLinkInAppForm();
}

function submitInAppForm() {
  const nameEl = document.getElementById('inapp-form-name');
  const deptEl = document.getElementById('inapp-form-dept');
  const reasonEl = document.getElementById('inapp-form-reason');
  const name = nameEl ? nameEl.value.trim() : '';
  const dept = deptEl ? deptEl.value.trim() : '';
  const reason = reasonEl ? reasonEl.value.trim() : '';

  if (!name) {
    alert("必須項目（氏名）を入力してください。");
    return;
  }

  // GASへ回答データを送信（スプレッドシート反映）
  const gasUrl = getResolvedGasUrl();
  if (gasUrl) {
    const payload = {
      action: 'submit_form',
      formTitle: '部署業務の認知度',
      name: name,
      dept: dept,
      reason: reason,
      timestamp: new Date().toISOString()
    };
    fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'no-cors'
    }).catch(e => console.warn('フォーム送信GAS error:', e));
  }

  // 送信完了画面に切り替え（Google Forms公式仕様）
  const bodyEl = document.getElementById('link-inapp-form-body');
  if (bodyEl) {
    bodyEl.innerHTML = `
      <div class="gform-container">
        <div class="gform-header">
          <div class="gform-header-bar"></div>
          <div>
            <h1 style="font-size:28px;">部署業務の認知度</h1>
            <p style="padding-bottom:24px;">回答を記録しました。</p>
          </div>
        </div>
        <div style="margin-top:16px; padding:0 4px;">
          <a href="javascript:void(0)" onclick="openLinkInAppForm('form_mental_scan')" style="color:#1a73e8; font-size:14px; text-decoration:underline;">別の回答を送信</a>
        </div>
        <div class="gform-legal-footer" style="margin-top:48px;">
          <div>このコンテンツは Google が作成または承認したものではありません。 <a href="#" style="color:#70757a; text-decoration:underline;">不正行為の報告</a> - <a href="#" style="color:#70757a; text-decoration:underline;">利用規約</a> - <a href="#" style="color:#70757a; text-decoration:underline;">プライバシー ポリシー</a></div>
          <div class="gform-branding">
            <span style="font-weight:700; color:#5f6368;">Google</span> フォーム
          </div>
        </div>
      </div>
    `;
  }

  playSystemSound("success");
  logWriteToGAS("FORM_SUBMITTED", `フォーム送信: ${name} / ${dept}`);
}

// ==========================================================================
// ④ 偽Googleフォーム & 編集画面 & 偽スプレッドシート（ハッキング）
// ==========================================================================
function openHackingForm() {
  const modal = document.getElementById('hacking-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.getElementById('gform-view').style.display = 'block';
  document.getElementById('gform-editor-view').style.display = 'none';
  document.getElementById('gsheet-view').style.display = 'none';
  
  const form = window.GAME_DATABASE.hacking.form;
  const titleEl = document.getElementById('gform-title');
  const descEl = document.getElementById('gform-desc');
  if (titleEl) titleEl.innerText = form.title;
  if (descEl) descEl.innerText = form.description;

  safeCreateIcons(document.getElementById('gform-view'));
  logWriteToGAS("HACKING_FORM_OPEN", "2126年メンタルヘルス・スキャンを表示しました。");
}

// 🟣 Googleフォーム公式風 編集画面を開く
function openHackingEditor() {
  const modal = document.getElementById('hacking-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.getElementById('gform-view').style.display = 'none';
  document.getElementById('gform-editor-view').style.display = 'block';
  document.getElementById('gsheet-view').style.display = 'none';

  switchEditorTab('questions');
  safeCreateIcons(document.getElementById('gform-editor-view'));
  logWriteToGAS("HACKING_EDITOR_OPEN", "Googleフォーム編集画面（質問/回答）を開きました。");
}

function switchEditorTab(tabId) {
  ['questions', 'responses', 'settings'].forEach(t => {
    const btn = document.getElementById(`editor-tab-${t}-btn`);
    const panel = document.getElementById(`editor-panel-${t}`);
    if (btn) btn.classList.toggle('active', t === tabId);
    if (panel) panel.style.display = (t === tabId) ? 'flex' : 'none';
  });
  if (tabId === 'responses') {
    switchResponsesSubTab('summary');
  }
  safeCreateIcons(document.getElementById('gform-editor-view'));
}

// 🟣 Googleフォーム回答サブタブ（概要 / 質問 / 個別）のデータとコントローラ
const GFORM_RESPONSES_DATA = [
  {
    name: "陣内 樹",
    dept: "J-098（神崎研究室）",
    reason: "神崎教授の研究室から持ち出された機密データ暗号の解除要請。名簿データおよび実験ログのパスコード照会。",
    timestamp: "2126/08/21 16:30:15"
  },
  {
    name: "深澤 文哉",
    dept: "F-042（執行委員会）",
    reason: "学友会予算執行状況および役員名簿の緊急照会。ループ発生に伴うシステム復旧スケジュールの確認。",
    timestamp: "2126/08/21 17:15:42"
  },
  {
    name: "犬飼 玲",
    dept: "I-012（学内保安統制局）",
    reason: "【統制局】2026年跳躍者の所持端末の初期化・回収手続き。U.Z.W.最高管理者プロトコルの執行。",
    timestamp: "2126/08/22 08:50:04"
  }
];

const GFORM_QUESTIONS_DEF = [
  { id: 'name', title: '氏名', key: 'name' },
  { id: 'dept', title: '所属・学籍番号', key: 'dept' },
  { id: 'reason', title: '部署業務への理解度・意見', key: 'reason' }
];

let gformCurrentQuestionIndex = 0;
let gformCurrentIndividualIndex = 0;

function switchResponsesSubTab(subTabId) {
  playSystemSound("touch");
  ['summary', 'question', 'individual'].forEach(st => {
    const btn = document.getElementById(`btn-resp-${st}`);
    const view = document.getElementById(`responses-view-${st}`);
    if (btn) btn.classList.toggle('active', st === subTabId);
    if (view) view.style.display = (st === subTabId) ? 'flex' : 'none';
  });

  if (subTabId === 'question') {
    renderGFormQuestionView();
  } else if (subTabId === 'individual') {
    renderGFormIndividualView();
  }
}

function onSelectGFormQuestion(val) {
  gformCurrentQuestionIndex = parseInt(val, 10);
  renderGFormQuestionView();
}

function prevGFormQuestion() {
  if (gformCurrentQuestionIndex > 0) {
    gformCurrentQuestionIndex--;
    const select = document.getElementById('gform-question-select');
    if (select) select.value = String(gformCurrentQuestionIndex);
    renderGFormQuestionView();
  }
}

function nextGFormQuestion() {
  if (gformCurrentQuestionIndex < GFORM_QUESTIONS_DEF.length - 1) {
    gformCurrentQuestionIndex++;
    const select = document.getElementById('gform-question-select');
    if (select) select.value = String(gformCurrentQuestionIndex);
    renderGFormQuestionView();
  }
}

function renderGFormQuestionView() {
  const qDef = GFORM_QUESTIONS_DEF[gformCurrentQuestionIndex];
  const container = document.getElementById('gform-question-content');
  if (!container || !qDef) return;

  let html = '';
  GFORM_RESPONSES_DATA.forEach((resp) => {
    html += `
      <div class="response-answer-item" style="padding:12px 14px; margin-bottom:8px; background:#f8f9fa; border-radius:6px; border:1px solid #e8eaed;">
        <div style="font-size:11px; color:#5f6368; margin-bottom:4px; font-weight:600;">回答者: ${resp.name}</div>
        <div style="font-size:14px; color:#202124; line-height:1.6;">${resp[qDef.key]}</div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function prevGFormIndividual() {
  if (gformCurrentIndividualIndex > 0) {
    gformCurrentIndividualIndex--;
    renderGFormIndividualView();
  }
}

function nextGFormIndividual() {
  if (gformCurrentIndividualIndex < GFORM_RESPONSES_DATA.length - 1) {
    gformCurrentIndividualIndex++;
    renderGFormIndividualView();
  }
}

function renderGFormIndividualView() {
  const resp = GFORM_RESPONSES_DATA[gformCurrentIndividualIndex];
  const counterEl = document.getElementById('gform-indiv-counter');
  const timeEl = document.getElementById('gform-indiv-timestamp');
  const sheetEl = document.getElementById('gform-individual-sheet');
  if (!resp || !sheetEl) return;

  if (counterEl) counterEl.innerText = `${gformCurrentIndividualIndex + 1} / ${GFORM_RESPONSES_DATA.length} 件`;
  if (timeEl) timeEl.innerText = resp.timestamp;

  sheetEl.innerHTML = `
    <div class="editor-header-card" style="border-top:8px solid #673ab7; padding:22px 24px;">
      <h1 style="font-size:24px; color:#202124; margin:0 0 8px 0; font-weight:600;">部署業務の認知度</h1>
      <p style="font-size:13px; color:#5f6368; margin:0;">回答日時: ${resp.timestamp}</p>
    </div>

    <div class="editor-question-card" style="padding:18px 22px;">
      <div style="font-size:15px; font-weight:600; color:#202124; margin-bottom:10px;">氏名 <span style="color:#d93025;">*</span></div>
      <div style="font-size:14px; color:#202124; padding:10px 14px; background:#f8f9fa; border-radius:4px; border:1px solid #dadce0;">
        ${resp.name}
      </div>
    </div>

    <div class="editor-question-card" style="padding:18px 22px;">
      <div style="font-size:15px; font-weight:600; color:#202124; margin-bottom:10px;">所属・学籍番号 <span style="color:#d93025;">*</span></div>
      <div style="font-size:14px; color:#202124; padding:10px 14px; background:#f8f9fa; border-radius:4px; border:1px solid #dadce0;">
        ${resp.dept}
      </div>
    </div>

    <div class="editor-question-card" style="padding:18px 22px;">
      <div style="font-size:15px; font-weight:600; color:#202124; margin-bottom:10px;">部署業務への理解度・意見 <span style="color:#d93025;">*</span></div>
      <div style="font-size:14px; color:#202124; padding:12px 14px; background:#f8f9fa; border-radius:4px; border:1px solid #dadce0; line-height:1.6;">
        ${resp.reason}
      </div>
    </div>
  `;
}

function submitGForm() {
  showIpadModal("アクセス権限エラー", "エラー：送信に必要なネットワーク権限が不足しています。\n学友会執行委員会またはU.Z.W.の編集者アカウントで実行してください。");
  logWriteToGAS("HACKING_FORM_SUBMIT_FAILED", "メンタルヘルススキャンの送信を試みましたが、権限不足で弾かれました。");
}

function openGSpreadsheet(e) {
  if (e) e.preventDefault();
  const modal = document.getElementById('hacking-modal');
  if (modal) modal.scrollTop = 0;

  document.getElementById('gform-view').style.display = 'none';
  document.getElementById('gform-editor-view').style.display = 'none';
  document.getElementById('gsheet-view').style.display = 'flex';

  const ss = window.GAME_DATABASE.hacking.spreadsheet;
  if (ss && ss.sheets && ss.sheets.includes("フォームの回答 1")) {
    gameState.activeGSheetTab = "フォームの回答 1";
  } else if (!gameState.activeGSheetTab) {
    gameState.activeGSheetTab = (ss && ss.sheets && ss.sheets.length > 0) ? ss.sheets[0] : "フォームの回答 1";
  }
  gameState.isGSheetEditing = false;

  renderGSpreadsheet();

  const viewport = document.querySelector('.gsheet-grid-viewport');
  if (viewport) {
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }

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

  let html = `<thead><tr><th class="gsheet-row-num"></th>`;
  headers.forEach((h, i) => {
    html += `<th>${colLetters[i] || ''}<div style="color:#202124; font-weight:500; font-size:11px; margin-top:2px;">${h}</div></th>`;
  });
  html += `</tr></thead><tbody>`;

  rows.forEach((row, rIdx) => {
    html += `<tr><td class="gsheet-row-num">${rIdx + 1}</td>`;
    row.forEach((cell, cIdx) => {
      const colName = colLetters[cIdx] || 'A';
      const cellName = `${colName}${rIdx + 1}`;
      const editableAttr = isEditing ? 'contenteditable="true" onblur="handleCellEdit(this, \'' + currentTab + '\', ' + rIdx + ', ' + cIdx + ')"' : '';
      html += `<td class="gsheet-cell" data-cell="${cellName}" onclick="selectGSheetCell(this, '${cellName}')" ${editableAttr}>${cell}</td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody>`;
  table.innerHTML = html;

  // 初期選択セル A1
  const firstCell = table.querySelector('.gsheet-cell');
  if (firstCell) {
    selectGSheetCell(firstCell, 'A1');
  }

  safeCreateIcons(document.getElementById('gsheet-table'));
}

function selectGSheetCell(cellEl, cellName) {
  const table = document.getElementById('gsheet-table');
  if (table) {
    table.querySelectorAll('.gsheet-cell').forEach(td => td.classList.remove('active-cell'));
  }
  if (cellEl) {
    cellEl.classList.add('active-cell');
    const cellNameEl = document.getElementById('gsheet-selected-cell-name');
    const fxInput = document.getElementById('gsheet-fx-input');
    if (cellNameEl) cellNameEl.innerText = cellName;
    if (fxInput) fxInput.value = cellEl.innerText;
  }
}

function handleCellEdit(cellEl, tab, rIdx, cIdx) {
  const ss = window.GAME_DATABASE.hacking.spreadsheet;
  if (ss && ss.rows && ss.rows[tab] && ss.rows[tab][rIdx]) {
    ss.rows[tab][rIdx][cIdx] = cellEl.innerText;
    const fxInput = document.getElementById('gsheet-fx-input');
    if (fxInput) fxInput.value = cellEl.innerText;
    try {
      localStorage.setItem('game_custom_gsheet_rows', JSON.stringify(ss.rows));
    } catch (e) {}
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

function showManabaKeychainPopup() {
  const popup = document.getElementById('manaba-keychain-popup');
  if (popup) {
    popup.style.display = 'flex';
    safeCreateIcons(popup);
  }
}

function hideManabaKeychainPopup() {
  // フォーカスアウト直後にクリックできるよう、少し遅延して閉じる
  setTimeout(() => {
    const popup = document.getElementById('manaba-keychain-popup');
    if (popup) popup.style.display = 'none';
  }, 200);
}

function autofillManabaLogin(id, pass, name) {
  const idInput = document.getElementById('manaba-id-input');
  const passInput = document.getElementById('manaba-pass-input');
  const errorMsg = document.getElementById('manaba-error');
  const popup = document.getElementById('manaba-keychain-popup');
  if (errorMsg) errorMsg.style.display = 'none';
  if (popup) popup.style.display = 'none';

  if (idInput && passInput) {
    idInput.value = id;
    passInput.value = pass;
    idInput.classList.add('autofilled-field');
    passInput.classList.add('autofilled-field');

    // 1.5秒後にハイライト解除
    setTimeout(() => {
      idInput.classList.remove('autofilled-field');
      passInput.classList.remove('autofilled-field');
    }, 1500);

    playSystemSound("touch");
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

function switchCourseViewMode(mode) {
  const timetableContainer = document.getElementById('manaba-view-timetable');
  const listContainer = document.getElementById('manaba-view-list');
  const thumbContainer = document.getElementById('manaba-view-thumbnail');

  const tabThumb = document.getElementById('view-tab-thumb');
  const tabList = document.getElementById('view-tab-list');
  const tabWeek = document.getElementById('view-tab-week');

  [tabThumb, tabList, tabWeek].forEach(t => t && t.classList.remove('active'));
  [timetableContainer, listContainer, thumbContainer].forEach(c => c && (c.style.display = 'none'));

  if (mode === 'thumbnail') {
    if (tabThumb) tabThumb.classList.add('active');
    if (thumbContainer) thumbContainer.style.display = 'grid';
  } else if (mode === 'list') {
    if (tabList) tabList.classList.add('active');
    if (listContainer) listContainer.style.display = 'block';
  } else {
    if (tabWeek) tabWeek.classList.add('active');
    if (timetableContainer) timetableContainer.style.display = 'block';
  }
}

function renderManabaPortal() {
  const user = window.GAME_DATABASE.manaba.users[gameState.manabaUser] || {
    name: "連城 観",
    department: "情報科学部 / 学友会執行部",
    studentId: "s23c1044kr",
    timetable: {},
    courses: []
  };

  // 1. ユーザー名・所属表示
  const userNameEl = document.getElementById('portal-username-disp') || document.getElementById('manaba-user-display-name');
  const welcomeNameEl = document.getElementById('manaba-portal-welcome-name');
  const userIdEl = document.getElementById('portal-userid-disp');
  if (userNameEl) userNameEl.innerText = user.name;
  if (welcomeNameEl) welcomeNameEl.innerText = `${user.name}さんのマイページ`;
  if (userIdEl) userIdEl.innerText = user.studentId || gameState.manabaUser;

  // 2. 曜日時間割（月〜土 1〜7限 + 他）のレンダリング
  const timetableBody = document.getElementById('manaba-official-timetable-body');

  if (timetableBody) {
    timetableBody.innerHTML = "";
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    
    for (let period = 1; period <= 7; period++) {
      let rowHtml = `<tr><td class="col-period">${period}</td>`;
      days.forEach(day => {
        const periodIdx = period - 1;
        const courseName = (user.timetable && user.timetable[day] && user.timetable[day][periodIdx]) || "";
        if (courseName) {
          rowHtml += `
            <td class="has-course" onclick="openManabaCourse('${courseName}')" title="${courseName}">
              <a href="javascript:void(0);" class="timetable-course-link">${courseName}</a>
            </td>
          `;
        } else {
          rowHtml += `<td class="empty-cell"></td>`;
        }
      });
      rowHtml += `</tr>`;
      timetableBody.innerHTML += rowHtml;
    }

    // 「他」限目
    let extraRowHtml = `<tr><td class="col-period">他</td>`;
    days.forEach(day => {
      const extraCourse = (user.timetable && user.timetable[day] && user.timetable[day][7]) || "";
      if (extraCourse) {
        extraRowHtml += `
          <td class="has-course" onclick="openManabaCourse('${extraCourse}')">
            <a href="javascript:void(0);" class="timetable-course-link">${extraCourse}</a>
          </td>
        `;
      } else {
        extraRowHtml += `<td class="empty-cell"></td>`;
      }
    });
    extraRowHtml += `</tr>`;
    timetableBody.innerHTML += extraRowHtml;
  }

  // 3. 「その他の曜日」テーブルのレンダリング
  const otherBody = document.getElementById('manaba-official-other-courses-body');
  if (otherBody) {
    otherBody.innerHTML = "";
    const courses = user.courses || [];
    if (courses.length === 0) {
      otherBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#888; padding:12px;">その他の曜日のコースはありません。</td></tr>`;
    } else {
      courses.forEach(c => {
        otherBody.innerHTML += `
          <tr onclick="openManabaCourse('${c.id}')" style="cursor:pointer;">
            <td><a href="javascript:void(0);" class="other-course-name">${c.name}</a></td>
            <td>2026</td>
            <td>${c.term || '2026 前期'}</td>
            <td>${c.teacher || '担当教員'}</td>
          </tr>
        `;
      });
    }
  }

  // 4. リストビューのレンダリング
  const listBody = document.getElementById('manaba-official-courses-list-body');
  if (listBody) {
    listBody.innerHTML = "";
    const courses = user.courses && user.courses.length > 0 ? user.courses : [
      { id: "c_quantum", name: "応用量子力学", teacher: "神崎 恭介", term: "2026 前期 月曜 2限" }
    ];
    courses.forEach(c => {
      listBody.innerHTML += `
        <tr onclick="openManabaCourse('${c.id}')" style="cursor:pointer;">
          <td><a href="javascript:void(0);" class="other-course-name">${c.name}</a></td>
          <td>2026</td>
          <td>${c.term || '2026 前期'}</td>
          <td>${c.teacher || '神崎 恭介'}</td>
        </tr>
      `;
    });
  }

  // 5. サムネイルビューのレンダリング
  const thumbGrid = document.getElementById('manaba-view-thumbnail');
  if (thumbGrid) {
    thumbGrid.innerHTML = "";
    const courses = user.courses && user.courses.length > 0 ? user.courses : [
      { id: "c_quantum", name: "応用量子力学", teacher: "神崎 恭介", term: "2026 前期 月曜 2限" }
    ];
    courses.forEach(c => {
      thumbGrid.innerHTML += `
        <div class="official-thumb-card" onclick="openManabaCourse('${c.id}')">
          <div class="thumb-card-header">
            <span class="thumb-card-code">24QM3011</span>
            <span style="font-size:11px;">📖</span>
          </div>
          <div class="thumb-card-body">
            <div class="thumb-card-title">${c.name}</div>
            <div class="thumb-card-meta">
              <div>担当: ${c.teacher || '神崎 恭介'}</div>
              <div>${c.term || '2026 前期'}</div>
            </div>
          </div>
        </div>
      `;
    });
  }
}

function openManabaSubmissions() {
  playSystemSound("touch");
  const courseDetail = document.getElementById('manaba-course-detail-view');
  const portfolioView = document.getElementById('manaba-portfolio-view');
  const mainCols = document.querySelector('.portal-main-columns');
  const unsubmittedView = document.getElementById('manaba-unsubmitted-view');
  const submissionsView = document.getElementById('manaba-submissions-view');

  if (courseDetail) courseDetail.style.display = 'none';
  if (portfolioView) portfolioView.style.display = 'none';
  if (mainCols) mainCols.style.display = 'none';
  if (unsubmittedView) unsubmittedView.style.display = 'none';
  if (submissionsView) submissionsView.style.display = 'block';

  const portalContent = document.getElementById('manaba-portal-view');
  if (portalContent) portalContent.scrollTop = 0;
  logWriteToGAS("MANABA_SUBMISSIONS_VIEW", "manaba提出記録画面を表示しました");
}

function openManabaUnsubmitted() {
  playSystemSound("touch");
  const courseDetail = document.getElementById('manaba-course-detail-view');
  const portfolioView = document.getElementById('manaba-portfolio-view');
  const mainCols = document.querySelector('.portal-main-columns');
  const unsubmittedView = document.getElementById('manaba-unsubmitted-view');
  const submissionsView = document.getElementById('manaba-submissions-view');

  if (courseDetail) courseDetail.style.display = 'none';
  if (portfolioView) portfolioView.style.display = 'none';
  if (mainCols) mainCols.style.display = 'none';
  if (submissionsView) submissionsView.style.display = 'none';
  if (unsubmittedView) unsubmittedView.style.display = 'block';

  // ユーザー名更新
  const userTitle = document.getElementById('manaba-unsubmitted-user-title');
  const currentUser = (window.GAME_DATABASE && window.GAME_DATABASE.manaba && window.GAME_DATABASE.manaba.users[gameState.manabaUser]) || { name: "連城 観" };
  if (userTitle) userTitle.innerText = `${currentUser.name}さんのマイページ`;

  const portalContent = document.getElementById('manaba-portal-view');
  if (portalContent) portalContent.scrollTop = 0;
  if (typeof lucide !== 'undefined') lucide.createIcons();
  logWriteToGAS("MANABA_UNSUBMITTED_VIEW", "manaba未提出課題一覧を表示しました");
}

function closeManabaSubView() {
  playSystemSound("touch");
  const unsubmittedView = document.getElementById('manaba-unsubmitted-view');
  const submissionsView = document.getElementById('manaba-submissions-view');
  const mainCols = document.querySelector('.portal-main-columns');
  const subHeader = document.querySelector('.portal-sub-header');
  const alertBar = document.querySelector('.portal-alert-bar');

  if (unsubmittedView) unsubmittedView.style.display = 'none';
  if (submissionsView) submissionsView.style.display = 'none';
  if (mainCols) mainCols.style.display = 'flex';
  if (subHeader) subHeader.style.display = 'block';
  if (alertBar) alertBar.style.display = 'flex';

  const portalContent = document.getElementById('manaba-portal-view');
  if (portalContent) portalContent.scrollTop = 0;
}

function switchManabaTab(tabId) {
  gameState.activeManabaTab = tabId;
  const navTabs = document.querySelectorAll('.portal-nav-tabs .nav-tab');
  navTabs.forEach(tab => tab.classList.remove('active'));

  const courseDetail = document.getElementById('manaba-course-detail-view');
  const portfolioView = document.getElementById('manaba-portfolio-view');
  const unsubmittedView = document.getElementById('manaba-unsubmitted-view');
  const submissionsView = document.getElementById('manaba-submissions-view');
  const mainCols = document.querySelector('.portal-main-columns');
  const subHeader = document.querySelector('.portal-sub-header');
  const alertBar = document.querySelector('.portal-alert-bar');

  if (unsubmittedView) unsubmittedView.style.display = 'none';
  if (submissionsView) submissionsView.style.display = 'none';

  if (tabId === 'mypage') {
    if (courseDetail) courseDetail.style.display = 'none';
    if (portfolioView) portfolioView.style.display = 'none';
    if (mainCols) mainCols.style.display = 'flex';
    if (subHeader) subHeader.style.display = 'block';
    if (alertBar) alertBar.style.display = 'flex';
    if (navTabs[0]) navTabs[0].classList.add('active');
    logWriteToGAS("MANABA_TAB", "マイページを開きました");
  } else if (tabId === 'courses') {
    if (portfolioView) portfolioView.style.display = 'none';
    if (navTabs[1]) navTabs[1].classList.add('active');
    // すでにコースを開いていればそのまま、なければ第1講義を開く
    if (courseDetail && courseDetail.style.display !== 'block') {
      openManabaCourse();
    }
  } else if (tabId === 'portfolio') {
    if (courseDetail) courseDetail.style.display = 'none';
    if (mainCols) mainCols.style.display = 'none';
    if (subHeader) subHeader.style.display = 'none';
    if (alertBar) alertBar.style.display = 'none';
    if (portfolioView) portfolioView.style.display = 'block';
    if (navTabs[2]) navTabs[2].classList.add('active');
    logWriteToGAS("MANABA_TAB", "マイポートフォリオを開きました");
  }
}

function togglePortfolioYear(yearId) {
  const yearBody = document.getElementById('portfolio-year-2026');
  const btn = document.querySelector('.collyear-toggle-btn');
  if (yearBody) {
    if (yearBody.style.display === 'none') {
      yearBody.style.display = 'block';
      if (btn) btn.innerText = '切り替え ▲';
    } else {
      yearBody.style.display = 'none';
      if (btn) btn.innerText = '切り替え ▼';
    }
  }
}

function openManabaCourse(courseIdOrName) {
  const allCourses = (window.GAME_DATABASE && window.GAME_DATABASE.manaba && window.GAME_DATABASE.manaba.courses) || {};
  let course = null;

  // 1. IDでの検索
  if (courseIdOrName && allCourses[courseIdOrName]) {
    course = allCourses[courseIdOrName];
  }
  
  // 2. 講義名（日本語）での完全一致検索
  if (!course && courseIdOrName) {
    for (const [cid, cobj] of Object.entries(allCourses)) {
      if (cobj.name === courseIdOrName || cid === courseIdOrName) {
        course = cobj;
        break;
      }
    }
  }

  // 3. ログイン中ユーザーのcourses配列から検索
  const currentUser = (window.GAME_DATABASE && window.GAME_DATABASE.manaba && window.GAME_DATABASE.manaba.users && window.GAME_DATABASE.manaba.users[gameState.manabaUser]);
  if (!course && currentUser && currentUser.courses) {
    const userMatch = currentUser.courses.find(c => c.id === courseIdOrName || c.name === courseIdOrName);
    if (userMatch) {
      course = {
        id: userMatch.id || `c_${Date.now()}`,
        name: userMatch.name,
        teacher: userMatch.teacher || "佐藤 健一",
        term: userMatch.term || "2026 前期",
        room: userMatch.room || "津田沼校舎1号館",
        code: "24" + Math.floor(100000 + Math.random() * 900000),
        news: [
          { date: "2026-08-20", title: `【受講者連絡】${userMatch.name} 第13回 講義資料と小テストについて`, content: `第13回の講義資料を公開しました。次週までに小テストを提出してください。` },
          { date: "2026-08-05", title: `${userMatch.name}｜期末試験座席案内`, content: `期末試験の座席配置を公開しました。学生証を持参の上、指定の座席に着席してください。` }
        ],
        materials: [
          { id: 1, title: `第1回: ${userMatch.name} ガイダンス`, file: `${userMatch.name}_01.pdf`, content: `【${userMatch.name} 第1回講義資料】\n\nシラバス説明と評価基準について。` }
        ]
      };
    }
  }

  // 4. まだ見つからない場合（時間割の科目名から動的生成）
  if (!course) {
    const fallbackName = courseIdOrName || "応用量子力学";
    course = {
      id: `c_${Date.now()}`,
      name: fallbackName,
      teacher: "佐藤 健一",
      term: "2026 前期",
      room: "津田沼校舎1号館",
      code: "24" + Math.floor(100000 + Math.random() * 900000),
      news: [
        { date: "2026-08-20", title: `【受講者連絡】${fallbackName} 第13回 講義資料と小テストについて`, content: `第13回の講義資料を公開しました。次週までに小テストを提出してください。` },
        { date: "2026-08-05", title: `${fallbackName}｜期末試験座席案内`, content: `期末試験の座席配置を公開しました。学生証を持参の上、指定の座席に着席してください。` }
      ],
      materials: [
        { id: 1, title: `第1回: ${fallbackName} ガイダンス`, file: `${fallbackName}_01.pdf`, content: `【${fallbackName} 第1回講義資料】\n\nシラバス説明と評価基準について。` }
      ]
    };
  }

  // 表示切り替え
  const mainCols = document.querySelector('.portal-main-columns');
  const subHeader = document.querySelector('.portal-sub-header');
  const alertBar = document.querySelector('.portal-alert-bar');
  const courseDetail = document.getElementById('manaba-course-detail-view');
  const portfolioView = document.getElementById('manaba-portfolio-view');

  if (mainCols) mainCols.style.display = 'none';
  if (subHeader) subHeader.style.display = 'none';
  if (alertBar) alertBar.style.display = 'none';
  if (portfolioView) portfolioView.style.display = 'none';
  if (courseDetail) courseDetail.style.display = 'block';

  // ナビタブを「コース」にアクティブ化
  const navTabs = document.querySelectorAll('.portal-nav-tabs .nav-tab');
  navTabs.forEach(tab => tab.classList.remove('active'));
  if (navTabs[1]) navTabs[1].classList.add('active');

  // メタデータ反映
  const titleEl = document.getElementById('manaba-course-title');
  const codeEl = document.getElementById('manaba-course-code');
  const teacherEl = document.getElementById('manaba-course-teacher');
  const termEl = document.getElementById('manaba-course-term-full');

  if (titleEl) titleEl.innerText = course.name;
  if (codeEl) codeEl.innerText = course.code || "22179112";
  if (teacherEl) teacherEl.innerText = course.teacher;
  if (termEl) termEl.innerText = course.term || "2026 前期 月曜 2限";

  // コースニュース テーブル生成
  const newsTable = document.getElementById('manaba-course-news-table');
  if (newsTable) {
    newsTable.innerHTML = "";
    const newsList = course.news && course.news.length > 0 ? course.news : [
      {
        date: "2026-08-20",
        title: `【成績保留者】${course.name} 成績保留の対応について`,
        content: `成績保留の学生は、各自の学番を確認し、以下に示した対応をとってください。対応がない場合は不可となります。\n\n対応A：最終試験を受験する 実施日（9月1日11:00〜12:00＠1号館12階1210オフィス）\n対応B：成果レポート1：ユーザビリティテスト（内容は第7回授業資料を確認すること）を提出する\n対応C：成果レポート2： KA法（内容は第12回授業資料を確認すること）を提出する\n\n・提出先：manaba ＞ レポート ＞ 保留対応提出先\n・締切り：8月28日（金）23:55\n\nなお、何か不明な点や意見などがある場合は、manabaの個別指導コレクションからお知らせください。メールには送らないようにしてください。`
      },
      {
        date: "2026-07-10",
        title: `${course.name}｜期末試験座席案内`,
        content: `期末試験の座席配置を公開しました。\n各自、学生証を持参の上、指定の座席に着席してください。\n筆記用具および指定の関数電卓以外の持ち込みは禁止です。`
      },
      {
        date: "2026-06-16",
        title: `${course.name}｜配付資料を公開しました`,
        content: `第11回の講義資料を公開しました。\n変調周波数パラメータおよび超伝導共振器の駆動手順について記載されています。\n各自復習を行ってください。`
      }
    ];

    gameState._currentCourseNewsList = newsList;
    gameState._currentCourseObj = course;

    newsList.forEach((item, idx) => {
      newsTable.innerHTML += `
        <tr onclick="openManabaCourseNewsDetail(${idx})" style="cursor:pointer;">
          <td><a href="javascript:void(0);">◆ ${item.title}</a></td>
          <td class="news-td-date">${item.date}</td>
        </tr>
      `;
    });
  }

  // コンテンツカード（更新順）生成
  const cardGrid = document.getElementById('manaba-materials-card-grid');
  if (cardGrid) {
    cardGrid.innerHTML = "";
    
    // 1. 授業動画カード
    cardGrid.innerHTML += `
      <div class="content-card-item" onclick="showIpadModal('講義アーカイブ動画', '【第11回 講義アーカイブ】\n映像データは現在ストリーミングサーバーから同期中です。\n\n▶ 内容: 高周波共鳴回路と量子変調の実験実演\n▶ 講師: 神崎 恭介 教授\n▶ 収録時間: 45分\n\n（※講義資料PDFおよびメモをご確認ください）')">
        <div class="content-card-icon">
          <div class="card-icon-line"></div>
          <div class="card-icon-line"></div>
          <div class="card-icon-line"></div>
        </div>
        <div class="content-card-info">
          <span class="content-card-title">授業動画</span>
          <span class="content-card-date">2026-07-14 12:56</span>
        </div>
      </div>
    `;

    // 2. 授業資料カード（タップで授業資料ページを開く）
    cardGrid.innerHTML += `
      <div class="content-card-item" onclick="openManabaCoursePageView(0)">
        <div class="content-card-icon">
          <div class="card-icon-line"></div>
          <div class="card-icon-line"></div>
          <div class="card-icon-line"></div>
        </div>
        <div class="content-card-info">
          <span class="content-card-title">授業資料</span>
          <span class="content-card-date">2026-07-14 09:02</span>
        </div>
      </div>
    `;
  }

  // メニューバーの「📖 コースコンテンツ」ボタンにイベントバインド
  const courseContentsBtn = document.querySelector('.course-menu-btn.active-green');
  if (courseContentsBtn) {
    courseContentsBtn.onclick = () => openManabaCoursePageView(0);
  }

  // コーストップ表示状態を初期化
  backToCourseTop();

  logWriteToGAS("MANABA_COURSE_OPEN", `manabaコース詳細を開きました: ${course.name}`);
}

function switchCourseSubTab(tabKey) {
  // ボタンのアクティブ状態更新
  const btnIds = ['top', 'query', 'survey', 'report', 'project', 'grade', 'bbs', 'page'];
  btnIds.forEach(id => {
    const btn = document.getElementById(`cmenu-btn-${id}`);
    if (btn) {
      btn.classList.remove('active-green');
      if (id === tabKey) btn.classList.add('active-green');
    }
  });

  const mainCols = document.getElementById('course-top-main-columns');
  const noticeBox = document.getElementById('course-top-notice-box');
  const sublinksRow = document.getElementById('course-top-sublinks-row');
  const subtabView = document.getElementById('course-subtab-view-container');
  const pageDetailView = document.getElementById('manaba-course-page-view');
  const newsDetailView = document.getElementById('manaba-course-news-detail-view');
  const titleTextEl = document.getElementById('course-subtab-title-text');
  const bodyEl = document.getElementById('course-subtab-body');

  // 詳細画面は閉じる
  if (pageDetailView) pageDetailView.style.display = 'none';
  if (newsDetailView) newsDetailView.style.display = 'none';

  if (tabKey === 'top') {
    if (mainCols) mainCols.style.display = 'block';
    if (noticeBox) noticeBox.style.display = 'block';
    if (sublinksRow) sublinksRow.style.display = 'flex';
    if (subtabView) subtabView.style.display = 'none';
    return;
  }

  if (tabKey === 'page') {
    if (mainCols) mainCols.style.display = 'none';
    if (noticeBox) noticeBox.style.display = 'none';
    if (sublinksRow) sublinksRow.style.display = 'none';
    if (subtabView) subtabView.style.display = 'none';
    openManabaCoursePageView(0);
    return;
  }

  // サブタブ一覧表示
  if (mainCols) mainCols.style.display = 'none';
  if (noticeBox) noticeBox.style.display = 'none';
  if (sublinksRow) sublinksRow.style.display = 'none';
  if (subtabView) subtabView.style.display = 'block';

  const TAB_DATA = {
    query: {
      title: "小テスト一覧",
      html: `
        <div class="description vspacing" style="margin-top: 15px;">
          <p class="first small" style="background:#fff; border:1px solid #d4d4d4; padding:16px 20px; border-radius:4px; color:#444; font-size:13.5px; line-height:1.6;">
            このコースには現在小テストはありません。
          </p>
        </div>
      `
    },
    survey: {
      title: "アンケート一覧",
      html: `
        <div class="description vspacing" style="margin-top: 15px;">
          <p class="first small" style="background:#fff; border:1px solid #d4d4d4; padding:16px 20px; border-radius:4px; color:#444; font-size:13.5px; line-height:1.6;">
            このコースには現在アンケートはありません。
          </p>
        </div>
      `
    },
    report: {
      title: "レポート一覧",
      html: `
        <div class="description vspacing" style="margin-top: 15px;">
          <table class="course-news-official-table" style="width:100%; border:1px solid #d4d4d4; background:#fff; border-collapse:collapse;">
            <thead>
              <tr style="background:#f4f4f4; border-bottom:1.5px solid #d4d4d4;">
                <th style="padding:10px 14px; text-align:left; font-size:13px; color:#333;">タイトル</th>
                <th style="padding:10px 14px; text-align:left; font-size:13px; color:#333; width:220px;">受付期間</th>
                <th style="padding:10px 14px; text-align:center; font-size:13px; color:#333; width:90px;">状態</th>
                <th style="padding:10px 14px; text-align:center; font-size:13px; color:#333; width:100px;">提出</th>
              </tr>
            </thead>
            <tbody>
              <tr style="border-bottom:1px solid #eee;">
                <td style="padding:12px 14px; font-size:13.5px;">
                  <a href="javascript:void(0);" onclick="showIpadModal('レポート課題要項', '【期末成果レポート課題要項】\n\n■ 課題内容:\n第11回授業資料に記載された基準変調周波数（119.43MHz）の導出式および超伝導共鳴器の駆動手順について、検証レポートを作成すること。\n\n■ 提出期日: 2026/08/28 23:55\n■ 対象者: 履修生全員')" style="color:#0272c1; font-weight:700; text-decoration:none;">
                    【期末成果レポート】変調周波数の検証レポート
                  </a>
                </td>
                <td style="padding:12px 14px; font-size:12px; color:#666;">2026/08/20 09:00 〜 2026/08/28 23:55</td>
                <td style="padding:12px 14px; text-align:center;"><span style="color:#d97706; font-weight:700; font-size:12px; background:#fef3c7; padding:3px 8px; border-radius:4px;">受付中</span></td>
                <td style="padding:12px 14px; text-align:center;">
                  <button class="btn btn-secondary btn-sm" onclick="showIpadModal('レポート提出', '【提出受付】\n調査メモに記録したデータをもとに提出します。\n\n（※本演習では自動的に調査メモの記録が反映されます）')" style="font-size:12px; padding:3px 10px;">提出</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      `
    },
    project: {
      title: "プロジェクト一覧",
      html: `
        <div class="description vspacing" style="margin-top: 15px;">
          <p class="first small" style="background:#fff; border:1px solid #d4d4d4; padding:16px 20px; border-radius:4px; color:#444; font-size:13.5px; line-height:1.6;">
            参加中のプロジェクトはありません。
          </p>
        </div>
      `
    },
    grade: {
      title: "成績一覧",
      html: `
        <div class="description vspacing" style="margin-top: 15px;">
          <p class="first small" style="background:#fff; border:1px solid #d4d4d4; padding:16px 20px; border-radius:4px; color:#444; font-size:13.5px; line-height:1.6;">
            成績発表期間外です（2026年度前期成績は9月上旬公開予定）。
          </p>
        </div>
      `
    },
    bbs: {
      title: "掲示板",
      html: `
        <div class="description vspacing" style="margin-top: 15px;">
          <p class="first small" style="background:#fff; border:1px solid #d4d4d4; padding:16px 20px; border-radius:4px; color:#444; font-size:13.5px; line-height:1.6;">
            掲示板に投稿されたスレッドはありません。
          </p>
        </div>
      `
    }
  };

  const currentTab = TAB_DATA[tabKey] || { title: "一覧", html: "" };
  if (titleTextEl) titleTextEl.innerText = currentTab.title;
  if (bodyEl) bodyEl.innerHTML = currentTab.html;

  logWriteToGAS("MANABA_SUBTAB_OPEN", `コースメニュータブ切り替え: ${currentTab.title}`);
}

function openManabaCoursePageView(pageIdx) {
  const course = gameState._currentCourseObj || (window.GAME_DATABASE.manaba.courses && window.GAME_DATABASE.manaba.courses["c_quantum"]) || {};
  const materials = course.materials || [];
  
  // 0番目は「スケジュール」、1番目以降は「第1回〜第13回」の各講義資料
  const coursePages = [
    { title: "スケジュール", type: "schedule", date: "2026-04-14 05:24", ver: "1.2版" },
    ...materials.map((m, idx) => ({
      title: m.title || `第${idx + 1}回 講義資料`,
      type: "material",
      date: `2026-0${Math.min(4 + Math.floor(idx / 4), 7)}-${String(10 + (idx % 4) * 7).padStart(2, '0')}`,
      time: `2026-0${Math.min(4 + Math.floor(idx / 4), 7)}-${String(10 + (idx % 4) * 7).padStart(2, '0')} 08:30:00`,
      ver: "1.0版",
      file: m.file || `${course.name || 'Lecture'}_${idx + 1}.pdf`,
      content: m.content,
      matId: m.id || (idx + 1)
    }))
  ];

  const pIdx = (pageIdx !== undefined && pageIdx >= 0 && pageIdx < coursePages.length) ? pageIdx : 0;
  gameState._currentCoursePageIdx = pIdx;
  gameState._currentCoursePagesList = coursePages;

  const mainBody = document.querySelector('.official-course-main-body');
  const newsDetailView = document.getElementById('manaba-course-news-detail-view');
  const pageDetailView = document.getElementById('manaba-course-page-view');
  const noticeBox = document.querySelector('.official-course-notice-box');
  const sublinksRow = document.querySelector('.official-course-sublinks-row');

  if (mainBody) mainBody.style.display = 'none';
  if (newsDetailView) newsDetailView.style.display = 'none';
  if (noticeBox) noticeBox.style.display = 'none';
  if (sublinksRow) sublinksRow.style.display = 'none';
  if (pageDetailView) pageDetailView.style.display = 'block';

  const pageData = coursePages[pIdx];

  // タイトル・版数
  const titleEl = document.getElementById('course-page-article-title');
  const verEl = document.getElementById('course-page-version-info');
  const limitEl = document.getElementById('course-page-limit-notice');

  if (titleEl) titleEl.innerText = pageData.title;
  if (verEl) verEl.innerText = `${pageData.date} - ${course.teacher || '担当教員'} - ${pageData.ver}`;
  
  if (limitEl) {
    if (pageData.type === 'schedule') {
      limitEl.style.display = 'none';
    } else {
      limitEl.style.display = 'block';
      limitEl.innerText = `公開期間: ${pageData.time} ～`;
    }
  }

  // 本文エリアのレンダリング
  const contentBody = document.getElementById('course-page-dynamic-content');
  if (contentBody) {
    if (pageData.type === 'schedule') {
      let tbodyHtml = "";
      materials.forEach((m, idx) => {
        const num = idx + 1;
        const month = Math.min(4 + Math.floor(idx / 4), 7);
        const day = 10 + (idx % 4) * 7;
        const isOnline = num === 5 || num === 7 || num === 9 || num === 12;
        const isReport = num === 7 || num === 12;
        tbodyHtml += `
          <tr>
            <td style="text-align:center;">${num}</td>
            <td style="text-align:center;">${month}月${day}日</td>
            <td>${m.title}</td>
            <td class="${isOnline ? 'tag-online' : ''}">${isOnline ? 'オンライン' : ''}${isReport ? '<br><span class="tag-report">成果レポート</span>' : ''}</td>
          </tr>
        `;
      });

      contentBody.innerHTML = `
        <table class="manaba-schedule-official-table">
          <thead>
            <tr>
              <th style="width:40px;">回</th>
              <th style="width:70px;">日</th>
              <th>テーマ</th>
              <th style="width:90px;">注意</th>
            </tr>
          </thead>
          <tbody>
            ${tbodyHtml}
          </tbody>
        </table>
      `;
    } else {
      const fileName = pageData.file;
      contentBody.innerHTML = `
        <div class="content-section-heading">授業資料</div>
        <div class="official-attachment-box">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:18px;">📄</span>
            <a href="javascript:void(0);" onclick="openPdfViewer('${course.id || 'c_quantum'}', ${pageData.matId})" class="attachment-file-title">${fileName}</a>
            <span style="font-size:10px; color:#777;">- ${pageData.time}</span>
          </div>
          <button class="btn-file-preview" onclick="openPdfViewer('${course.id || 'c_quantum'}', ${pageData.matId})">表示</button>
        </div>

        <div class="content-section-heading">授業ノート・補足内容</div>
        <div style="background:#fafafa; border:1px solid #e0e0e0; padding:12px 16px; border-radius:4px; margin-top:8px; font-family:monospace; line-height:1.75; font-size:12px; color:#333;">
          ${pageData.content || '講義資料を参照してください。'}
        </div>

        <div class="content-section-heading">質問・ディスカッション</div>
        <p style="margin:6px 0 16px 0; font-size:12px;">
          本講義に関する質問やコメントは、掲示板または個別指導コレクションから投稿してください。
        </p>
      `;
    }
  }

  // 目次サイドバーのレンダリング
  const sidebarUl = document.getElementById('course-page-index-list');
  if (sidebarUl) {
    sidebarUl.innerHTML = "";
    coursePages.forEach((item, idx) => {
      const isCur = idx === pIdx;
      sidebarUl.innerHTML += `
        <li class="${isCur ? 'current' : ''}" onclick="openManabaCoursePageView(${idx})">
          <span style="color:${isCur ? '#5c9a00' : '#0272c1'}; font-size:10px;">▶</span>
          <span>${item.title}</span>
        </li>
      `;
    });
  }

  // 前へ / 次へ ボタン制御
  const prevBtn = document.getElementById('page-nav-prev');
  const nextBtn = document.getElementById('page-nav-next');
  if (prevBtn) prevBtn.style.visibility = pIdx > 0 ? 'visible' : 'hidden';
  if (nextBtn) nextBtn.style.visibility = pIdx < coursePages.length - 1 ? 'visible' : 'hidden';

  logWriteToGAS("MANABA_COURSE_PAGE_OPEN", `授業資料閲覧: ${course.name} - ${pageData.title}`);
}

function changeCoursePageRel(delta) {
  const cur = gameState._currentCoursePageIdx || 0;
  openManabaCoursePageView(cur + delta);
}

function backToCourseTop() {
  const mainBody = document.querySelector('.official-course-main-body');
  const newsDetailView = document.getElementById('manaba-course-news-detail-view');
  const pageDetailView = document.getElementById('manaba-course-page-view');
  const noticeBox = document.querySelector('.official-course-notice-box');
  const sublinksRow = document.querySelector('.official-course-sublinks-row');

  if (newsDetailView) newsDetailView.style.display = 'none';
  if (pageDetailView) pageDetailView.style.display = 'none';
  if (mainBody) mainBody.style.display = 'block';
  if (noticeBox) noticeBox.style.display = 'block';
  if (sublinksRow) sublinksRow.style.display = 'flex';
}

function backToManabaPortal() {
  switchManabaTab('mypage');
}

function openPdfViewer(courseId, materialId) {
  const cid = courseId || "c_quantum";
  const course = (window.GAME_DATABASE.manaba.courses && window.GAME_DATABASE.manaba.courses[cid]) || window.GAME_DATABASE.manaba.courses["c_quantum"];
  const mat = course && course.materials && course.materials.find(m => m.id === materialId);
  if (!mat) return;

  const pdfViewer = document.getElementById('manaba-pdf-viewer');
  if (pdfViewer) {
    pdfViewer.style.display = 'flex';
    const filenameEl = document.getElementById('pdf-filename');
    if (filenameEl) filenameEl.innerText = mat.file;
    const bodyEl = document.getElementById('pdf-viewer-body');
    if (bodyEl) {
      bodyEl.innerHTML = `
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
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } else {
    showIpadModal(mat.title, `${mat.content}\n\n[添付ファイル: ${mat.file}]`);
  }
  logWriteToGAS("MANABA_MATERIAL_OPEN", `講義資料閲覧: ${mat.title}`);
}

function clipTextToMemo(title, text) {
  const memoArea = document.getElementById('meta-memo-area');
  if (!memoArea) return;

  const clipText = `\n【資料転記: ${title}】\n${text}\n`;
  memoArea.value = (memoArea.value + clipText).trim();
  localStorage.setItem('game_memo', memoArea.value);

  playSystemSound("success");
}

function closePdfViewer() {
  document.getElementById('manaba-pdf-viewer').style.display = 'none';
}

// ==========================================================================
// ⑥ メールアプリ（作成・送信・削除・返信・フラグ・検索・フォルダ管理）
// ==========================================================================
let mailState = {
  currentFolder: 'inbox',
  searchQuery: '',
  selectedMailId: null,
  flaggedIds: new Set(),
  trashIds: new Set(),
  sentMails: []
};

function showMailInAppToast(text) {
  const toast = document.getElementById('mail-inapp-toast');
  const textEl = document.getElementById('mail-inapp-toast-text');
  if (toast && textEl) {
    textEl.innerText = text;
    toast.style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    setTimeout(() => { toast.style.display = 'none'; }, 2200);
  }
}

function switchMailFolder(folder) {
  mailState.currentFolder = folder;
  const select = document.getElementById('mail-folder-select');
  if (select) select.value = folder;
  const badge = document.getElementById('mail-current-folder-badge');
  const title = document.getElementById('mail-folder-title');
  const folderNames = { inbox: '受信', sent: '送信済み', trash: 'ゴミ箱', flagged: 'フラグ付き' };
  if (badge) badge.innerText = folderNames[folder] || '受信';
  if (title) title.innerText = (folderNames[folder] || '受信') + (folder === 'inbox' ? 'トレイ' : '');
  renderMailList();
}

function onMailSearchInput(val) {
  mailState.searchQuery = (val || '').toLowerCase().trim();
  renderMailList();
}

function getMailItemsForCurrentFolder() {
  const dbMails = window.GAME_DATABASE.mailApp[gameState.loop] || [];
  let list = [];

  if (mailState.currentFolder === 'inbox') {
    list = dbMails.filter(m => !mailState.trashIds.has(m.id));
  } else if (mailState.currentFolder === 'sent') {
    list = mailState.sentMails.filter(m => !mailState.trashIds.has(m.id));
  } else if (mailState.currentFolder === 'trash') {
    const all = [...dbMails, ...mailState.sentMails];
    list = all.filter(m => mailState.trashIds.has(m.id));
  } else if (mailState.currentFolder === 'flagged') {
    const all = [...dbMails, ...mailState.sentMails];
    list = all.filter(m => mailState.flaggedIds.has(m.id) && !mailState.trashIds.has(m.id));
  }

  if (mailState.searchQuery) {
    list = list.filter(m => {
      const s = (m.sender || '').toLowerCase();
      const t = (m.subject || m.title || '').toLowerCase();
      const b = (m.body || '').toLowerCase();
      return s.includes(mailState.searchQuery) || t.includes(mailState.searchQuery) || b.includes(mailState.searchQuery);
    });
  }

  return list;
}

function renderMailList() {
  const container = document.getElementById('mail-list');
  if (!container) return;
  container.innerHTML = "";

  const mails = getMailItemsForCurrentFolder();
  if (mails.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:#9ca3af; padding:32px 16px; font-size:13px;">メールはありません</div>`;
    const headerEl = document.getElementById('mail-body-header');
    const contentEl = document.getElementById('mail-body-content');
    if (headerEl) {
      headerEl.innerHTML = `<div class="mail-empty-selection"><i data-lucide="mail-open" style="width:48px; height:48px; stroke-width:1.2; color:#9ca3af; margin-bottom:12px;"></i><p>メールがありません</p></div>`;
      safeCreateIcons(headerEl);
    }
    if (contentEl) contentEl.innerHTML = "";
    return;
  }

  mails.forEach((mail, idx) => {
    const isSelected = mail.id === mailState.selectedMailId || (!mailState.selectedMailId && idx === 0);
    const snippet = (mail.body || "").replace(/\n/g, " ").slice(0, 48) + "...";
    const isFlagged = mailState.flaggedIds.has(mail.id);
    
    container.innerHTML += `
      <div class="mail-item ${isSelected ? 'active' : ''}" onclick="openMail('${mail.id}')" id="mail-item-${mail.id}">
        <div class="mail-item-top">
          <div class="mail-item-sender">
            <span class="mail-unread-dot"></span>
            ${mail.sender}
            ${isFlagged ? '<i data-lucide="flag" style="width:11px; height:11px; color:#f97316; fill:#f97316; margin-left:4px;"></i>' : ''}
          </div>
          <div class="mail-item-date">${mail.date}</div>
        </div>
        <div class="mail-item-title">${mail.subject || mail.title}</div>
        <div class="mail-item-snippet">${snippet}</div>
      </div>
    `;
  });

  safeCreateIcons(container);

  // 初期選択
  const currentSelected = mails.find(m => m.id === mailState.selectedMailId) || mails[0];
  if (currentSelected) {
    openMail(currentSelected.id);
  }
}

function openMail(mailId) {
  mailState.selectedMailId = mailId;
  document.querySelectorAll('.mail-item').forEach(el => el.classList.remove('active'));
  const activeItem = document.getElementById(`mail-item-${mailId}`);
  if (activeItem) activeItem.classList.add('active');

  const allMails = [...(window.GAME_DATABASE.mailApp[gameState.loop] || []), ...mailState.sentMails];
  const mail = allMails.find(m => m.id === mailId);

  // フラグボタンのスタイル更新
  const flagBtn = document.getElementById('mail-flag-btn');
  if (flagBtn) {
    if (mailState.flaggedIds.has(mailId)) {
      flagBtn.style.color = '#f97316';
    } else {
      flagBtn.style.color = '';
    }
  }

  if (mail) {
    const initial = (mail.sender || "学")[0];
    const headerEl = document.getElementById('mail-body-header');
    const contentEl = document.getElementById('mail-body-content');

    if (headerEl) {
      headerEl.innerHTML = `
        <div class="mail-detail-header-card">
          <h1 class="mail-body-title">${mail.subject || mail.title}</h1>
          <div class="mail-sender-profile-row">
            <div class="mail-sender-avatar-group">
              <div class="mail-sender-avatar">${initial}</div>
              <div class="mail-sender-meta">
                <span class="mail-sender-name">${mail.sender}</span>
                <span class="mail-recipient-to">宛先: ${mail.recipient || '自分 <cit-student@cit.ac.jp>'}</span>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="mail-sent-date-badge">${mail.date}</span>
              <button class="btn btn-secondary btn-sm" onclick="clipTextToMemo('${mail.subject || mail.title}', '${mail.body.replace(/'/g, "\\'").replace(/\n/g, "\\n")}')" style="display:flex; align-items:center; gap:4px; font-size:11px; padding:4px 8px;">
                <i data-lucide="clipboard-copy" style="width:13px; height:13px;"></i> メモ転記
              </button>
            </div>
          </div>
        </div>
      `;
    }

    if (contentEl) {
      const sanitizedBody = (mail.body || "").trim().replace(/\n/g, "<br>");
      contentEl.innerHTML = `<div class="mail-body-text-block">${sanitizedBody}</div>`;
    }

    safeCreateIcons(headerEl);
    logWriteToGAS("MAIL_OPEN", `メールを開きました: ${mailId} (${mail.subject || mail.title})`);
  }
}

// 新規作成モーダル開閉
function openComposeMailModal(replyTo = null) {
  const modal = document.getElementById('mail-compose-modal');
  if (!modal) return;
  const toInput = document.getElementById('compose-mail-to');
  const subInput = document.getElementById('compose-mail-subject');
  const bodyInput = document.getElementById('compose-mail-body');

  if (replyTo) {
    if (toInput) toInput.value = replyTo.sender || "inukai@uzw-corp.jp";
    if (subInput) subInput.value = `Re: ${replyTo.subject || replyTo.title || ""}`;
    if (bodyInput) bodyInput.value = `\n\n--- 元のメッセージ ---\n${replyTo.body || ""}`;
  } else {
    if (toInput) toInput.value = "";
    if (subInput) subInput.value = "";
    if (bodyInput) bodyInput.value = "";
  }

  modal.style.display = 'flex';
  if (toInput && !replyTo) toInput.focus();
  playSystemSound("touch");
}

function closeComposeMailModal() {
  const modal = document.getElementById('mail-compose-modal');
  if (modal) modal.style.display = 'none';
}

function sendComposedMail() {
  const toInput = document.getElementById('compose-mail-to');
  const subInput = document.getElementById('compose-mail-subject');
  const bodyInput = document.getElementById('compose-mail-body');

  const to = toInput ? toInput.value.trim() : "";
  const subject = subInput ? subInput.value.trim() : "（件名なし）";
  const body = bodyInput ? bodyInput.value.trim() : "";

  if (!to) {
    alert("宛先を入力してください。");
    return;
  }

  const newMail = {
    id: "sent_" + Date.now(),
    sender: "自分",
    recipient: to,
    subject: subject,
    title: subject,
    date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    body: body
  };

  mailState.sentMails.unshift(newMail);
  closeComposeMailModal();
  playSystemSound("notif");
  showMailInAppToast("メールを送信しました");
  logWriteToGAS("MAIL_SEND", `メール送信: To=${to}, Subject=${subject}`);
}

function deleteCurrentSelectedMail() {
  if (!mailState.selectedMailId) {
    showMailInAppToast("削除するメールが選択されていません");
    return;
  }
  mailState.trashIds.add(mailState.selectedMailId);
  playSystemSound("touch");
  showMailInAppToast("ゴミ箱に移動しました");
  mailState.selectedMailId = null;
  renderMailList();
}

function replyToCurrentSelectedMail(isForward = false) {
  const allMails = [...(window.GAME_DATABASE.mailApp[gameState.loop] || []), ...mailState.sentMails];
  const mail = allMails.find(m => m.id === mailState.selectedMailId);
  if (!mail) {
    openComposeMailModal();
    return;
  }
  if (isForward) {
    openComposeMailModal({
      sender: "",
      subject: `Fwd: ${mail.subject || mail.title || ""}`,
      body: mail.body
    });
  } else {
    openComposeMailModal(mail);
  }
}

function toggleFlagCurrentSelectedMail() {
  if (!mailState.selectedMailId) return;
  const id = mailState.selectedMailId;
  if (mailState.flaggedIds.has(id)) {
    mailState.flaggedIds.delete(id);
    showMailInAppToast("フラグを解除しました");
  } else {
    mailState.flaggedIds.add(id);
    showMailInAppToast("フラグを付けました");
  }
  playSystemSound("touch");
  renderMailList();
}

// ==========================================================================
// ⑦ 電話アプリ（コール音 ＆ 音声ガイダンス演出 ＆ **##** 隠しコマンド）
// ==========================================================================
let phoneCallAudioTimer = null;

function pressPhoneKey(key) {
  if (gameState.phoneInput.length < 15) {
    gameState.phoneInput += key;
    const display = document.getElementById('phone-display');
    if (display) display.innerText = gameState.phoneInput;
    playSystemSound("dtmf");
  }
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
}

function clearPhoneKey(withSound = true) {
  if (gameState.phoneInput && gameState.phoneInput.length > 0) {
    gameState.phoneInput = gameState.phoneInput.slice(0, -1);
    const display = document.getElementById('phone-display');
    if (display) display.innerText = gameState.phoneInput;
    if (withSound) playSystemSound("touch");
  }
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
}

function resetPhoneInputFull() {
  gameState.phoneInput = "";
  const display = document.getElementById('phone-display');
  if (display) display.innerText = "";
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
}

let phoneCallTimers = [];

function clearAllPhoneTimers() {
  phoneCallTimers.forEach(id => clearTimeout(id));
  phoneCallTimers = [];
  if (phoneCallAudioTimer) {
    clearTimeout(phoneCallAudioTimer);
    phoneCallAudioTimer = null;
  }
}

function makePhoneCall() {
  if (!gameState.phoneInput) {
    showIpadModal("電話", "電話番号を入力してください。");
    return;
  }
  
  const dialNum = gameState.phoneInput.trim();

  // 隠しコマンド判定（『**##**』を入力して電話ボタンを押した時にスタッフシステム起動）
  if (dialNum === '**##**') {
    clearPhoneKey();
    playSystemSound("fanfare");
    showStaffModal();
    return;
  }

  clearAllPhoneTimers();

  const overlay = document.getElementById('phone-calling-overlay');
  document.getElementById('phone-calling-number').innerText = dialNum;
  document.getElementById('phone-calling-status').innerText = "発信中...";
  document.getElementById('phone-audio-subtitles').innerText = "プルルル…… プルルル……";
  overlay.style.display = 'flex';

  playSystemSound("ringback");
  
  // 1.4秒後に2回目の「プルルルルル……」
  const timer1 = setTimeout(() => {
    const ov = document.getElementById('phone-calling-overlay');
    if (ov && ov.style.display !== 'none') {
      playSystemSound("ringback");
    }
  }, 1400);
  phoneCallTimers.push(timer1);

  logWriteToGAS("PHONE_CALL_ATTEMPT", `発信試行: ${dialNum}`);

  // 3.0秒後に音声ガイダンスアナウンスへ移行
  phoneCallAudioTimer = setTimeout(() => {
    const ov = document.getElementById('phone-calling-overlay');
    if (!ov || ov.style.display === 'none') return;

    document.getElementById('phone-calling-status').innerText = "ガイダンス応答";
    const guidanceText = "おかけになった電話番号は、現在使われておりません。または時間線の不整合により接続できません。番号をお確かめになって、もう一度お掛け直しください。";
    document.getElementById('phone-audio-subtitles').innerText = `「${guidanceText}」`;
    
    // Web Speech API で音声合成アナウンス（日本語女性トーン）
    speakGuidanceAudio(guidanceText);

    // 6.5秒後に自動切断（ガチャッと切断）
    const timer2 = setTimeout(() => {
      endPhoneCall(false);
    }, 6500);
    phoneCallTimers.push(timer2);
  }, 3000);
  phoneCallTimers.push(phoneCallAudioTimer);
}

function speakGuidanceAudio(text) {
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ja-JP';
      utterance.rate = 0.95;
      utterance.pitch = 1.1;
      window.speechSynthesis.speak(utterance);
    } catch (e) {}
  }
}

function endPhoneCall(isSilent = false) {
  clearAllPhoneTimers();
  
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
  }

  // AudioContextがsuspendedになっていれば即座に復帰
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const overlay = document.getElementById('phone-calling-overlay');
  if (overlay) overlay.style.display = 'none';
  resetPhoneInputFull();

  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }

  // 切断ボタンまたはガイダンス終了時のみ、リアルな「ガチャッ」音を再生
  if (!isSilent) {
    playSystemSound("hangup");
  }
}

// 端末完全再読み込み（リロード）
function reloadIpadPage() {
  setTimeout(() => {
    location.reload();
  }, 100);
}

// ==========================================================================
// ⑧ 設定アプリ
// ==========================================================================
function switchSettingsTab(tabId) {
  document.querySelectorAll('.settings-menu-item').forEach(btn => btn.classList.remove('active'));
  const btn = document.getElementById(`settings-tab-btn-${tabId}`);
  if (btn) btn.classList.add('active');

  document.querySelectorAll('.settings-content-view').forEach(view => {
    view.style.display = 'none';
  });

  const targetView = document.getElementById(`settings-view-${tabId}`);
  if (targetView) {
    targetView.style.display = 'block';
  }

  playSystemSound("touch");
  safeCreateIcons(targetView);
  logWriteToGAS("SETTINGS_TAB", `設定タブ切り替え: ${tabId}`);
}

function triggerSettingsRestriction(itemName) {
  playSystemSound("error");
  showIpadModal("管理制御（MDM）", `「${itemName}」の設定は大学側（学内MDM管理システム）によって制御されているため、変更できません。`);
}

// ==========================================================================
// 音響効果 ＆ ログ送信ユーティリティ（Safari完全対応 Web Audio シンセサイザー）
// ==========================================================================
let globalAudioCtx = null;
const wavCache = {};

function getAudioContext() {
  if (!globalAudioCtx || globalAudioCtx.state === 'closed') {
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

// ユーザーの画面タッチ時に iPad / Safari の AudioContext ロックを一発解除
function unlockSafariAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  try {
    if (ctx) {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    }
  } catch (e) {}

  // HTML5 Audio 側も確実にアンロック
  try {
    const dummy = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
    dummy.volume = 0.01;
    dummy.play().then(() => {
      dummy.pause();
    }).catch(() => {});
  } catch (e) {}
}

// 画面タッチ・クリック・キー入力で自動アンロックを登録
['touchstart', 'touchend', 'click', 'pointerdown', 'keydown'].forEach(evt => {
  window.addEventListener(evt, unlockSafariAudio, { passive: true });
});

// WAV PCM Data-URI 生成エンジン（iPadOS / Safari完全互換）
function generateWavDataUri(type) {
  if (wavCache[type]) return wavCache[type];

  const sampleRate = 22050;
  let duration = 0.20;
  let samples = [];

  if (type === "notif" || type === "success") {
    duration = 0.35;
    const totalSamples = Math.floor(sampleRate * duration);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let freq = t < 0.12 ? 587.33 : 880.00;
      let env = Math.exp(-t * 6);
      samples.push(Math.sin(2 * Math.PI * freq * t) * env * 0.75);
    }
  } else if (type === "alarm" || type === "error") {
    duration = 0.55;
    const totalSamples = Math.floor(sampleRate * duration);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let freq = type === "alarm" ? (440 + Math.sin(2 * Math.PI * 4 * t) * 220) : 180;
      let env = type === "error" ? Math.exp(-t * 5) : 0.85;
      samples.push((Math.sin(2 * Math.PI * freq * t) > 0 ? 0.75 : -0.75) * env);
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
      samples.push(Math.sin(2 * Math.PI * freq * t) * env * 0.85);
    }
  } else if (type === "distortion") {
    duration = 1.0;
    const totalSamples = Math.floor(sampleRate * duration);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let freq = 120 + (t < 0.5 ? t * 1200 : (1.0 - t) * 1200);
      samples.push((Math.sin(2 * Math.PI * freq * t) + Math.sin(4 * Math.PI * freq * t) * 0.4) * 0.75);
    }
  } else if (type === "ringback") {
    duration = 1.0;
    const totalSamples = Math.floor(sampleRate * duration);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const carrier = Math.sin(2 * Math.PI * 400 * t);
      const modulation = 0.5 + 0.5 * Math.sin(2 * Math.PI * 16 * t);
      let env = 1.0;
      if (t < 0.02) env = t / 0.02;
      if (t > 0.98) env = (1.0 - t) / 0.02;
      samples.push(carrier * modulation * env * 0.85);
    }
  } else if (type === "hangup") {
    duration = 0.22;
    const totalSamples = Math.floor(sampleRate * duration);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;
      if (t < 0.04) {
        let env1 = Math.exp(-t * 100);
        sample += (Math.sin(2 * Math.PI * 1600 * t) * 0.4 + Math.sin(2 * Math.PI * 480 * t) * 0.6) * env1;
      }
      if (t >= 0.035 && t < 0.20) {
        let t2 = t - 0.035;
        let env2 = Math.exp(-t2 * 40);
        sample += (Math.sin(2 * Math.PI * 720 * t2) * 0.5 + Math.sin(2 * Math.PI * 240 * t2) * 0.8) * env2;
      }
      samples.push(sample * 0.85);
    }
  } else if (type === "dtmf" || type === "beep") {
    // ☎️ 電話キーパッドのプッシュ和音 (DTMF: 697Hz + 1209Hz)
    duration = 0.12;
    const totalSamples = Math.floor(sampleRate * duration);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let freq = type === "dtmf" ? 697 : 800;
      let env = Math.exp(-t * 12);
      let s = Math.sin(2 * Math.PI * freq * t);
      if (type === "dtmf") {
        s = 0.5 * s + 0.5 * Math.sin(2 * Math.PI * 1209 * t);
      }
      samples.push(s * env * 0.65);
    }
  } else {
    // 📱 デフォルト: iOS標準風の軽快な上品タップ・クリック音（コッ/カチッ）
    duration = 0.04;
    const totalSamples = Math.floor(sampleRate * duration);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let freq = 480 - (t / duration) * 320; // 480Hz -> 160Hzへ急速スイープ
      let env = Math.exp(-t * 85);
      samples.push(Math.sin(2 * Math.PI * freq * t) * env * 0.45);
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
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
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
  const uri = 'data:audio/wav;base64,' + btoa(binary);
  wavCache[type] = uri;
  return uri;
}

// 🔊 システム効果音再生（iPad / PC 完全両対応ハイブリッドエンジン）
function playSystemSound(type = "touch") {
  let playedWebAudio = false;

  // 1. Web Audio API での再生
  try {
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;

      if (type === "touch") {
        // 📱 iOS標準風の軽快な上品タップ音（480Hz -> 140Hzの超短時間スイープ）
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(480, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.035);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.04);
        playedWebAudio = true;

      } else if (type === "dtmf" || type === "beep") {
        // ☎️ 電話キーパッドのプッシュ和音 (DTMF: 697Hz + 1209Hz)
        const f1 = type === "dtmf" ? 697 : 800;
        const f2 = type === "dtmf" ? 1209 : 800;
        const dur = 0.12;

        [f1, f2].forEach(freq => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now);
          gain.gain.setValueAtTime(0.01, now);
          gain.gain.linearRampToValueAtTime(0.35, now + 0.004);
          gain.gain.setValueAtTime(0.30, now + dur - 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + dur + 0.01);
        });
        playedWebAudio = true;

      } else if (type === "ringback") {
        const dur = 1.0;
        const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          const t = i / ctx.sampleRate;
          const carrier = Math.sin(2 * Math.PI * 400 * t);
          const mod = 0.5 + 0.5 * Math.sin(2 * Math.PI * 16 * t);
          let env = 1.0;
          if (t < 0.02) env = t / 0.02;
          if (t > 0.96) env = (1.0 - t) / 0.04;
          data[i] = carrier * mod * env * 0.75;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(now);
        playedWebAudio = true;

      } else if (type === "success" || type === "notif") {
        const notes = [
          { freq: 587.33, start: 0.00, dur: 0.20, vol: 0.70 },
          { freq: 880.00, start: 0.06, dur: 0.40, vol: 0.80 }
        ];
        notes.forEach(n => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(n.freq, now + n.start);
          const t0 = now + n.start;
          gain.gain.setValueAtTime(0.01, t0);
          gain.gain.linearRampToValueAtTime(n.vol, t0 + 0.006);
          gain.gain.setValueAtTime(n.vol * 0.7, t0 + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + n.dur + 0.02);
        });
        playedWebAudio = true;

      } else if (type === "fanfare") {
        const chordNotes = [
          { freq: 523.25, start: 0.00, dur: 0.30, vol: 0.65 },
          { freq: 659.25, start: 0.09, dur: 0.30, vol: 0.65 },
          { freq: 783.99, start: 0.18, dur: 0.40, vol: 0.75 },
          { freq: 1046.50, start: 0.28, dur: 0.75, vol: 0.85 }
        ];
        chordNotes.forEach(n => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(n.freq, now + n.start);
          const t0 = now + n.start;
          gain.gain.setValueAtTime(0.01, t0);
          gain.gain.linearRampToValueAtTime(n.vol, t0 + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + n.dur + 0.02);
        });
        playedWebAudio = true;

      } else if (type === "hangup") {
        const clicks = [
          { freq: 1200, start: 0.00, dur: 0.035, vol: 0.75 },
          { freq: 280, start: 0.025, dur: 0.16, vol: 0.85 }
        ];
        clicks.forEach(c => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(c.freq, now + c.start);
          const t0 = now + c.start;
          gain.gain.setValueAtTime(0.01, t0);
          gain.gain.linearRampToValueAtTime(c.vol, t0 + 0.003);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + c.dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + c.dur + 0.02);
        });
        playedWebAudio = true;

      } else if (type === "error" || type === "alarm") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type === "alarm" ? "sawtooth" : "square";
        const dur = type === "alarm" ? 0.55 : 0.20;
        osc.frequency.setValueAtTime(type === "alarm" ? 440 : 180, now);
        if (type === "alarm") {
          osc.frequency.exponentialRampToValueAtTime(880, now + dur * 0.7);
        }
        gain.gain.setValueAtTime(0.01, now);
        gain.gain.linearRampToValueAtTime(0.65, now + 0.008);
        gain.gain.setValueAtTime(0.50, now + dur * 0.5);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + dur + 0.02);
        playedWebAudio = true;
      }
    }
  } catch (e) {}

  // 2. iPadOS で Web Audio が無効化・ミュートされている場合の HTML5 Audio 連動再生
  if (!playedWebAudio || (globalAudioCtx && globalAudioCtx.state === 'suspended')) {
    try {
      const uri = generateWavDataUri(type);
      const snd = new Audio(uri);
      snd.volume = 0.9;
      snd.play().catch(() => {});
    } catch (e) {}
  }
}

// GASへの非同期通信ログ送信（完全非ブロッキング ＆ 通信中インジケータ連動）
function logWriteToGAS(logType, message) {
  console.log(`[LOG - ${logType}] ${message}`);

  try {
    localStorage.setItem('mon_last_update', Date.now());
    localStorage.setItem('mon_log_latest', `[${logType}] ${message}`);
  } catch(e) {}
  
  const gasUrl = localStorage.getItem('gas_url') || (window.GAME_DATABASE && window.GAME_DATABASE.system && window.GAME_DATABASE.system.gasUrl);
  if (!gasUrl) return;

  // フォーム送信や重要イベント時は通信中インジケータを表示
  if (logType.includes('SUBMIT') || logType.includes('COLLECTED') || logType.includes('LOOP')) {
    showNetworkLoadingIndicator("通信中…");
  }

  const payload = {
    action: "write_log",
    teamId: gameState.teamId,
    loopNum: gameState.loop,
    logType: logType,
    message: message
  };

  const statusPayload = {
    action: "update_status",
    teamId: gameState.teamId,
    loopNum: gameState.loop,
    statusData: {
      hints: gameState.unlockedHints,
      manabaUser: gameState.manabaUser
    }
  };

  // メインスレッドを妨げないよう非同期キューで送信
  setTimeout(() => {
    fetch(gasUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(() => {
      setTimeout(hideNetworkLoadingIndicator, 400);
    }).catch(err => {
      console.warn("GAS log sending failed: ", err);
      hideNetworkLoadingIndicator();
    });

    fetch(gasUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(statusPayload)
    }).catch(err => console.warn("GAS status update failed: ", err));
  }, 0);
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
  }
});

// ==========================================================================
// 📱 iPadOSネイティブ風：左端エッジスワイプで前の画面に戻るジェスチャー
// ==========================================================================
function setupGlobalSwipeBackGestures() {
  let touchStartX = 0;
  let touchStartY = 0;
  let isEdgeSwipe = false;

  window.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    // 画面左端（70px以内）からのタッチのみエッジスワイプ判定
    isEdgeSwipe = (touchStartX <= 70);
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    if (!isEdgeSwipe || e.changedTouches.length !== 1) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;

    // 右向きに65px以上スワイプ、かつ水平方向が主
    if (deltaX > 65 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
      handleGlobalSwipeBack();
    }
    isEdgeSwipe = false;
  }, { passive: true });
}

function handleGlobalSwipeBack() {
  // 1. 🎓 LMS「manaba」内の戻る処理
  const manabaApp = document.getElementById('app-manaba-app');
  if (manabaApp && manabaApp.style.display !== 'none') {
    // A. ページビュー（資料詳細/目次）が開いている ➔ コース詳細へ戻る
    const pageView = document.getElementById('manaba-page-detail-view');
    if (pageView && pageView.style.display !== 'none') {
      if (typeof closeManabaPageView === 'function') closeManabaPageView();
      playSystemSound("touch");
      return;
    }

    // B. 資料PDFビューが開いている ➔ コース詳細へ戻る
    const materialView = document.getElementById('manaba-material-detail-view');
    if (materialView && materialView.style.display !== 'none') {
      if (typeof closeManabaMaterialView === 'function') closeManabaMaterialView();
      playSystemSound("touch");
      return;
    }

    // C. コースニュース詳細モーダルが開いている ➔ 閉じる
    const newsModal = document.getElementById('manaba-news-modal');
    if (newsModal && newsModal.style.display !== 'none') {
      newsModal.style.display = 'none';
      playSystemSound("touch");
      return;
    }

    // D. コース詳細画面が開いている ➔ マイページ（時間割）へ戻る
    const courseDetail = document.getElementById('manaba-course-detail-view');
    if (courseDetail && courseDetail.style.display !== 'none') {
      switchManabaTab('mypage');
      playSystemSound("touch");
      return;
    }

    // E. ポートフォリオが開いている ➔ マイページへ戻る
    const portfolioView = document.getElementById('manaba-portfolio-view');
    if (portfolioView && portfolioView.style.display !== 'none') {
      switchManabaTab('mypage');
      playSystemSound("touch");
      return;
    }
  }

  // 2. 🌐 Safari（ブラウザ）内の戻る処理
  const safariApp = document.getElementById('app-safari-app');
  if (safariApp && safariApp.style.display !== 'none') {
    const articleView = document.getElementById('safari-article-view');
    if (articleView && articleView.style.display !== 'none') {
      if (typeof closeSafariArticle === 'function') closeSafariArticle();
      playSystemSound("touch");
      return;
    }
  }

  // 3. 🖼️ 写真アプリ内の戻る処理
  const photoModal = document.getElementById('photo-modal');
  if (photoModal && photoModal.style.display !== 'none') {
    if (typeof closePhotoModal === 'function') closePhotoModal();
    playSystemSound("touch");
    return;
  }

  // 4. システムモーダルが開いていたら閉じる
  const activeModal = document.querySelector('.ipad-system-modal[style*="display: flex"], .modal-overlay[style*="display: flex"]');
  if (activeModal) {
    activeModal.style.display = 'none';
    playSystemSound("touch");
    return;
  }
}

// 起動時にエッジスワイプジェスチャーを自動登録
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupGlobalSwipeBackGestures);
} else {
  setupGlobalSwipeBackGestures();
}

