// ① Firebaseコンソール →「プロジェクトの設定」→「マイアプリ」に表示される設定をそのまま貼り付ける。
//    この値は公開されても問題ない（データの保護は firestore.rules が担う）。
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "",
  appId: "",
};

// ② スタンプラリーの設定
export const settings = {
  // 区役所から何m以内なら押せるか。GPSの誤差を考えると200〜300mが目安。
  radiusMeters: 300,
  // 区役所の座標CSV
  officesCsv: "data/offices.csv",
  // スタンプ画像のフォルダ
  stampDir: "stamps/",
  // 自宅でテストするときだけ true にすると、位置チェックなしで押せる。
  // 公開前に必ず false に戻すこと。
  skipLocationCheck: false,
};
