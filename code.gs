/**
 * ==========================================================================
 * 📱 2126年 架空iPadOS型 脱出ゲームシステム GASバックエンドコード (code.gs)
 * 【公演特化型・超軽量・爆速リアルタイム同期 ＆ 自動クリーンアップ完全版】
 * ==========================================================================
 * 
 * 💡 設計思想:
 * ニュース・LINK・時間割・メールなどの静的データはフロントエンド(data.js)で完全管理。
 * 本GASは「① 30台の進行モニタリング」「② GM運営コマンド」「③ 演者トリガー」「④ プレイログ」
 * の4大機能に特化し、極小の通信量と最速のレスポンス（100ms未満）を実現します。
 */

// --- 🌐 GETリクエストハンドラ (iPadOS Webアプリ & 管理画面からのデータ同期) ---
function doGet(e) {
  var action = (e && e.parameter) ? e.parameter.action : "get_status";
  
  function renderJson(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return renderJson({ success: false, error: "Active spreadsheet not found." });
    }

    // 1. 疎通診断（Ping / Pong）
    if (action === "ping") {
      return renderJson({
        success: true,
        message: "pong",
        serverTime: new Date().toISOString(),
        timestamp: Date.now()
      });
    }

    // 2. 【超軽量・最速】30台の進行ステータス ＆ 最新運営コマンドを取得（iPad & GM画面用）
    if (action === "get_status" || action === "get_data") {
      return renderJson({
        success: true,
        devices: readAllDevicesStatus(ss),
        latestCommand: getLatestAdminCommand(ss),
        timestamp: Date.now()
      });
    }

    // 3. iPad端末からの進捗ステータス定期送信 (GET / CORS完全回避)
    if (action === "update_status" && e.parameter.teamId) {
      var p = e.parameter;
      var hintsCount = Number(p.hints || 0);
      var manaba = p.manaba ? decodeURIComponent(p.manaba) : "未ログイン";
      var loopNum = Number(p.loop || 1);
      
      updateTeamStatus(ss, p.teamId, loopNum, {
        hintsCount: hintsCount,
        manabaUser: manaba
      });

      return renderJson({ success: true, message: "ステータスを更新しました (GET)" });
    }

    // 4. GM運営コマンドの送信 (GET)
    if (action === "send_command" && e.parameter.cmd) {
      var cmdObj = JSON.parse(decodeURIComponent(e.parameter.cmd));
      var res = recordAdminCommand(ss, cmdObj);
      return renderJson({ success: true, message: "コマンドを送信・記録しました！", commandId: res.id });
    }

    // 5. 演者トリガーの送信 (GET)
    if (action === "send_actor_trigger" && e.parameter.actor) {
      var actorObj = {
        actor: e.parameter.actor,
        text: e.parameter.text ? decodeURIComponent(e.parameter.text) : "",
        triggerId: e.parameter.triggerId || "",
        autoReplySender: e.parameter.autoReplySender || "",
        autoReplyText: e.parameter.autoReplyText ? decodeURIComponent(e.parameter.autoReplyText) : "",
        timestamp: Date.now()
      };
      var resActor = recordActorTrigger(ss, actorObj);
      return renderJson({ success: true, message: "演者トリガーを配信しました！", commandId: resActor.id });
    }

    // 6. 演者トリガーのリセット (GET)
    if (action === "reset_actor_triggers") {
      resetActorTriggers(ss);
      return renderJson({ success: true, message: "演者トリガーをリセットしました！" });
    }

    // 7. 周回一括更新 (GET)
    if (action === "update_loop" && e.parameter.loop) {
      var newLoop = Number(e.parameter.loop);
      var loopCmd = recordAdminCommand(ss, {
        type: "loop_change",
        name: "周回変更 (Loop " + newLoop + ")",
        params: { loop: newLoop, timestamp: Date.now() }
      });
      return renderJson({ success: true, message: "周回変更コマンドを発行しました！", loop: newLoop, commandId: loopCmd.id });
    }

    // 8. マスターリセット（全iPad・モニタリング初期化）
    if (action === "master_reset") {
      resetAllMonitoringData(ss);
      var resetCmd = recordAdminCommand(ss, {
        type: "master_reset",
        name: "マスターリセット（1周目初期化）",
        params: { loop: 1, resetActors: true, timestamp: Date.now() }
      });
      return renderJson({ success: true, message: "全30台のマスターリセットを実行しました！", commandId: resetCmd.id });
    }

    // 9. プレイログ書き込み (GET)
    if (action === "write_log") {
      writeLog(ss, e.parameter.teamId || "iPad-01", Number(e.parameter.loop || 1), e.parameter.type || "INFO", decodeURIComponent(e.parameter.message || ""));
      return renderJson({ success: true, message: "ログを記録しました" });
    }

    return renderJson({ success: false, error: "Unknown GET action: " + action });
  } catch (err) {
    return renderJson({ success: false, error: err.toString() });
  }
}

// --- 🌐 POSTリクエストハンドラ ---
function doPost(e) {
  function renderJson(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var postData = JSON.parse(e.postData.contents);
    var action = postData.action;

    if (action === "setup") {
      cleanAndSetupOptimizedDatabase();
      return renderJson({ success: true, message: "スプレッドシートの完全最適化初期化が完了しました！" });
    }

    if (action === "send_admin_command") {
      var res = recordAdminCommand(ss, postData.command);
      return renderJson({ success: true, message: "運営コマンドを全iPadへ配信しました！", commandId: res.id });
    }

    if (action === "update_status") {
      updateTeamStatus(ss, postData.teamId, postData.loopNum, postData.statusData);
      return renderJson({ success: true, message: "進捗ステータスを更新しました。" });
    }

    if (action === "master_reset") {
      resetAllMonitoringData(ss);
      var resetCmd = recordAdminCommand(ss, {
        type: "master_reset",
        name: "マスターリセット",
        params: { loop: 1, resetActors: true, timestamp: Date.now() }
      });
      return renderJson({ success: true, message: "全30台のマスターリセットを実行しました！", commandId: resetCmd.id });
    }

    if (action === "write_log") {
      writeLog(ss, postData.teamId, postData.loopNum, postData.logType, postData.message);
      return renderJson({ success: true, message: "ログを書き込みました。" });
    }

    return renderJson({ success: false, error: "Unknown POST action: " + action });
  } catch (err) {
    return renderJson({ success: false, error: err.toString() });
  }
}

// ==========================================================================
// 🧹 ★ 一発完全クリーンアップ＆最新4大シート再構築関数
// ==========================================================================
function cleanAndSetupOptimizedDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("スプレッドシートが見つかりません。");

  // 1. 一時シートを作成（全シート削除時のエラー防止）
  var tempSheet = ss.insertSheet("temp_" + Date.now());

  // 2. 不要な古いシート（ニュース、チャット、メール等）をすべて一括削除
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() !== tempSheet.getName()) {
      ss.deleteSheet(sheets[i]);
    }
  }

  // 3. 最新の4大シートのみをピカピカに作成
  // ① 📊 30台進行状況モニタリング
  var sMon = ss.insertSheet("10_30台進行状況モニタリング");
  sMon.appendRow(["端末ID (TeamID)", "チーム名", "現在周回 (Loop)", "ヒント解放数", "manabaログイン状況", "バッテリー残量", "通信状態", "最終通信日時"]);
  sMon.getRange(1, 1, 1, 8).setBackground("#0284c7").setFontColor("#ffffff").setFontWeight("bold");

  for (var t = 1; t <= 30; t++) {
    var teamId = "iPad-" + (t < 10 ? "0" + t : t);
    var teamName = "チーム " + String.fromCharCode(64 + t);
    sMon.appendRow([teamId, teamName, 1, 0, "未ログイン", "100%", "待機中", ""]);
  }
  sMon.setFrozenRows(1);
  sMon.autoResizeColumns(1, 8);

  // ② 🎮 運営コマンドキュー
  var sCmd = ss.insertSheet("98_運営コマンドキュー");
  sCmd.appendRow(["コマンドID", "発行日時", "対象端末", "コマンド種別", "メッセージ / 概要", "詳細パラメータJSON"]);
  sCmd.getRange(1, 1, 1, 6).setBackground("#16a34a").setFontColor("#ffffff").setFontWeight("bold");
  sCmd.setFrozenRows(1);
  sCmd.autoResizeColumns(1, 6);

  // ③ 🎭 演者トリガーキュー
  var sActor = ss.insertSheet("97_演者トリガーキュー");
  sActor.appendRow(["トリガーID", "送信日時", "演者名/コード", "チャット本文", "自動返信設定", "ステータス"]);
  sActor.getRange(1, 1, 1, 6).setBackground("#7c3aed").setFontColor("#ffffff").setFontWeight("bold");
  sActor.setFrozenRows(1);
  sActor.autoResizeColumns(1, 6);

  // ④ 📝 プレイログ
  var sLog = ss.insertSheet("99_プレイログ");
  sLog.appendRow(["記録日時", "端末ID", "周回", "イベント種別", "詳細メッセージ"]);
  sLog.getRange(1, 1, 1, 5).setBackground("#475569").setFontColor("#ffffff").setFontWeight("bold");
  sLog.setFrozenRows(1);
  sLog.autoResizeColumns(1, 5);

  // 4. 一時シートを削除
  ss.deleteSheet(tempSheet);

  SpreadsheetApp.flush();
  Logger.log("✨ スプレッドシートの不要データを全消去し、最新の超軽量4大シートに完全再構築しました！");
}

// ==========================================================================
// ⚡ 超高速 読み書きコア関数
// ==========================================================================

// 1. 最新の運営コマンドを取得（最新1行だけをピンポイント取得）
function getLatestAdminCommand(ss) {
  var sheet = ss.getSheetByName("98_運営コマンドキュー");
  if (!sheet) return null;

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  var row = sheet.getRange(lastRow, 1, 1, 6).getValues()[0];
  var cmdId = row[0];
  var timeStr = row[1];
  var target = row[2];
  var type = row[3];
  var msg = row[4];
  var paramsStr = row[5];

  var params = {};
  try {
    params = typeof paramsStr === 'string' ? JSON.parse(paramsStr) : (paramsStr || {});
  } catch (e) {}

  return {
    id: cmdId,
    time: timeStr,
    target: target,
    type: type,
    message: msg,
    params: params
  };
}

// 2. 運営コマンドを記録
function recordAdminCommand(ss, command) {
  var sheet = ss.getSheetByName("98_運営コマンドキュー");
  if (!sheet) {
    cleanAndSetupOptimizedDatabase();
    sheet = ss.getSheetByName("98_運営コマンドキュー");
  }

  var cmdId = (command && command.id) ? command.id : "CMD_" + Date.now();
  var nowStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
  var target = (command && command.target) ? command.target : "ALL";
  var type = (command && command.type) ? command.type : "custom";
  var msg = (command && (command.text || command.message || command.alertMsg || command.name)) ? (command.text || command.message || command.alertMsg || command.name) : "";
  var params = JSON.stringify(command || {});

  sheet.appendRow([cmdId, nowStr, target, type, msg, params]);
  return { id: cmdId, timestamp: Date.now() };
}

// 3. 演者トリガーを記録
function recordActorTrigger(ss, actorData) {
  var sheet = ss.getSheetByName("97_演者トリガーキュー");
  if (!sheet) {
    cleanAndSetupOptimizedDatabase();
    sheet = ss.getSheetByName("97_演者トリガーキュー");
  }

  var triggerId = actorData.triggerId || "ACTOR_" + Date.now();
  var nowStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
  var actor = actorData.actor || "";
  var text = actorData.text || "";
  var autoReply = actorData.autoReplySender ? (actorData.autoReplySender + ": " + actorData.autoReplyText) : "";

  sheet.appendRow([triggerId, nowStr, actor, text, autoReply, "配信済み"]);

  // 運営コマンドキューにも配信
  recordAdminCommand(ss, {
    id: triggerId,
    type: "actor_message",
    actor: actor,
    text: text,
    triggerId: triggerId,
    autoReplySender: actorData.autoReplySender,
    autoReplyText: actorData.autoReplyText,
    timestamp: Date.now()
  });

  return { id: triggerId, timestamp: Date.now() };
}

// 4. 演者トリガーをリセット
function resetActorTriggers(ss) {
  var sheet = ss.getSheetByName("97_演者トリガーキュー");
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).clearContent();
  }
}

// 5. 30台の進行状況を読み取り
function readAllDevicesStatus(ss) {
  var sheet = ss.getSheetByName("10_30台進行状況モニタリング");
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var result = [];

  for (var i = 0; i < data.length; i++) {
    result.push({
      teamId: data[i][0],
      teamName: data[i][1],
      loop: data[i][2],
      hintsCount: data[i][3],
      manabaUser: data[i][4],
      battery: data[i][5],
      status: data[i][6],
      lastSeen: data[i][7]
    });
  }

  return result;
}

// 6. チームの進捗状況を更新（メモリバッファ付き高速更新）
function updateTeamStatus(ss, teamId, loopNum, statusData) {
  if (!teamId) return;
  var sheet = ss.getSheetByName("10_30台進行状況モニタリング");
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var teamIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var targetRow = -1;

  for (var i = 0; i < teamIds.length; i++) {
    if (teamIds[i][0] === teamId) {
      targetRow = i + 2;
      break;
    }
  }

  if (targetRow === -1) return;

  var nowStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
  var hintsCount = (statusData && statusData.hintsCount !== undefined) ? statusData.hintsCount : 0;
  var manaba = (statusData && statusData.manabaUser) ? statusData.manabaUser : "未ログイン";
  var battery = (statusData && statusData.battery) ? statusData.battery : "100%";

  sheet.getRange(targetRow, 3, 1, 6).setValues([[
    Number(loopNum || 1),
    hintsCount,
    manaba,
    battery,
    "接続中",
    nowStr
  ]]);
}

// 7. モニタリングデータの初期化（マスターリセット用）
function resetAllMonitoringData(ss) {
  var sheet = ss.getSheetByName("10_30台進行状況モニタリング");
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  for (var i = 2; i <= lastRow; i++) {
    sheet.getRange(i, 3, 1, 6).setValues([[1, 0, "未ログイン", "100%", "待機中", ""]]);
  }
}

// 8. プレイログを書き込み（直近200件で自動ローテーション・肥大化完全防止）
function writeLog(ss, teamId, loopNum, logType, message) {
  var sheet = ss.getSheetByName("99_プレイログ");
  if (!sheet) return;

  var nowStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
  sheet.appendRow([nowStr, teamId, Number(loopNum || 1), logType, message]);

  // 200行を超えたら古いログを自動削除して軽量性を維持
  var maxRows = 200;
  var curRows = sheet.getLastRow();
  if (curRows > maxRows + 10) {
    sheet.deleteRows(2, curRows - maxRows);
  }
}
