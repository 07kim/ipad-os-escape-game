import os
import re

DATA_JS = "/Users/mayugeyasai/個人/制作物/ipad/data.js"

with open(DATA_JS, "r", encoding="utf-8") as f:
    content = f.read()

# 1. キャラクター定義の更新
replacements = [
    # 深澤文哉
    ('studentId: "s2342089jk", pass: "23A20117"', 'studentId: "23a20117", pass: "23A20117", email: "23a20117@chibakou.ac.jp"'),
    # 外園胡春
    ('studentId: "s2342098cl", pass: "23E2036"', 'studentId: "23e2036", pass: "23E2036", email: "23e2036@chibakou.ac.jp"'),
    # 比嘉俊希
    ('studentId: "s23a1058uw", pass: "23A1099"', 'studentId: "23a1099", pass: "23A1099", email: "23a1099@chibakou.ac.jp"'),
    # 七瀬いろは
    ('role: "副委員長1年 / 頭脳メディア"', 'role: "副委員長1年 / 頭脳メディア", department: "頭脳メディア工学科"'),
    ('studentId: "s2341013qr", pass: "2341013"', 'studentId: "26d1094", pass: "26D1094", email: "26d1094@chibakou.ac.jp"'),
    # 陣内樹
    ('role: "総務3年 / 情報通信"', 'role: "総務3年 / 応用物理学科", department: "応用物理学科"'),
    ('studentId: "s24c2117", pass: "JNNITMNR"', 'studentId: "24b1070", pass: "JNNITMNR", email: "24b1070@chibakou.ac.jp"'),
    # 森野航
    ('role: "財務3年 / タイムマシン実行犯"', 'role: "財務3年 / 応用物理学科", department: "応用物理学科"'),
    ('studentId: "s23b1015nd", pass: "25B1150"', 'studentId: "25b1150", pass: "25B1150", email: "25b1150@chibakou.ac.jp"'),
    
    # スプレッドシート回答データ
    ('"s2342098cl@chibatech.ac.jp", "外園胡春"', '"23e2036@chibakou.ac.jp", "外園胡春"'),
    ('"s23a1058uw@chibatech.ac.jp", "比嘉俊希"', '"23a1099@chibakou.ac.jp", "比嘉俊希"'),
    ('"s2341013qr@chibatech.ac.jp", "七瀬いろは"', '"26d1094@chibakou.ac.jp", "七瀬いろは"'),
    
    # 名簿データ
    ('["陣内 樹", "幹部メンバー", "J-098", "jinnai_ken", "神崎教授のデータ回収を指揮（PCパス: JNNITMNR）"]',
     '["陣内 樹", "幹部メンバー", "J-098", "jinnai_ken", "神崎教授のデータ回収を指揮（学生番号: 24b1070 / PCパス: JNNITMNR）"]'),
    ('["深澤 文哉", "一般メンバー", "F-102", "fukasawa_mai", "実験の危険性に気づき始めている"]',
     '["深澤 文哉", "一般メンバー", "F-102", "fukasawa_mai", "実験の危険性に気づき始めている（学生番号: 23a20117）"]'),
    ('["森野 航", "財務担当 (K)", "ST-882", "morino_pass", "学生番号: s23b1015nd / パスコード: 25B1150"]',
     '["森野 航", "財務担当 (K)", "ST-882", "morino_pass", "学生番号: 25b1150 / パスコード: 25B1150"]'),
     
    # 記事テキスト内の学生番号
    ('森野航（もりの・わたる）さん（学生番号: s23b1015nd / パスコード: 25B1150）',
     '森野航（もりの・わたる）さん（学生番号: 25b1150 / パスコード: 25B1150）'),
    ('2020年代の学生番号体系（例: s25b1150er / s23b1015nd）',
     '2020年代の学生番号体系（例: s25b1150er / 25b1150）'),
    ('■ 財務局長：森野 航（応用量子力学科3年）——学生番号: s23b1015nd / パスコード: 25B1150。',
     '■ 財務局長：森野 航（応用物理学科3年）——学生番号: 25b1150 / パスコード: 25B1150。'),
    ('森野航（工学部 応用量子力学科 3年）学内登録記録',
     '森野航（工学部 応用物理学科 3年）学内登録記録'),
    ('学生番号 s23b1015nd / パスコード 25B1150',
     '学生番号 25b1150 / パスコード 25B1150'),
    ('■ 所属：工学部 応用量子力学科 3年\\n■ 学生番号：s23b1015nd',
     '■ 所属：工学部 応用物理学科 3年\\n■ 学生番号：25b1150'),
]

for old, new in replacements:
    if old not in content:
        print(f"Warning: pattern not found: {old}")
    else:
        content = content.replace(old, new)

# manaba.users の七瀬いろはのアカウントキー更新と追加アカウント
old_nanase_block = '''      // ④ 学生番号別名アカウント（七瀬 いろは）
      "s2341013qr": {
        pass: "2341013",
        name: "七瀬 いろは",
        department: "頭脳メディア工学科",
        studentId: "s2341013qr",'''

new_nanase_block = '''      // ④ 学生番号別名アカウント（七瀬 いろは）
      "26d1094": {
        pass: "26D1094",
        name: "七瀬 いろは",
        department: "頭脳メディア工学科",
        studentId: "26d1094",
        email: "26d1094@chibakou.ac.jp",'''

if old_nanase_block in content:
    content = content.replace(old_nanase_block, new_nanase_block)
else:
    print("Warning: old_nanase_block not found")

# manaba.usersの末尾にエイリアスと他メンバーを追加
old_users_end = '''          { id: "c_percept_cog_comm", name: "知覚・認知コミュニケーション", teacher: "有馬 拓海", term: "26 前期 金曜 3-4限", room: "215講義室 / 新習志野キャンパス" },
          { id: "c_digi_media_intro", name: "デジタルメディア創成入門", teacher: "遠藤 隼人", term: "26 前期 金曜 6-7限", room: "212講義室 / 新習志野キャンパス" }
        ]
      },
    },'''

new_users_end = '''          { id: "c_percept_cog_comm", name: "知覚・認知コミュニケーション", teacher: "有馬 拓海", term: "26 前期 金曜 3-4限", room: "215講義室 / 新習志野キャンパス" },
          { id: "c_digi_media_intro", name: "デジタルメディア創成入門", teacher: "遠藤 隼人", term: "26 前期 金曜 6-7限", room: "212講義室 / 新習志野キャンパス" }
        ]
      },

      // 互換用エイリアス
      "s2341013qr": {
        pass: "26D1094",
        name: "七瀬 いろは",
        department: "頭脳メディア工学科",
        studentId: "26d1094",
        email: "26d1094@chibakou.ac.jp"
      },

      // ⑤ 深澤 文哉
      "23a20117": {
        pass: "23A20117",
        name: "深澤 文哉",
        department: "情報科学部 / 広報担当",
        studentId: "23a20117",
        email: "23a20117@chibakou.ac.jp"
      },

      // ⑥ 外園 胡春
      "23e2036": {
        pass: "23E2036",
        name: "外園 胡春",
        department: "情報科学部 / 企画担当",
        studentId: "23e2036",
        email: "23e2036@chibakou.ac.jp"
      },

      // ⑦ 比嘉 俊希
      "23a1099": {
        pass: "23A1099",
        name: "比嘉 俊希",
        department: "工学部 / 執行委員長",
        studentId: "23a1099",
        email: "23a1099@chibakou.ac.jp"
      },

      // ⑧ 陣内 樹
      "24b1070": {
        pass: "JNNITMNR",
        name: "陣内 樹",
        department: "応用物理学科 / 総務局長",
        studentId: "24b1070",
        email: "24b1070@chibakou.ac.jp"
      },

      // ⑨ 森野 航
      "25b1150": {
        pass: "25B1150",
        name: "森野 航",
        department: "応用物理学科 / 財務局長",
        studentId: "25b1150",
        email: "25b1150@chibakou.ac.jp"
      }
    },'''

if old_users_end in content:
    content = content.replace(old_users_end, new_users_end)
else:
    print("Warning: old_users_end not found")

with open(DATA_JS, "w", encoding="utf-8") as f:
    f.write(content)

print("data.js successfully updated.")
