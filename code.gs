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
      var currentGlobalLoop = getGlobalLoop(ss);
      var flowState = getSceneFlowState(ss);
      var effectiveLoop = (currentGlobalLoop >= 1 && currentGlobalLoop <= 3) ? currentGlobalLoop : flowState.loop;

      return renderJson({
        success: true,
        flowStep: flowState.step,                // ⭐ 現在のシーンステップ（1〜8）
        globalLoop: effectiveLoop,               // ⭐ 現在の全体周回（1, 2, 3）
        loop: effectiveLoop,                     // 互換用
        timerRunning: flowState.timerRunning,    // ⭐ タイマーが進行中か（false=09:04静止待機）
        startTime: flowState.startTime,          // ⭐ 計時開始ミリ秒タイムスタンプ
        blackout: flowState.blackout,            // ⭐ 完全暗転（ステップ7）
        devices: readAllDevicesStatus(ss),
        latestCommand: getLatestAdminCommand(ss),
        resetPending: getResetPendingFlag(ss),   // ⭐ リセット待機フラグ
        timestamp: Date.now()
      });
    }

    // 3. iPad端末からの進捗ステータス定期送信 (GET / CORS完全回避)
    if (action === "update_status" && e.parameter.teamId) {
      var p = e.parameter;
      var hintsCount = Number(p.hints || 0);
      var manaba = p.manaba ? decodeURIComponent(p.manaba) : "未ログイン";
      var loopNum = Number(p.loop || 1);
      var teamName = p.teamName !== undefined ? decodeURIComponent(p.teamName) : "";
      var registeredVal = p.registered !== undefined ? Number(p.registered) : 0;
      
      updateTeamStatus(ss, p.teamId, loopNum, {
        teamName: teamName,
        hintsCount: hintsCount,
        manabaUser: manaba,
        registered: registeredVal
      });

      return renderJson({ success: true, message: "ステータスを更新しました (GET)" });
    }

    // 3b. 管理番号・代名詞（チーム名）の直接上書き更新 (GET / 確実上書き)
    if (action === "update_device_name") {
      var oldDevId = e.parameter.oldTeamId || e.parameter.teamId || "iPad-01";
      var newDevId = e.parameter.newTeamId || e.parameter.teamId || oldDevId;
      var newTeamName = e.parameter.teamName !== undefined ? decodeURIComponent(e.parameter.teamName) : "";
      var isRegistered = (e.parameter.registered === "1" || e.parameter.registered === 1);
      
      updateDeviceNameDirect(ss, oldDevId, newDevId, newTeamName, isRegistered);
      return renderJson({ success: true, message: "B列のチーム名・管理番号を上書きしました！" });
    }

    // 4. GM運営コマンドの送信 (GET)
    if (action === "send_command" && e.parameter.cmd) {
      var cmdObj = JSON.parse(decodeURIComponent(e.parameter.cmd));
      if (cmdObj) {
        if (cmdObj.type === "scene_flow_step" && cmdObj.params) {
          var sNum = Number(cmdObj.params.step || 1);
          var lNum = Number(cmdObj.params.loop || 1);
          var isRun = (cmdObj.params.actionType === "start" || sNum === 2 || sNum === 4 || sNum === 6);
          var sTime = cmdObj.params.startTime || Date.now();
          var isBlk = (sNum === 7 || cmdObj.params.actionType === "blackout");
          setSceneFlowState(ss, sNum, lNum, isRun, sTime, isBlk);
        } else if (cmdObj.type === "loop_change" || (cmdObj.params && cmdObj.params.loop)) {
          var targetL = Number(cmdObj.loop || (cmdObj.params && cmdObj.params.loop));
          if (!isNaN(targetL)) setGlobalLoop(ss, targetL);
        } else if (cmdObj.type === "master_reset") {
          setSceneFlowState(ss, 1, 1, false, null, false);
        }
      }
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
      setResetPendingFlag(ss, false); // ゲーム再開 = リセット完了とみなしてフラグ解除
      setGlobalLoop(ss, newLoop);     // ⭐ 現在の全体周回を「システム設定」に永続保存
      
      // 周回に連動して進行ステップも更新 (1周目=>2, 2周目=>4, 3周目=>6)
      var mappedStep = (newLoop === 1) ? 2 : (newLoop === 2) ? 4 : 6;
      setSceneFlowState(ss, mappedStep, newLoop, true, Date.now());

      var loopCmd = recordAdminCommand(ss, {
        type: "loop_change",
        name: "周回変更 (Loop " + newLoop + ")",
        params: { loop: newLoop, timestamp: Date.now() }
      });
      return renderJson({ success: true, message: "周回変更コマンドを発行しました！", loop: newLoop, globalLoop: newLoop, flowStep: mappedStep, commandId: loopCmd.id });
    }

    // 7b. reset_pending フラグを手動解除（管理画面から呼べる緊急解除用）
    if (action === "clear_reset_flag") {
      setResetPendingFlag(ss, false);
      return renderJson({ success: true, message: "リセット待機フラグを解除しました" });
    }

    // 7c. 🎬 シーン進行統制（8ステップ）の直接更新 (GET)
    if (action === "update_flow_step" && e.parameter.step) {
      var fStep = Number(e.parameter.step);
      var fLoop = Number(e.parameter.loop || 1);
      var fTimerRun = (e.parameter.timerRunning === "true" || e.parameter.timerRunning === true || fStep === 2 || fStep === 4 || fStep === 6);
      if (fStep === 1 || fStep === 3 || fStep === 5 || fStep === 7 || fStep === 8) fTimerRun = false;
      var fStartT = e.parameter.startTime ? Number(e.parameter.startTime) : Date.now();
      var fBlackout = (fStep === 7 || e.parameter.blackout === "true");

      setResetPendingFlag(ss, false);
      setGlobalLoop(ss, fLoop); // ⭐ 全体周回も同時に確実に永続保存
      setSceneFlowState(ss, fStep, fLoop, fTimerRun, fStartT, fBlackout);
      return renderJson({
        success: true,
        message: "シーン進行ステップを更新しました！",
        flowStep: fStep,
        globalLoop: fLoop,
        timerRunning: fTimerRun,
        startTime: fStartT,
        blackout: fBlackout
      });
    }

    // 7d. 👑 管理画面（Master）からの周回・タイマー・ステップ強制同期 (GET)
    if (action === "sync_admin") {
      if (e.parameter.loop) {
        var aLoop = Number(e.parameter.loop);
        if (!isNaN(aLoop) && aLoop >= 1 && aLoop <= 3) {
          setGlobalLoop(ss, aLoop);
        }
      }
      if (e.parameter.step) {
        var aStep = Number(e.parameter.step);
        var aLoopNum = e.parameter.loop ? Number(e.parameter.loop) : getGlobalLoop(ss);
        var aTimerRun = (e.parameter.timerRunning === "true" || e.parameter.timerRunning === true);
        var aStartT = e.parameter.startTime ? Number(e.parameter.startTime) : null;
        setSceneFlowState(ss, aStep, aLoopNum, aTimerRun, aStartT, e.parameter.blackout === "true");
      }
      var syncedLoop = getGlobalLoop(ss);
      return renderJson({ success: true, message: "管理画面の最新周回と同期しました！", globalLoop: syncedLoop });
    }

    // 8. マスターリセット（全iPad・モニタリング初期化）
    if (action === "master_reset") {
      resetAllMonitoringData(ss);
      setResetPendingFlag(ss, true);  // ⭐ リセット待機フラグを立てる（スリープ中の端末も次回起動時に必ずリセット）
      setGlobalLoop(ss, 1);           // ⭐ 全体周回を1周目に初期化
      setSceneFlowState(ss, 1, 1, false, null, false); // ⭐ ステップ1（オープニング待機・09:04固定・タイマー停止）に完全初期化
      var resetCmd = recordAdminCommand(ss, {
        type: "master_reset",
        name: "マスターリセット（1周目初期化）",
        params: { loop: 1, resetActors: true, timestamp: Date.now() }
      });
      return renderJson({ success: true, message: "全３０台のマスターリセットを実行しました！", commandId: resetCmd.id });
    }

    // 9. プレイログ書き込み (GET)
    if (action === "write_log") {
      writeLog(ss, e.parameter.teamId || "iPad-01", Number(e.parameter.loop || 1), e.parameter.type || "INFO", decodeURIComponent(e.parameter.message || ""));
      return renderJson({ success: true, message: "ログを記録しました" });
    }

    // 9b. iPadリセット完了通知 — reset_pending フラグを解除
    if (action === "reset_complete") {
      setResetPendingFlag(ss, false);
      return renderJson({ success: true, message: "リセット完了を受信しました" });
    }

    // 10. iPad接続リセット（接続登録解除 & スプレッドシート行削除）
    if (action === "device_reset") {
      var target = e.parameter.target || "ALL";
      // スプレッドシートから対象行を削除
      if (target === "ALL") {
        resetAllMonitoringData(ss);
      } else {
        removeDeviceRow(ss, target);
      }
      // iPad側へ device_reset コマンドを配信
      var resetCmd = recordAdminCommand(ss, {
        type: "device_reset",
        name: "iPad接続リセット (対象: " + target + ")",
        target: target,
        params: { action: "device_reset", target: target, timestamp: Date.now() }
      });
      return renderJson({ success: true, message: "接続リセットを実行しました (対象: " + target + ")", commandId: resetCmd.id });
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
      var cmd = postData.command;
      if (cmd) {
        if (cmd.type === "scene_flow_step" && cmd.params) {
          var sNum = Number(cmd.params.step || 1);
          var lNum = Number(cmd.params.loop || 1);
          var isRun = (cmd.params.actionType === "start" || sNum === 2 || sNum === 4 || sNum === 6);
          var sTime = cmd.params.startTime || Date.now();
          var isBlk = (sNum === 7 || cmd.params.actionType === "blackout");
          setSceneFlowState(ss, sNum, lNum, isRun, sTime, isBlk);
        } else if (cmd.type === "loop_change" || (cmd.params && cmd.params.loop)) {
          var tLoop = Number(cmd.loop || (cmd.params && cmd.params.loop));
          if (!isNaN(tLoop)) setGlobalLoop(ss, tLoop);
        } else if (cmd.type === "master_reset") {
          setSceneFlowState(ss, 1, 1, false, null, false);
        }
      }
      var res = recordAdminCommand(ss, cmd);
      return renderJson({ success: true, message: "運営コマンドを全iPadへ配信しました！", commandId: res.id });
    }

    if (action === "update_status") {
      var statusData = postData.statusData || {};
      if (statusData.registered === undefined) {
        statusData.registered = 0;
      }
      updateTeamStatus(ss, postData.teamId, postData.loopNum, statusData);
      return renderJson({ success: true, message: "進捗ステータスを更新しました。" });
    }

    if (action === "master_reset") {
      resetAllMonitoringData(ss);
      setResetPendingFlag(ss, true);
      setSceneFlowState(ss, 1, 1, false, null, false);
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
  sMon.appendRow(["端末ID (TeamID)", "チーム名", "現在周回 (Loop)", "ヒント解放数", "manabaログイン状況", "バッテリー残量", "通信状態", "最終通信日時", "設定状況"]);
  sMon.getRange(1, 1, 1, 9).setBackground("#0284c7").setFontColor("#ffffff").setFontWeight("bold");

  for (var t = 1; t <= 30; t++) {
    var teamId = "iPad-" + (t < 10 ? "0" + t : t);
    sMon.appendRow([teamId, "", 1, 0, "未ログイン", "100%", "待機中", "", "未設定"]);
  }
  sMon.setFrozenRows(1);
  sMon.autoResizeColumns(1, 9);

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

  var data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  var result = [];

  // 24時間以内に接続実績がある端末のみを返す（スプレッドシートのダミー行・古い行を除外）
  var cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24時間前

  for (var i = 0; i < data.length; i++) {
    var teamId = data[i][0];
    var lastSeenStr = data[i][7];

    // teamIdが空の行はスキップ
    if (!teamId || String(teamId).trim() === '') continue;

    // lastSeenが設定されていない行はスキップ（一度も接続していない）
    if (!lastSeenStr || String(lastSeenStr).trim() === '') continue;

    // lastSeenをパースして24時間以内かチェック
    var lastSeenDate = new Date(lastSeenStr);
    if (isNaN(lastSeenDate.getTime())) continue; // 日時として解釈できない行はスキップ
    if (lastSeenDate < cutoff) continue; // 24時間以上前の端末はスキップ

    var registeredVal = data[i][8] === "設定済み";

    result.push({
      teamId: teamId,
      teamName: data[i][1],
      loop: data[i][2],
      hintsCount: data[i][3],
      manabaUser: data[i][4],
      battery: data[i][5],
      status: data[i][6],
      lastSeen: data[i][7],
      registered: registeredVal
    });
  }

  return result;
}

// 6. チームの進捗状況を更新（重複行自動マージ付き高速更新）
function updateTeamStatus(ss, teamId, loopNum, statusData) {
  if (!teamId || String(teamId).trim() === '') return; // 空のteamIdは無視
  var normalizedId = String(teamId).trim();
  var sheet = ss.getSheetByName("10_30台進行状況モニタリング");
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  var matchedRows = []; // 同一IDの行をすべて収集

  if (lastRow > 1) {
    var teamIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < teamIds.length; i++) {
      if (String(teamIds[i][0]).trim() === normalizedId) {
        matchedRows.push(i + 2); // 1-indexed 行番号
      }
    }
  }

  var nowStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
  var hintsCount = (statusData && statusData.hintsCount !== undefined) ? statusData.hintsCount : 0;
  var manaba = (statusData && statusData.manabaUser) ? statusData.manabaUser : "未ログイン";
  var battery = (statusData && statusData.battery) ? statusData.battery : "100%";
  var teamName = (statusData && statusData.teamName !== undefined) ? statusData.teamName : "";
  var registeredStr = (statusData && (statusData.registered === 1 || statusData.registered === true || (teamName && teamName !== "未設定"))) ? "設定済み" : "未設定";

  if (matchedRows.length === 0) {
    // 該当行なし → 新規追加
    sheet.appendRow([
      normalizedId,
      teamName || "",
      Number(loopNum || 1),
      hintsCount,
      manaba,
      battery,
      "接続中",
      nowStr,
      registeredStr
    ]);
  } else {
    // 最初の行を更新
    var targetRow = matchedRows[0];
    if (statusData && statusData.teamName !== undefined) {
      sheet.getRange(targetRow, 2).setValue(teamName);
    }
    sheet.getRange(targetRow, 3, 1, 7).setValues([[
      Number(loopNum || 1),
      hintsCount,
      manaba,
      battery,
      "接続中",
      nowStr,
      registeredStr
    ]]);

    // 🔀 重複行（2行目以降）を下から削除してマージ
    if (matchedRows.length > 1) {
      for (var j = matchedRows.length - 1; j >= 1; j--) {
        sheet.deleteRow(matchedRows[j]);
      }
    }
  }
}

// 6b. 管理番号・代名詞（チーム名）の直接ピンポイント上書き更新
// registered: true の場合はI列（設定状況）を「設定済み」に強制設定
function updateDeviceNameDirect(ss, oldTeamId, newTeamId, newTeamName, registered) {
  var sheet = ss.getSheetByName("10_30台進行状況モニタリング");
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  var targetRow = -1;

  if (lastRow > 1) {
    var teamIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < teamIds.length; i++) {
      var rowId = teamIds[i][0];
      if (rowId === oldTeamId || rowId === newTeamId) {
        targetRow = i + 2;
        break;
      }
    }
  }

  var nowStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
  // registered=true なら無条件で「設定済み」。そうでない場合はチーム名が入っていれば「設定済み」
  var registeredStr = (registered === true || registered === 1) ? "設定済み" : ((newTeamName && newTeamName !== "未設定") ? "設定済み" : "未設定");

  if (targetRow !== -1) {
    // A列（端末ID）とB列（チーム名・代名詞）、H列（最終通信）、I列（設定状況）を直接上書き！
    sheet.getRange(targetRow, 1).setValue(newTeamId);
    sheet.getRange(targetRow, 2).setValue(newTeamName);
    sheet.getRange(targetRow, 8).setValue(nowStr);
    sheet.getRange(targetRow, 9).setValue(registeredStr);
  } else {
    // 行が存在しない場合は新規追加
    sheet.appendRow([
      newTeamId,
      newTeamName,
      1,
      0,
      "未ログイン",
      "100%",
      "接続中",
      nowStr,
      registeredStr
    ]);
  }
}

// 7. モニタリングデータの初期化（マスターリセット用）
// 行削除ではなく、全端末の進行データを「1周目・未設定」状態へ一括リセットする
function resetAllMonitoringData(ss) {
  var sheet = ss.getSheetByName("10_30台進行状況モニタリング");
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return; // ヘッダーのみなら何もしない

  var numRows = lastRow - 1;

  // C列（現在周回）= 1, D列（ヒント解放数）= 0, E列（manabaログイン状況）= "未ログイン",
  // G列（通信状態）= "待機中", H列（最終通信日時）= "", I列（設定状況）= "未設定"
  // B列（チーム名・代名詞）= "" (名前も完全消去)
  var resetValues = [];
  var teamIds = sheet.getRange(2, 1, numRows, 1).getValues();
  for (var i = 0; i < numRows; i++) {
    resetValues.push([
      teamIds[i][0], // A列: 端末ID は保持（iPad-01〜iPad-30 のリストを維持）
      "",            // B列: チーム名・代名詞 → 完全消去
      1,             // C列: 現在周回 → 1周目へリセット
      0,             // D列: ヒント解放数 → 0
      "未ログイン",   // E列: manabaログイン状況 → 未ログイン
      "100%",        // F列: バッテリー残量 → 100%（デフォルト）
      "待機中",      // G列: 通信状態 → 待機中
      "",            // H列: 最終通信日時 → クリア
      "未設定"       // I列: 設定状況 → 未設定
    ]);
  }
  sheet.getRange(2, 1, numRows, 9).setValues(resetValues);
}

// 7b. 特定端末の行を削除（個別リセット用）
function removeDeviceRow(ss, teamId) {
  var sheet = ss.getSheetByName("10_30台進行状況モニタリング");
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var teamIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  // 下から削除することで行ずれを防ぐ
  for (var i = teamIds.length - 1; i >= 0; i--) {
    if (String(teamIds[i][0]).trim() === String(teamId).trim()) {
      sheet.deleteRow(i + 2);
    }
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

// ================================================================
// 🔴 リセット待機フラグ管理（スリープ中にリセットした端末への底流し機構）
// コマンドは30秒で失効するが、このフラグはリセット完了まで永続する
// ================================================================

var RESET_FLAG_SHEET = "システム設定";
var RESET_FLAG_KEY   = "reset_pending";

/**
 * reset_pending フラグを読み取る
 * @return {boolean} true = 全端末にリセット待機中
 */
function getResetPendingFlag(ss) {
  var sheet = ss.getSheetByName(RESET_FLAG_SHEET);
  if (!sheet) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return false;
  var data = sheet.getRange(1, 1, lastRow, 2).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === RESET_FLAG_KEY) {
      return String(data[i][1]).trim() === "true";
    }
  }
  return false;
}

/**
 * reset_pending フラグを設定 / 解除
 * @param {boolean} value true=リセット待機中 / false=完了
 */
function setResetPendingFlag(ss, value) {
  // 「システム設定」シートがなければ自動作成
  var sheet = ss.getSheetByName(RESET_FLAG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(RESET_FLAG_SHEET);
    sheet.getRange(1, 1).setValue(RESET_FLAG_KEY);
    sheet.getRange(1, 2).setValue(value ? "true" : "false");
    return;
  }
  var lastRow = sheet.getLastRow();
  var data = lastRow > 0 ? sheet.getRange(1, 1, lastRow, 2).getValues() : [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === RESET_FLAG_KEY) {
      sheet.getRange(i + 1, 2).setValue(value ? "true" : "false");
      return;
    }
  }
  // キーがなければ新規追加
  sheet.appendRow([RESET_FLAG_KEY, value ? "true" : "false"]);
}

// ================================================================
// 🌀 全体周回（グローバル周回: 1, 2, 3）管理
// iPadアクセス時・リロード時に現在の全体周回に即座に同期されるための永続化
// ================================================================

var GLOBAL_LOOP_KEY = "global_loop";

/**
 * 現在の全体周回（グローバル周回: 1, 2, 3）を取得
 * @return {number} 1, 2, または 3
 */
function getGlobalLoop(ss) {
  var sheet = ss.getSheetByName(RESET_FLAG_SHEET);
  if (sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 1) {
      var data = sheet.getRange(1, 1, lastRow, 2).getValues();
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === GLOBAL_LOOP_KEY) {
          var val = parseInt(data[i][1], 10);
          if (!isNaN(val) && val >= 1 && val <= 3) return val;
        }
      }
    }
  }

  return 1; // デフォルト1周目
}

/**
 * 現在の全体周回（グローバル周回）を設定・保存
 * @param {number} loopNum 1, 2, 3
 */
function setGlobalLoop(ss, loopNum) {
  var val = parseInt(loopNum || 1, 10);
  if (isNaN(val) || val < 1 || val > 3) val = 1;

  var sheet = ss.getSheetByName(RESET_FLAG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(RESET_FLAG_SHEET);
    sheet.getRange(1, 1).setValue(GLOBAL_LOOP_KEY);
    sheet.getRange(1, 2).setValue(String(val));
    return;
  }
  var lastRow = sheet.getLastRow();
  var data = lastRow > 0 ? sheet.getRange(1, 1, lastRow, 2).getValues() : [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === GLOBAL_LOOP_KEY) {
      sheet.getRange(i + 1, 2).setValue(String(val));
      return;
    }
  }
  sheet.appendRow([GLOBAL_LOOP_KEY, String(val)]);
}

// ================================================================
// 🎬 進行統制（8ステップ）＆ タイマー状態管理
// 「オープニング待機」「各周回切替（09:04静止）」「タイマー始動」「完全暗転」を完全永続化
// ================================================================

var FLOW_STEP_KEY       = "flow_step";
var TIMER_RUNNING_KEY   = "timer_running";
var STEP_START_TIME_KEY = "step_start_time";
var BLACKOUT_KEY        = "blackout";

/**
 * 8ステップ進行統制の現在状態を取得
 * @return {Object} { step: 1..8, loop: 1..3, timerRunning: bool, startTime: number, blackout: bool }
 */
function getSceneFlowState(ss) {
  var state = {
    step: 1,
    loop: 1,
    timerRunning: false,
    startTime: null,
    blackout: false
  };

  var sheet = ss.getSheetByName(RESET_FLAG_SHEET);
  if (!sheet) return state;

  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return state;

  var data = sheet.getRange(1, 1, lastRow, 2).getValues();
  for (var i = 0; i < data.length; i++) {
    var k = String(data[i][0]).trim();
    var v = String(data[i][1]).trim();
    if (k === FLOW_STEP_KEY) {
      var s = parseInt(v, 10);
      if (!isNaN(s) && s >= 1 && s <= 8) state.step = s;
    } else if (k === GLOBAL_LOOP_KEY) {
      var l = parseInt(v, 10);
      if (!isNaN(l) && l >= 1 && l <= 3) state.loop = l;
    } else if (k === TIMER_RUNNING_KEY) {
      state.timerRunning = (v === "true");
    } else if (k === STEP_START_TIME_KEY) {
      var t = parseInt(v, 10);
      if (!isNaN(t) && t > 0) state.startTime = t;
    } else if (k === BLACKOUT_KEY) {
      state.blackout = (v === "true");
    }
  }

  // ⭐ ステップ番号からループ・タイマー状態の論理的整合性を厳密補正（安全策）
  // 1: オープニング待機 (loop:1, timer:false, 09:04静止待機)
  // 2: 1周目スタート (loop:1, timer:true)
  // 3: 1周目終了・2周目切替 (loop:2, timer:false, 09:04静止待機)
  // 4: 2周目スタート (loop:2, timer:true)
  // 5: 2周目終了・3周目切替 (loop:3, timer:false, 09:04静止待機)
  // 6: 3周目スタート (loop:3, timer:true)
  // 7: 3周目終了・完全暗転 (loop:3, timer:false, blackout:true)
  // 8: ゲーム終了 (loop:3, timer:false)
  if (state.step === 1) {
    state.loop = 1;
    state.timerRunning = false;
    state.blackout = false;
  } else if (state.step === 2) {
    state.loop = 1;
    state.timerRunning = true;
    state.blackout = false;
  } else if (state.step === 3) {
    state.loop = 2;
    state.timerRunning = false;
    state.blackout = false;
  } else if (state.step === 4) {
    state.loop = 2;
    state.timerRunning = true;
    state.blackout = false;
  } else if (state.step === 5) {
    state.loop = 3;
    state.timerRunning = false;
    state.blackout = false;
  } else if (state.step === 6) {
    state.loop = 3;
    state.timerRunning = true;
    state.blackout = false;
  } else if (state.step === 7) {
    state.loop = 3;
    state.timerRunning = false;
    state.blackout = true;
  } else if (state.step === 8) {
    state.loop = 3;
    state.timerRunning = false;
    state.blackout = false;
  }

  // ⭐ 管理者が意図的に周回を変更している場合（global_loop）、その周回を最優先採用
  var explicitGlobalLoop = getGlobalLoop(ss);
  if (explicitGlobalLoop >= 1 && explicitGlobalLoop <= 3) {
    state.loop = explicitGlobalLoop;
    // 周回とステップ番号が矛盾している場合は、その周回に適合したステップへ自動補正
    if (state.loop === 1 && state.step > 2) {
      state.step = 2;
    } else if (state.loop === 2 && (state.step < 3 || state.step > 4)) {
      state.step = 4;
    } else if (state.loop === 3 && state.step < 5) {
      state.step = 6;
    }
  }

  return state;
}

/**
 * 8ステップ進行統制の状態を設定・保存
 */
function setSceneFlowState(ss, stepNum, loopNum, timerRunning, startTime, blackout) {
  var s = parseInt(stepNum || 1, 10);
  if (isNaN(s) || s < 1 || s > 8) s = 1;
  var l = parseInt(loopNum || 1, 10);
  if (isNaN(l) || l < 1 || l > 3) l = 1;

  var sheet = ss.getSheetByName(RESET_FLAG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(RESET_FLAG_SHEET);
  }

  var updates = {};
  updates[FLOW_STEP_KEY] = String(s);
  updates[GLOBAL_LOOP_KEY] = String(l);
  updates[TIMER_RUNNING_KEY] = timerRunning ? "true" : "false";
  if (startTime) updates[STEP_START_TIME_KEY] = String(startTime);
  if (blackout !== undefined) updates[BLACKOUT_KEY] = blackout ? "true" : "false";

  var lastRow = sheet.getLastRow();
  var data = lastRow > 0 ? sheet.getRange(1, 1, lastRow, 2).getValues() : [];
  var existingKeys = {};
  for (var i = 0; i < data.length; i++) {
    var k = String(data[i][0]).trim();
    if (updates[k] !== undefined) {
      sheet.getRange(i + 1, 2).setValue(updates[k]);
      existingKeys[k] = true;
    }
  }

  for (var uk in updates) {
    if (!existingKeys[uk]) {
      sheet.appendRow([uk, updates[uk]]);
    }
  }
}
