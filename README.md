# 大阪市 区役所スタンプラリー

大阪市24区の区役所をめぐるスタンプラリー。区役所の近く（初期設定は300m以内）で地図の区をタップすると、スタンプが押されます。記録はGoogleログインでクラウドに保存されるので、機種変更やブラウザのデータ削除でも消えません。

```
index.html        画面
style.css         見た目
app.js            地図・位置判定・ログイン・記録
csv.js            区役所CSVの読み込み
config.js         ← Firebaseの設定と押印範囲（要編集）
firestore.rules   ← Firebaseに貼り付けるセキュリティルール
data/wards.geojson  24区の境界（国土数値情報を加工）
data/offices.csv  区役所の座標（配置済み）
stamps/           ← スタンプ画像を置く（Abeno.png は配置済み）
tools/shrink_stamps.py  スタンプ画像を軽くするスクリプト
```

## 1. 区役所CSVとスタンプ画像を置く

`data/offices.csv` は用意済みです（24区すべての座標が、それぞれの区の中にあることを確認済み）。Excelで編集してShift_JISで保存し直しても、そのまま読めます。

スタンプ画像は `stamps/` に、区のローマ字の名前で置きます（`Abeno.png` は配置済み）。

```
Miyakojima.png  Fukushima.png  Konohana.png  Nishi.png
Minato.png      Taisho.png     Tennoji.png   Naniwa.png
Nishiyodogawa.png  Higashiyodogawa.png  Higashinari.png  Ikuno.png
Asahi.png       Joto.png       Abeno.png     Sumiyoshi.png
Higashisumiyoshi.png  Nishinari.png  Yodogawa.png  Tsurumi.png
Suminoe.png     Hirano.png     Kita.png      Chuo.png
```

GitHub Pagesは大文字・小文字を区別しますが、`Abeno.png` と `abeno.png` はどちらでも見つけます。`Taishou.png` `Tennouji.png` `Jyoto.png` `Chuou.png` のような長音の表記ゆれ、`阿倍野区.png` や区コードの `27119.png` にも対応しています。これ以外の名前にしたい場合は、CSVに4列目「スタンプ」を足してファイル名を書けば、そちらが優先されます。

画像が見つからない区は、区名入りの仮のスタンプが表示されます。テストモード（後述）で開くと、見つからない区が画面上部に一覧で出ます。

### 画像を軽くする

元の画像（1328px・約340KB）のままだと24枚で8MBほどになり、外出先のモバイル回線では表示が遅くなります。同梱のスクリプトで480pxに縮めると、見た目はほぼそのままで1枚20〜30KBになります。

```
pip install pillow
python3 tools/shrink_stamps.py
```

元の画像は `stamps_original/` に退避されます（GitHubには上げなくて大丈夫です）。

## 2. Firebaseを準備する（無料プランで足ります）

1. https://console.firebase.google.com でプロジェクトを作成する（Googleアナリティクスはオフで可）。
2. 「プロジェクトの概要」の「ウェブ」（`</>` アイコン）からアプリを登録し、表示された `firebaseConfig` の中身を `config.js` に貼り付ける。
3. 「Authentication」→「始める」→「ログイン方法」で **Google** を有効にする。
4. 「Firestore Database」→「データベースを作成」。ロケーションは `asia-northeast2（大阪）` がおすすめ。本番環境モードで作成する。
5. Firestoreの「ルール」タブに `firestore.rules` の中身を貼り付けて「公開」する。

## 3. GitHub Pagesで公開する

1. GitHubで新しいリポジトリを作り、このフォルダの中身をすべてアップロードする。
2. リポジトリの「Settings」→「Pages」で、Sourceを「Deploy from a branch」、Branchを `main` / `/ (root)` にして保存する。
3. 数分後に `https://ユーザー名.github.io/リポジトリ名/` で公開される。

## 4. 公開URLをFirebaseに登録する（忘れやすい）

Firebaseの「Authentication」→「設定」→「承認済みドメイン」に `ユーザー名.github.io` を追加します。これをしないとログインで `auth/unauthorized-domain` エラーになります。

## 5. 仲間に共有する

LINEで共有するときは、URLの末尾に `?openExternalBrowser=1` を付けてください。LINEの中のブラウザではGoogleのログインが拒否されるため、SafariやChromeで開くようにします。

```
https://ユーザー名.github.io/リポジトリ名/?openExternalBrowser=1
```

## 手元でテストする

ファイルを直接ダブルクリックで開くと動きません。フォルダ内で簡易サーバーを起動して開きます。

```
python3 -m http.server 8000
```

ブラウザで http://localhost:8000 を開きます（localhostはFirebaseで最初から許可されています）。

`config.js` の `skipLocationCheck` を `true` にするとテストモードになり、区役所に行かずに押印を試せます。スタンプ画像が見つからない区の一覧も表示されます。**公開前に必ず `false` に戻してください。**

テストで押したスタンプを消すときは、Firebaseの「Firestore Database」→「データ」から `users/（あなたのID）/stamps` のドキュメントを削除します。アプリ側からは一度押したスタンプを消せない設定にしてあります。

## 設定を変える

- 押せる範囲：`config.js` の `radiusMeters`。区役所の建物内はGPSがずれやすいので、200m未満にはしない方が無難です。
- 記録の中身：押した日時、その時の現在地、区役所までの距離、GPSの誤差がFirestoreに保存されます。

## データの出典

- 地図：© OpenStreetMap contributors
- 区の境界：国土数値情報（行政区域データ）国土交通省 を加工して作成
