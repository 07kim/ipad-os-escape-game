/**
 * 2126年 架空iPadOS型 脱出ゲームシステム GASバックエンドコード (code.gs)
 * 
 * 【使い方】
 * 1. 空のスプレッドシートを作成します。
 * 2. 拡張機能 > Apps Script を開き、このコードをエディタに貼り付けて保存します。
 * 3. 右上の「デプロイ」 > 「新しいデプロイ」をクリックします。
 *    - 種類の選択：ウェブアプリ
 *    - 次のユーザーとして実行：自分 (Your Account)
 *    - アクセスできるユーザー：全員 (Anyone)
 * 4. デプロイを実行し、発行された「ウェブアプリURL」をアプリ側（管理画面など）に設定します。
 * 5. 管理画面から「スプレッドシート初期化」を実行すると、全シートと初期データが自動構築されます。
 */

function doGet(e) {
  var action = e.parameter.action;
  
  // CORS対策用のヘッダーを設定してレスポンスを返す関数
  function renderJson(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 初期状態チェック
    if (!ss) {
      return renderJson({ success: false, error: "Active spreadsheet not found." });
    }

    if (action === "get_data") {
      return renderJson({
        success: true,
        data: readAllDataFromSpreadsheet(ss)
      });
    }

    return renderJson({ success: false, error: "Unknown GET action: " + action });
  } catch (err) {
    return renderJson({ success: false, error: err.toString() });
  }
}

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
      initializeSpreadsheet(ss);
      return renderJson({ success: true, message: "スプレッドシートの初期構築が完了しました！" });
    }

    if (action === "write_log") {
      writeLog(ss, postData.teamId, postData.loopNum, postData.logType, postData.message);
      return renderJson({ success: true, message: "ログを書き込みました。" });
    }

    if (action === "update_status") {
      updateTeamStatus(ss, postData.teamId, postData.loopNum, postData.statusData);
      return renderJson({ success: true, message: "進捗ステータスを更新しました。" });
    }

    if (action === "update_all_data") {
      updateAllDataInSpreadsheet(ss, postData.data);
      return renderJson({ success: true, message: "データをスプレッドシートに同期しました。" });
    }

    return renderJson({ success: false, error: "Unknown POST action: " + action });
  } catch (err) {
    return renderJson({ success: false, error: err.toString() });
  }
}

// --- スプレッドシートの全シートからデータを読み込み、JSON構造に組み立てる ---
function readAllDataFromSpreadsheet(ss) {
  var data = {
    system: {},
    metaApp: { qrHints: {} },
    browser: { news: {}, searchResults: {}, pagesContent: {} },
    linkApp: { contacts: [], chats: {}, addFriendQr: {} },
    manaba: { users: {}, courseDetail: { news: [], materials: [] } },
    mailApp: {}
  };

  // 1. システム設定
  var sheetSystem = ss.getSheetByName("system");
  if (sheetSystem) {
    var rows = sheetSystem.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var key = rows[i][0];
      var val = rows[i][1];
      if (key && val) {
        if (key.indexOf("spec.") === 0) {
          if (!data.system.spec) data.system.spec = {};
          data.system.spec[key.replace("spec.", "")] = val;
        } else {
          data.system[key] = val;
        }
      }
    }
  }

  // 2. メタアプリ基本ルールなど
  var sheetMetaRules = ss.getSheetByName("meta_rules");
  if (sheetMetaRules) {
    var rows = sheetMetaRules.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var key = rows[i][0];
      var val = rows[i][1];
      if (key === "rules") data.metaApp.rules = val;
      if (key === "mapUrl") data.metaApp.mapUrl = val;
      if (key.indexOf("synopsis_") === 0) {
        if (!data.metaApp.synopsis) data.metaApp.synopsis = {};
        var loop = key.replace("synopsis_", "");
        data.metaApp.synopsis[loop] = val;
      }
    }
  }

  // 3. QRヒント (入手情報)
  var sheetQrHints = ss.getSheetByName("meta_hints");
  if (sheetQrHints) {
    var rows = sheetQrHints.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var qrId = rows[i][0];
      if (qrId) {
        data.metaApp.qrHints[qrId] = {
          title: rows[i][1],
          content: rows[i][2],
          image: rows[i][3] || ""
        };
      }
    }
  }

  // 4. ブラウザニュース
  var sheetNews = ss.getSheetByName("browser_news");
  if (sheetNews) {
    var rows = sheetNews.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var loop = rows[i][0];
      var newsItem = {
        id: rows[i][1],
        title: rows[i][2],
        desc: rows[i][3],
        target: rows[i][4]
      };
      if (loop && newsItem.id) {
        if (!data.browser.news[loop]) data.browser.news[loop] = [];
        data.browser.news[loop].push(newsItem);
      }
    }
  }

  // 5. 検索結果＆ページ本文
  var sheetPages = ss.getSheetByName("browser_pages");
  if (sheetPages) {
    var rows = sheetPages.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var key = rows[i][0]; // 検索キーワード、または直接のURLキー
      var type = rows[i][1]; // "search_result" または "page_content"
      if (key) {
        if (type === "search_result") {
          var keyword = key;
          if (!data.browser.searchResults[keyword]) data.browser.searchResults[keyword] = [];
          data.browser.searchResults[keyword].push({
            title: rows[i][2],
            desc: rows[i][3],
            url: rows[i][4],
            minLoop: rows[i][5] ? parseInt(rows[i][5]) : undefined,
            maxLoop: rows[i][6] ? parseInt(rows[i][6]) : undefined
          });
        } else if (type === "page_content") {
          var url = key;
          data.browser.pagesContent[url] = {
            title: rows[i][2],
            content: rows[i][3]
          };
        }
      }
    }
  }

  // 6. LINK連絡先
  var sheetContacts = ss.getSheetByName("link_contacts");
  if (sheetContacts) {
    var rows = sheetContacts.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var id = rows[i][0];
      if (id) {
        var contact = {
          id: id,
          name: rows[i][1],
          icon: rows[i][2],
          role: rows[i][3],
          desc: rows[i][4],
          isGroup: rows[i][5] === "TRUE" || rows[i][5] === true
        };
        var isLoop3 = rows[i][6] === "TRUE" || rows[i][6] === true;
        if (isLoop3) {
          if (!data.linkApp.contactsLoop3) data.linkApp.contactsLoop3 = [];
          data.linkApp.contactsLoop3.push(contact);
        } else {
          data.linkApp.contacts.push(contact);
        }
      }
    }
  }

  // 7. LINKトーク履歴
  var sheetMessages = ss.getSheetByName("link_messages");
  if (sheetMessages) {
    var rows = sheetMessages.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var contactId = rows[i][0];
      if (contactId) {
        if (!data.linkApp.chats[contactId]) data.linkApp.chats[contactId] = [];
        data.linkApp.chats[contactId].push({
          sender: rows[i][1],
          text: rows[i][2],
          time: rows[i][3]
        });
      }
    }
  }

  // 8. LINK友達追加用QR
  var sheetAddFriend = ss.getSheetByName("link_add_friend_qr");
  if (sheetAddFriend) {
    var rows = sheetAddFriend.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var qrCode = rows[i][0];
      if (qrCode) {
        data.linkApp.addFriendQr[qrCode] = {
          id: rows[i][1],
          name: rows[i][2],
          icon: rows[i][3],
          msg: rows[i][4]
        };
      }
    }
  }

  // 9. manaba ユーザー＆時間割
  var sheetManabaUsers = ss.getSheetByName("manaba_users");
  if (sheetManabaUsers) {
    var rows = sheetManabaUsers.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var loginId = rows[i][0];
      if (loginId) {
        data.manaba.users[loginId] = {
          pass: rows[i][1],
          name: rows[i][2],
          role: rows[i][3],
          timetable: {
            "Mon": [rows[i][4], rows[i][5], rows[i][6], rows[i][7], rows[i][8]],
            "Tue": [rows[i][9], rows[i][10], rows[i][11], rows[i][12], rows[i][13]],
            "Wed": [rows[i][14], rows[i][15], rows[i][16], rows[i][17], rows[i][18]],
            "Thu": [rows[i][19], rows[i][20], rows[i][21], rows[i][22], rows[i][23]],
            "Fri": [rows[i][24], rows[i][25], rows[i][26], rows[i][27], rows[i][28]]
          }
        };
      }
    }
  }

  // 10. manaba 授業詳細＆資料
  var sheetManabaCourse = ss.getSheetByName("manaba_materials");
  if (sheetManabaCourse) {
    var rows = sheetManabaCourse.getDataRange().getValues();
    
    // コース基本情報 (A2, B2, C2等に入っていると仮定)
    if (rows.length > 1) {
      data.manaba.courseDetail.name = rows[1][0] || "情報デザイン論及び演習";
      data.manaba.courseDetail.teacher = rows[1][1] || "安藤 昌也";
      data.manaba.courseDetail.term = rows[1][2] || "2026 前期 金曜 5限";
    }
    
    // コースニュース及び授業資料
    for (var i = 1; i < rows.length; i++) {
      var type = rows[i][3]; // "news" または "material"
      if (type === "news") {
        data.manaba.courseDetail.news.push({
          title: rows[i][4],
          date: rows[i][5]
        });
      } else if (type === "material") {
        data.manaba.courseDetail.materials.push({
          id: parseInt(rows[i][6]),
          title: rows[i][7],
          file: rows[i][8],
          content: rows[i][9]
        });
      }
    }
  }

  // 11. メールアプリ
  var sheetMail = ss.getSheetByName("mail_box");
  if (sheetMail) {
    var rows = sheetMail.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var loop = rows[i][0];
      if (loop) {
        if (!data.mailApp[loop]) data.mailApp[loop] = [];
        data.mailApp[loop].push({
          id: rows[i][1],
          sender: rows[i][2],
          title: rows[i][3],
          date: rows[i][4],
          body: rows[i][5]
        });
      }
    }
  }

  return data;
}

// --- ログ書き込み処理 ---
function writeLog(ss, teamId, loopNum, logType, message) {
  var sheet = ss.getSheetByName("logs");
  if (!sheet) {
    sheet = ss.insertSheet("logs");
    sheet.appendRow(["タイムスタンプ", "チームID", "周回数", "ログ種別", "メッセージ"]);
  }
  sheet.appendRow([new Date(), teamId, loopNum, logType, message]);
}

// --- 進捗ステータス保存処理 ---
function updateTeamStatus(ss, teamId, loopNum, statusData) {
  var sheet = ss.getSheetByName("team_status");
  if (!sheet) {
    sheet = ss.insertSheet("team_status");
    sheet.appendRow(["チームID", "最終更新", "現在の周回", "取得情報(JSON)", "manabaログイン済"]);
  }
  
  var rows = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === teamId) {
      rowIndex = i + 1; // 1-indexed
      break;
    }
  }

  var rowData = [
    teamId,
    new Date(),
    loopNum,
    JSON.stringify(statusData.hints || []),
    statusData.manabaUser || "未ログイン"
  ];

  if (rowIndex > -1) {
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }
}

// --- スプレッドシートの新規初期化・データ構築 ---
function initializeSpreadsheet(ss) {
  // 既存のシートを削除（競合回避のため）
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() !== "Sheet1" && sheets[i].getName() !== "シート1") {
      ss.deleteSheet(sheets[i]);
    }
  }

  // 1. system シート
  var sSystem = ss.insertSheet("system");
  sSystem.appendRow(["キー", "値", "説明"]);
  sSystem.appendRow(["appleId", "No.4", "設定アプリの所有者名"]);
  sSystem.appendRow(["spec.os", "iPadOS 120.4 (Build 26A994)", "架空OSスペック"]);
  sSystem.appendRow(["spec.processor", "Quantum A30 Bionic (128 Cores)", "CPU"]);
  sSystem.appendRow(["spec.ram", "2.0 TB Unified Memory", "RAM"]);
  sSystem.appendRow(["spec.storage", "500 TB Super-Optane", "ストレージ"]);
  sSystem.appendRow(["spec.serial", "SF2126-LOOP-0094", "シリアル番号"]);

  // 2. meta_rules シート
  var sMetaRules = ss.insertSheet("meta_rules");
  sMetaRules.appendRow(["設定名", "値", "説明"]);
  sMetaRules.appendRow(["rules", "【2126年 端末操作ガイド】\n1. 本端末は「学友会執行委員会」が管理する特殊情報端末です。\n2. 画面下部の「ホームバー」をタップまたは上スワイプすることで、いつでもホーム画面に戻ることができます。\n3. 時間のループが発生した場合、端末は強制的にロックされます。ロック解除後、一部の情報が書き換わっている可能性があります。\n4. 探索中に発見したQRコードは、このアプリ内の「QRリーダー」で読み取ることで情報をアーカイブできます。", "ルール説明の改行区切りテキスト"]);
  sMetaRules.appendRow(["mapUrl", "https://images.unsplash.com/photo-1524661135-423995f22d0b?q=80&w=800", "マップ画像のURL"]);
  sMetaRules.appendRow(["synopsis_1", "【1周目】私たちは「学友会執行委員会」の調査員として、大学内で発生している『時間消失事件』および『テレポート実験』の噂を追っている。執行委員会の幹部である陣内、深澤からLINKで情報収集を行えという指示が出た。", "1周目のあらすじ"]);
  sMetaRules.appendRow(["synopsis_2", "【2周目】時間が巻き戻った。しかし、私の端末のメモとメタデータだけは引き継がれている。どうやら軽微な歴史改変が発生しているようだ。おじいちゃんのインタビュー内容が変化しているのはなぜか？", "2周目のあらすじ"]);
  sMetaRules.appendRow(["synopsis_3", "【3周目】世界線が致命的に歪んでいる。執行委員会HPは閉鎖され、UZW（鵜沢）への告発が渦巻いている。深澤からのLINKチャットに送られていた『無題』のフォームにハッキングの糸口があるかもしれない。", "3周目のあらすじ"]);

  // 3. meta_hints シート
  var sMetaHints = ss.insertSheet("meta_hints");
  sMetaHints.appendRow(["QRコードID", "タイトル", "表示内容", "画像URL"]);
  sMetaHints.appendRow(["hint_001", "「テレポート実験」の極秘メモ", "「実験は成功した。被験者は2026年へと跳躍した。しかし、戻るための座標が2126年側に固定されていないため、周期的なループが発生してしまう。キーは学友会執行委員会の名簿データにある。」", ""]);
  sMetaHints.appendRow(["hint_002", "破損したチップのログ", "「UZW... 彼は最初から知っていたのだ。このループを引き起こすことで、自分の失脚を防ごうとしている。側近の犬飼が何か隠しているはずだ。」", ""]);
  sMetaHints.appendRow(["hint_003", "安藤教授の書き残し", "「情報デザインの演習資料に、ゲートの起動周波数を暗号化して埋め込んだ。manabaにログインできれば閲覧可能なはずだ。」", ""]);

  // 4. browser_news シート
  var sNews = ss.insertSheet("browser_news");
  sNews.appendRow(["周回数", "ニュースID", "ニュースタイトル", "説明文", "遷移先URLキー"]);
  sNews.appendRow([1, "news_1", "健康おじいちゃんインタビュー：健康の秘訣は毎朝の『テレポート散歩』？", "今年で150歳を迎える東金市在住の健康おじいちゃんにインタビュー。", "grandpa_normal"]);
  sNews.appendRow([1, "news_2", "【速報】東金市で学生連続誘拐事件が発生か。警察が捜査開始", "千葉県東金市周辺で、大学生数名が行方不明に。", "kidnapping"]);
  sNews.appendRow([1, "news_3", "鵜沢氏、「つぶやき」で新プロジェクトを示唆", "若きリーダー・鵜沢氏が謎の数式『119』を投稿。", "uzawa_tweet"]);
  sNews.appendRow([1, "news_4", "都市伝説：2126年から2026年へ？テレポート実験の噂", "時空実験に関するオカルトの噂。", "teleport_rumor"]);
  sNews.appendRow([1, "news_5", "映画「〇〇」大ヒット！しかし、結末には賛否両論の声が", "恋人が死んで時を戻す時間SF映画。狂気のループの末、明かされる衝撃の結末に観客が騒然。", "movie_oo"]);
  sNews.appendRow([2, "news_1", "健康おじいちゃんインタビュー：資産100億を築いた驚異の投資術", "時間ループを利用して富豪になったおじいちゃん。", "grandpa_rich"]);
  sNews.appendRow([2, "news_2", "【速報】東金市誘拐事件、捜査は難航。学友会は沈黙", "解決の糸口が見えない誘拐事件。", "kidnapping"]);
  sNews.appendRow([2, "news_3", "Syzen社、画期的なエネルギー転送技術を発表", "Syzen社が時空転送の応用技術を発表。", "syzen_corp"]);
  sNews.appendRow([3, "news_1", "【独占】UZW（鵜沢）不正資金疑惑：学友会執行委員会の闇", "ネット上でUZW氏の裏金疑惑が炎上中。", "uzw_scandal"]);
  sNews.appendRow([3, "news_2", "【崩壊】学友会執行委員会、事実上の機能停止か。AIが解説", "公式サイト閉鎖。AIは存在を否定。", "committee_down"]);
  sNews.appendRow([3, "news_3", "鵜沢119 奇妙な誕生日会ニュース：側近犬飼氏が語る『未来への約束』", "側近の犬飼氏が怪しいスピーチを行う。", "uzawa_119"]);

  // 5. browser_pages シート
  var sPages = ss.insertSheet("browser_pages");
  sPages.appendRow(["キー", "タイプ", "タイトル/検索結果タイトル", "内容/説明", "リンクURL", "出現最小周回", "出現最大周回"]);
  // 検索結果の定義
  sPages.appendRow(["テレポート", "search_result", "テレポートに関するオカルト都市伝説と時空実験", "2126年に秘密裏に行われたとされるテレポート実験。", "teleport_rumor", "", ""]);
  sPages.appendRow(["テレポート", "search_result", "Syzen（サイゼン）コーポレートサイト：時空転送技術のフロンティア", "我が社は、未来をつなぐテレポート技術の基礎研究を行っています。", "syzen_corp", "", ""]);
  sPages.appendRow(["サイゼン", "search_result", "Syzen（サイゼン）企業コーポレートページ", "代表取締役社長：鵜沢。最先端量子力学のリーディングカンパニー。", "syzen_corp", "", ""]);
  sPages.appendRow(["サイゼン", "search_result", "【3周目】潰れたSyzen社、およびパロディ化された企業の悪評", "倒産手続き中とされるSyzen社の実態。", "syzen_bankrupt", "3", ""]);
  sPages.appendRow(["UZW", "search_result", "UZW（鵜沢）オフィシャルポータルページ", "「私たちは未来を再定義する」。", "uzw_portal", "", ""]);
  sPages.appendRow(["UZW", "search_result", "UZW不正疑惑・炎上・悪評まとめまとめ", "執行委員長UZWによる予算の私的流用と時間実験強行の告発。", "uzw_scandal", "3", ""]);
  sPages.appendRow(["LINE", "search_result", "AIアシスタントの回答：『LINE』について", "「LINEは2100年にサービスを終了しました。」", "line_ai", "", ""]);
  sPages.appendRow(["学友会", "search_result", "学友会執行委員会 公式ホームページ", "公式声明や活動報告。", "committee_hp", "", "2"]);
  sPages.appendRow(["学友会", "search_result", "【アクセス不可】学友会執行委員会 跡地", "「この組織は機能していません」", "committee_down", "3", ""]);
  sPages.appendRow(["映画", "search_result", "映画「〇〇」大ヒット！しかし、結末には賛否両論の声が", "今期大注目の時間SFループ映画「〇〇」。ラストシーンを巡り激しい議論が巻き起こる。", "movie_oo", "", ""]);
  // ページ本文の定義
  sPages.appendRow(["grandpa_normal", "page_content", "健康おじいちゃんインタビュー：健康の秘訣は毎朝の『テレポート散歩』？", "東金市にお住まいの健康おじいちゃん（150歳）にお話を伺いました。<br><br>「いやね、最近の若いもんは乗り物ばかり乗るが、歩くのが一番じゃ。わしは毎朝、近所の山までテレポート散歩に行っとるよ。ボタンを押すだけで一瞬で頂上じゃ。そこからゆっくり歩いて下りてくる。これが長生きのコツじゃな。」<br><br>※おじいちゃんが使っている転送端末は、学友会執行委員会から試供品として提供されたものだという。", "", "", ""]);
  sPages.appendRow(["grandpa_rich", "page_content", "健康おじいちゃんインタビュー：資産100億を築いた驚異の投資術", "東金市にお住まいの健康おじいちゃん（150歳）にお話を伺いました。<br><br>「投資の秘訣かね？そりゃあ『未来のニュースを知っていること』じゃよ。ハハハ！<br>実はね、数日前に時間が巻き戻ったんじゃ。わしはその記憶を持ったまま、下落する株をすべて売り払い、急騰するサイゼン社の株を買い占めたのさ。これで資産は100億を超えた。時間ループ様様じゃな！」", "", "", ""]);
  sPages.appendRow(["kidnapping", "page_content", "東金市連続学生誘拐事件のニュース", "千葉県東金市において、ここ数ヶ月で大学生3名が相次いで行方不明となる事件が発生しています。<br><br>目撃情報によると、学生たちは光に包まれて一瞬で姿を消したとされており、一部では非公認の「時空実験」の被験者として連れ去られたのではないかとの噂が流れています。<br>東金市公式HPは「デマに惑わされず、夜間の単独行動を避けるように」と注意を促しています。", "", "", ""]);
  sPages.appendRow(["uzawa_tweet", "page_content", "鵜沢のつぶやきに関するニュース", "学友会執行委員長である鵜沢氏が、個人アカウントで「119... 扉を開くための鍵が揃いつつある。もうすぐ我々は過去と未来を自由に往来できるようになるだろう」とつぶやきました。<br><br>この「119」という数字は、彼の誕生祭、あるいは時間転送の特定の周波数を指しているのではないかとネット上で議論が紛糾しています。", "", "", ""]);
  sPages.appendRow(["teleport_rumor", "page_content", "テレポートに関するオカルト都市伝説", "都市伝説掲示板より抜粋：<br>「学友会執行委員会が裏でやってるテレポート実験、あれマジらしいぞ。被験者は100年前の2026年に飛ばされたらしい。でも、戻り方が分からなくなって、歴史が変わるのを防ぐために、世界線自体が何度もループさせられているらしい。実験に関わっていた安藤教授はmanabaの授業資料にその解除キーを隠したとか…」", "", "", ""]);
  sPages.appendRow(["syzen_corp", "page_content", "Syzen（サイゼン）企業コーポレートページ", "<h2>株式会社Syzen (Syzen Corp.)</h2><p><b>「時間と空間を越え、人類の可能性を無限に」</b></p><p>弊社は学友会執行委員会と提携し、量子テレポートおよび局所的時系列制御デバイスの研究開発を行っています。</p><ul><li>設立: 2115年</li><li>代表取締役: 鵜沢</li><li>主要研究: 空間転送ゲートの維持、記憶の引き継ぎ技術</li></ul>", "", "", ""]);
  sPages.appendRow(["syzen_bankrupt", "page_content", "株式会社Syzen 破産手続きのお知らせ", "<h2>【重要】株式会社Syzen 破産手続き開始について</h2><p>弊社は2126年8月をもって破産し、すべての業務を停止いたしました。</p><p>代表取締役の鵜沢氏の失踪、および開発中だった『時空間維持ゲート』の暴走が原因とされています。債権者一同の皆様には多大なるご迷惑をおかけします。</p>", "", "", ""]);
  sPages.appendRow(["committee_hp", "page_content", "学友会執行委員会 公式HP", "<h3>学友会執行委員会へようこそ</h3><p>私たちは学内の秩序維持と、先端技術を用いた学習環境の向上を目指しています。</p><p><b>【お知らせ】</b><br>最近学内で囁かれている「時間消失」および「実験事故」に関する噂はすべてデマです。学生の皆様は安心して学業に励んでください。</p>", "", "", ""]);
  sPages.appendRow(["committee_down", "page_content", "【エラー】アクセスできません", "<h3>404 Not Found / Service Suspended</h3><p>指定されたウェブページは、学内保安局によってアクセス制限されているか、存在しません。</p><p><b>AIアシスタントの解説:</b><br>「この組織（学友会執行委員会）は、時間歪曲テロへの関与および予算の不正流用疑惑により、2126年8月22日付で強制解体されました。現存しない組織のHPにはアクセスできません。」", "", "", ""]);
  sPages.appendRow(["uzw_portal", "page_content", "UZW (鵜沢) ポータルサイト", "<h3>UZW: FUTURE IS NOW</h3><p>学友会執行委員長 鵜沢の公式ビジョンページ。</p><p>「我々の世代が、時間の制約から人類を解放する。2126年は、終わりではなく新たな始まりである。」</p>", "", "", ""]);
  sPages.appendRow(["uzw_scandal", "page_content", "UZW不正資金疑惑と「時間歪曲実験」強行の全貌", "<h3>ネット告発板：「UZWの闇を暴く」</h3><p>執行委員長・鵜沢は、Syzen社から多額のキックバックを受け取り、未承認の『時間逆行実験』を強行した疑いがある。</p><p>実験の失敗により、我々の端末は一定の時間ループに囚われている。側近の<b>犬飼</b>が口封じに動いている。証拠は学友会執行委員会の名簿スプレッドシート（LINKの深澤のチャットにある『無題』のリンク先）に隠されている。名簿の『予算シート』を見れば一発だ。</p>", "", "", ""]);
  sPages.appendRow(["line_ai", "page_content", "AIアシスタントの回答", "<h3>検索ワード「LINE」に対する回答</h3><p>「LINE」は西暦2000年代前半から中期にかけて地球上で広く使われていたインスタントメッセンジャーですが、情報セキュリティ規制の強化に伴い、2100年にサービスを終了しました。</p><p>現在、学内および公的通信には、後継アプリである<b>「LINK」</b>が標準採用されています。</p>", "", "", ""]);
  sPages.appendRow(["uzawa_119", "page_content", "鵜沢119誕生祭ニュース", "<h3>鵜沢委員長「119歳」の誕生祭、異様な熱気の中で開催</h3><p>一部の狂信的メンバーによって、鵜沢氏の『119回目（架空のループ回数にちなむ）』の誕生パーティーが開催されました。</p><p>壇上に立った側近の<b>犬飼</b>氏は、「委員長の精神はすでにループを克服した。我々がゲートを完全に閉じることで、永遠の帝国が完成する」と発言し、周囲を困惑させました。</p>", "", "", ""]);
  sPages.appendRow(["movie_oo", "page_content", "映画「〇〇」大ヒット！しかし、結末には賛否両論の声が", "【エンタメ情報】<br>今期大ヒット中の時間SF映画「〇〇」の結末を巡り、SNS上で激しい議論が巻き起こっています。<br><br>本作は、不慮の事故で恋人を亡くした主人公が、時を戻して彼女を救おうとするストーリー。しかし、どんなに歴史を変え、どれだけループを繰り返しても、恋人は必ず異なる形で死を遂げてしまいます。<br><br>主人公は永遠に繰り返す時間の中で段々と心をすり減らし、最終的には運命を受け入れることを決意します。しかし、映画の最終盤で明かされる<b>「実は、異なる世界線で彼女を殺していたのは、時を戻し続けた主人公自身（の別世界線のコピー）だった」</b>という驚愕の事実、および<b>「恋人がこれまでの全世界線のループ記憶を取り戻し、自分を殺し続けた主人公の姿を知ってしまう」</b>というあまりにも残酷な結末に、観客からは「鬱エンドすぎる」「救いがなさすぎる」「生々しいホラーだ」と賛否両論の声が上がっています。", "", "", ""]);

  // 6. link_contacts シート
  var sContacts = ss.insertSheet("link_contacts");
  sContacts.appendRow(["ID", "名前", "アイコン", "役職", "ひとこと", "グループフラグ", "3周目フラグ"]);
  sContacts.appendRow(["jinnai", "陣内 健二", "👤", "執行部幹部", "お前ら、例の実験データを早く回収しろ。", "FALSE", "FALSE"]);
  sContacts.appendRow(["fukasawa", "深澤 麻衣", "👩", "執行部同期", "ちょっとこれ見て…何かおかしくない？", "FALSE", "FALSE"]);
  sContacts.appendRow(["inukai", "犬飼 (執行部実務)", "🕶️", "側近", "委員長の指示に従ってください。", "FALSE", "FALSE"]);
  sContacts.appendRow(["committee_group", "学友会執行委員会・連絡網", "🏢", "連絡網グループ", "事務連絡：明日の会議室の変更について", "TRUE", "FALSE"]);
  // 3周目の変化後
  sContacts.appendRow(["jinnai", "陣内（監視対象）", "👁️", "執行部幹部", "……逃げろ……", "FALSE", "TRUE"]);
  sContacts.appendRow(["fukasawa", "深澤（接続切断）", "🚫", "執行部同期", "メッセージを送信できません。", "FALSE", "TRUE"]);
  sContacts.appendRow(["inukai", "犬飼 (システム統制局)", "👹", "統制官", "あなたの位置情報は特定されています。", "FALSE", "TRUE"]);
  sContacts.appendRow(["committee_group", "【閉鎖】学友会執行委員会", "🏚️", "閉鎖グループ", "このグループは削除されました。", "TRUE", "TRUE"]);

  // 7. link_messages シート
  var sMessages = ss.insertSheet("link_messages");
  sMessages.appendRow(["連絡先ID", "送信者", "本文", "時間"]);
  // 陣内
  sMessages.appendRow(["jinnai", "jinnai", "おい、端末の準備はいいか？", "10:05"]);
  sMessages.appendRow(["jinnai", "jinnai", "今回のループで絶対に安藤のデータを手に入れるぞ。", "10:06"]);
  sMessages.appendRow(["jinnai", "jinnai", "もし失敗したら、また時間が巻き戻るだけだ。焦るな。", "10:08"]);
  // 深澤
  sMessages.appendRow(["fukasawa", "fukasawa", "陣内先輩、最近ちょっとおかしいよね…？", "09:40"]);
  sMessages.appendRow(["fukasawa", "fukasawa", "私、執行部の裏のデータベースから怪しいURLを見つけたの。", "09:41"]);
  sMessages.appendRow(["fukasawa", "fukasawa", "これ、学生名簿とか予算が入ってるみたいなんだけど、アクセスに権限が必要で…", "09:42"]);
  sMessages.appendRow(["fukasawa", "fukasawa", "URL送るから、ハッキングの得意なあなたの方で中身を見られない？", "09:43"]);
  sMessages.appendRow(["fukasawa", "fukasawa", "リンク：<a href='#mock-google-form' class='chat-form-link'>無題 (Googleフォーム)</a>", "09:44"]);
  // 犬飼
  sMessages.appendRow(["inukai", "inukai", "調査の進捗はどうですか？", "08:00"]);
  sMessages.appendRow(["inukai", "inukai", "余計な詮索はしないことです。あなたたちの仕事はデータの回収のみです。", "08:02"]);
  // グループ
  sMessages.appendRow(["committee_group", "jinnai", "明日の会議は13時にSyzen社のラボ前集合な。", "昨日"]);
  sMessages.appendRow(["committee_group", "fukasawa", "了解しました。安藤先生の資料も持っていきますね。", "昨日"]);
  sMessages.appendRow(["committee_group", "inukai", "委員長も同席されます。遅れないように。", "昨日"]);

  // 8. link_add_friend_qr シート
  var sAddFriend = ss.insertSheet("link_add_friend_qr");
  sAddFriend.appendRow(["QRコードID", "追加ID", "追加名前", "追加アイコン", "追加時システムメッセージ"]);
  sAddFriend.appendRow(["friend_jinnai", "jinnai", "陣内 健二", "👤", "陣内 健二を友達に追加しました。"]);
  sAddFriend.appendRow(["friend_fukasawa", "fukasawa", "深澤 麻衣", "👩", "深澤 麻衣を友達に追加しました。"]);
  sAddFriend.appendRow(["friend_inukai", "inukai", "犬飼 (執行部実務)", "🕶️", "犬飼 (執行部実務)を友達に追加しました。"]);

  // 9. manaba_users シート
  var sManabaUsers = ss.insertSheet("manaba_users");
  sManabaUsers.appendRow([
    "ログインID", "パスワード", "学生氏名", "権限",
    "月1", "月2", "月3", "月4", "月5",
    "火1", "火2", "火3", "火4", "火5",
    "水1", "水2", "水3", "水4", "水5",
    "木1", "木2", "木3", "木4", "木5",
    "金1", "金2", "金3", "金4", "金5"
  ]);
  sManabaUsers.appendRow([
    "st882001", "jogasaki_ps", "城ヶ崎 悠", "学生",
    "人間中心設計", "", "テクノロジーアート", "", "",
    "", "知識工学", "", "", "",
    "音響工学基礎", "", "", "経済学", "",
    "", "", "グローバル時代の法", "", "",
    "", "", "", "", "情報デザイン論及び演習"
  ]);
  sManabaUsers.appendRow([
    "st883002", "kanda_ps", "神田 美咲", "学生",
    "", "人間中心設計", "", "", "",
    "テクノロジーアート", "", "", "知識工学", "",
    "", "音響工学基礎", "", "", "",
    "グローバル時代の法", "", "", "", "",
    "", "", "", "", "情報デザイン論及び演習"
  ]);

  // 10. manaba_materials シート
  var sManabaMaterials = ss.insertSheet("manaba_materials");
  sManabaMaterials.appendRow(["コース名", "担当教員", "開講時期", "タイプ", "ニュースタイトル/資料順", "ニュース日付/資料ファイル名", "資料ID", "資料タイトル", "資料添付ファイル名", "資料本文"]);
  // 基本行にコース詳細を入れる
  sManabaMaterials.appendRow(["情報デザイン論及び演習", "安藤 昌也", "2026 前期 金曜 5限", "news", "【成績保留者】成績保留の対応について", "2026-07-28", "", "", "", ""]);
  sManabaMaterials.appendRow(["", "", "", "news", "第13回ふりかえりシートへの記入について", "2026-07-24", "", "", "", ""]);
  // 授業資料
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 1, "1. ガイダンス", "情報D26_1.pdf", "「情報デザインとは何か。ユーザーの文脈と、情報アーキテクチャの基本について学ぶ。PDFサイズ: 1.2MB」"]);
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 2, "2. 市場製品分析/テーマの絞り込み", "第1回ワークシート.pptx", "「観察と分析を通じて、製品の課題を抽出する。スライド全12枚」"]);
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 3, "3. ユーザー調査・インタビュー設計", "書き起こし.pdf", "「ユーザーの発言から本質的欲求を引き出すためのインタビュー技法」"]);
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 4, "4. ペルソナとシナリオ手法", "インタビューデータ.xlsx", "「仮想のユーザー像を定義し、利用シナリオを記述する。」"]);
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 5, "5. 情報構造設計 (IA)", "情報D26_5.pdf", "「サイトマップと画面遷移図。2126年のシステムは、100年前の2026年と同期する変調キーを持つ。」"]);
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 6, "6. プロトタイピング", "プロトタイプ画像.jpg", "「ペーパープロトタイプとFigmaによるインタラクションデザインの検証。」"]);
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 7, "7. ユーザーテストの計画と実施", "評価シート.docx", "「使いやすさの検証とフィードバックの反映方法。」"]);
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 8, "8. 中間成果発表", "中間発表スライド.pptx", "「これまでの分析とプロトタイプの方向性の発表。」"]);
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 9, "9. インタラクションの詳細化", "情報D26_9.pdf", "「アニメーション、マイクロインタラクションによるフィードバックの設計。」"]);
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 10, "10. モバイルPWAの設計", "PWAガイドライン.pdf", "「ネイティブアプリに近い体験を提供するWeb技術について。Service Workerの活用。」"]);
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 11, "11. ゲート同期インタフェースの構築", "ゲート変調キーのメモ.txt", "「重要：時空ゲートを閉じるための変調周波数は【 119.43 MHz 】である。これをゲートキーパーに入力せよ。」"]);
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 12, "12. 最終調整とパッケージング", "最終チェック.pdf", "「ゲームシステム全体の整合性と、バグフィックス、最終テスト。」"]);
  sManabaMaterials.appendRow(["", "", "", "material", "", "", 13, "13. 成果発表", "成果発表会案内.pdf", "「第13回ふりかえりシートへ記入してください。各自の発表時間は5分です。」"]);

  // 11. mail_box シート
  var sMail = ss.insertSheet("mail_box");
  sMail.appendRow(["周回数", "メールID", "送信者", "件名", "日付", "本文"]);
  sMail.appendRow([1, "m1", "学友会執行委員会 事務局", "【重要】明日の会議室変更のお知らせ", "2126/08/22 18:00", "学友会執行部メンバー各位。明日の定例会議は、Syzen社ラボ2階の第3会議室で行います。遅れないように集合してください。"]);
  sMail.appendRow([1, "m2", "深澤 麻衣", "名簿データのフォームを送ります", "2126/08/22 17:30", "ハッキングの件、例のフォームのリンクはLINKで送りました。そちらから確認をお願いします。"]);
  sMail.appendRow([2, "m1", "学友会執行委員会 事務局", "【重要】会議室変更のお知らせ（再）", "2126/08/22 18:00", "メンバー各位。ループ発生に伴い、時間割と招集日時が変更されました。スプレッドシートの予算配分も再度確認してください。"]);
  sMail.appendRow([2, "m2", "深澤 麻衣", "【注意】犬飼先輩が監視しているかも", "2126/08/22 17:45", "名簿にアクセスしたことがログに残っているかもしれません。ログアウトを忘れないで！"]);
  sMail.appendRow([3, "m1", "システム警報局", "【警告】学内ネットワークの安全確保について", "2126/08/22 19:00", "学友会執行委員会は現在解体されました。本アカウントからの外部通信、および各種申請フォームへのリンクはすべて削除・遮断されました。直ちにすべての調査用ファイルを削除してください。"]);

  // 12. logs シート (空)
  var sLogs = ss.insertSheet("logs");
  sLogs.appendRow(["タイムスタンプ", "チームID", "周回数", "ログ種別", "メッセージ"]);

  // 13. team_status シート (空)
  var sTeamStatus = ss.insertSheet("team_status");
  sTeamStatus.appendRow(["チームID", "最終更新", "現在の周回", "取得情報(JSON)", "manabaログイン済"]);

  // デフォルトの Sheet1 / シート1 を削除
  var sheet1 = ss.getSheetByName("Sheet1") || ss.getSheetByName("シート1");
  if (sheet1) {
    ss.deleteSheet(sheet1);
  }
}

// --- GUIエディタから送られてきたJSONデータをスプレッドシートの各シートに上書き展開する ---
function updateAllDataInSpreadsheet(ss, data) {
  // 1. meta_hints
  var sHints = ss.getSheetByName("meta_hints");
  if (sHints) {
    sHints.clearContents();
    sHints.appendRow(["QRコードID", "タイトル", "表示内容", "画像URL"]);
    Object.keys(data.metaApp.qrHints).forEach(function(qrId) {
      var h = data.metaApp.qrHints[qrId];
      sHints.appendRow([qrId, h.title, h.content, h.image || ""]);
    });
  }

  // 2. browser_news
  var sNews = ss.getSheetByName("browser_news");
  if (sNews) {
    sNews.clearContents();
    sNews.appendRow(["周回数", "ニュースID", "ニュースタイトル", "説明文", "遷移先URLキー"]);
    [1, 2, 3].forEach(function(loop) {
      var list = data.browser.news[loop] || [];
      list.forEach(function(item) {
        sNews.appendRow([loop, item.id, item.title, item.desc, item.target]);
      });
    });
  }

  // 3. browser_pages
  var sPages = ss.getSheetByName("browser_pages");
  if (sPages) {
    sPages.clearContents();
    sPages.appendRow(["キー", "タイプ", "タイトル/検索結果タイトル", "内容/説明", "リンクURL", "出現最小周回", "出現最大周回"]);
    // 検索結果書き出し
    Object.keys(data.browser.searchResults).forEach(function(keyword) {
      var results = data.browser.searchResults[keyword];
      results.forEach(function(item) {
        sPages.appendRow([keyword, "search_result", item.title, item.desc, item.url, item.minLoop || "", item.maxLoop || ""]);
      });
    });
    // ページ本文書き出し
    Object.keys(data.browser.pagesContent).forEach(function(url) {
      var page = data.browser.pagesContent[url];
      sPages.appendRow([url, "page_content", page.title, page.content, "", "", ""]);
    });
  }

  // 4. link_contacts
  var sContacts = ss.getSheetByName("link_contacts");
  if (sContacts) {
    sContacts.clearContents();
    sContacts.appendRow(["ID", "名前", "アイコン", "役職", "ひとこと", "グループフラグ", "3周目フラグ"]);
    data.linkApp.contacts.forEach(function(c) {
      sContacts.appendRow([c.id, c.name, c.icon, c.role, c.desc, c.isGroup ? "TRUE" : "FALSE", "FALSE"]);
    });
    if (data.linkApp.contactsLoop3) {
      data.linkApp.contactsLoop3.forEach(function(c) {
        sContacts.appendRow([c.id, c.name, c.icon, c.role, c.desc, c.isGroup ? "TRUE" : "FALSE", "TRUE"]);
      });
    }
  }

  // 5. link_messages
  var sMessages = ss.getSheetByName("link_messages");
  if (sMessages) {
    sMessages.clearContents();
    sMessages.appendRow(["連絡先ID", "送信者", "本文", "時間"]);
    Object.keys(data.linkApp.chats).forEach(function(contactId) {
      var chatList = data.linkApp.chats[contactId];
      chatList.forEach(function(msg) {
        sMessages.appendRow([contactId, msg.sender, msg.text, msg.time]);
      });
    });
  }

  // 6. manaba_users
  var sManabaUsers = ss.getSheetByName("manaba_users");
  if (sManabaUsers) {
    sManabaUsers.clearContents();
    sManabaUsers.appendRow([
      "ログインID", "パスワード", "学生氏名", "権限",
      "月1", "月2", "月3", "月4", "月5",
      "火1", "火2", "火3", "火4", "火5",
      "水1", "水2", "水3", "水4", "水5",
      "木1", "木2", "木3", "木4", "木5",
      "金1", "金2", "金3", "金4", "金5"
    ]);
    Object.keys(data.manaba.users).forEach(function(loginId) {
      var u = data.manaba.users[loginId];
      var row = [loginId, u.pass, u.name, u.role];
      ["Mon", "Tue", "Wed", "Thu", "Fri"].forEach(function(day) {
        for (var i = 0; i < 5; i++) {
          row.push(u.timetable[day][i] || "");
        }
      });
      sManabaUsers.appendRow(row);
    });
  }

  // 7. manaba_materials
  var sManabaMaterials = ss.getSheetByName("manaba_materials");
  if (sManabaMaterials) {
    sManabaMaterials.clearContents();
    sManabaMaterials.appendRow(["コース名", "担当教員", "開講時期", "タイプ", "ニュースタイトル/資料順", "ニュース日付/資料ファイル名", "資料ID", "資料タイトル", "資料添付ファイル名", "資料本文"]);
    var course = data.manaba.courseDetail;
    sManabaMaterials.appendRow([course.name, course.teacher, course.term, "news", course.news[0] ? course.news[0].title : "", course.news[0] ? course.news[0].date : "", "", "", "", ""]);
    for (var i = 1; i < course.news.length; i++) {
      sManabaMaterials.appendRow(["", "", "", "news", course.news[i].title, course.news[i].date, "", "", "", ""]);
    }
    course.materials.forEach(function(mat) {
      sManabaMaterials.appendRow(["", "", "", "material", "", "", mat.id, mat.title, mat.file, mat.content]);
    });
  }
}
