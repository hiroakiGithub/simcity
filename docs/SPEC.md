# 拡張仕様書(v2: 本家風システム追加)

全コードは `game.js` 1ファイル。既存のコードスタイル(セクションコメント、日本語コメント、`const`/アロー関数、2スペースインデント)に合わせること。
テストは `node tests/run-tests.js`。`tests/harness.js` の `EXPOSE` 配列にある名前はテストから参照可能(必要なら追記可)。

## 既存の共有インターフェース

- タイル種別 `T`(0..19)。`BIG = {NUCLEAR:2, STADIUM:2, SEAPORT:2, AIRPORT:2}` はマルチタイル建物のサイズ。lvlに足元内位置(dy*size+dx)、lvl=0がアンカー。アンカーのみ描画・容量計算に使う
- 状態 `g`: t/lvl/fireT/powered(Uint8Array)、funds、month、taxRate、milestone、pop、jobs、demand{r,c,i}、speed、running
- 作業マップ(セーブ対象外・毎月再計算): roadNear、pollution、landValue、fireCov
- 月次処理 `simMonth()` の順序は本ファイル末尾参照
- 道路/線路/送電線の水上タイルは lvl=1(橋フラグ)

## A. シミュレーション系(交通・犯罪・予算・需要ゲート・災害・評価・セーブv2)

### 交通
- `const traffic = new Uint16Array(W*H)`(セーブ対象外)
- `updateTraffic()`: 全タイル `traffic[i] = (traffic[i]*0.7)|0` で減衰後、
  発展済み(lvl>0)かつ通電中の区画ごとに、チェビシェフ距離2以内の ROAD タイルへ `lvl*3` を加算(上限999)。RAILには加算しない(線路は渋滞しない)
- 渋滞しきい値 `CONGESTION = 120`
- `roadNear` は RAIL も対象に含める(道路または線路が距離2以内で輸送アクセスあり)
- `zoneGrowth()`: 区画の周囲5×5にROADがあり、その**すべて**が渋滞(traffic>CONGESTION)なら成長確率×0.4+毎月4%で衰退。線路アクセスのみの区画は渋滞ペナルティなし

### 犯罪と警察・消防の予算
- `const crime = new Int16Array(W*H)`、`const policeCov = new Int16Array(W*H)`(セーブ対象外)
- `g.budget = { road:100, police:100, fire:100, autoShow:true }`(0〜100%、セーブ対象)
- `computeMaps()`: 警察署(通電時)は `policeCov` に半径 `round(6*police%/100)`、値40、falloffで加算(landValueへの+8も維持)。消防署の `fireCov` 半径は `round(8*fire%/100)`
- `updateCrime()`: 発展済み区画タイルで `crime[i] = clamp(lvl*10 + 人口密度ボーナス(周囲8マスの住宅lvl合計) - landValue[i]*0.3 - policeCov[i], 0, 250)`。他は0
- 成長への影響: COM `×clamp(1-crime/350, 0.2, 1)`、RES `×clamp(1-crime/500, 0.3, 1)`

### 財政・予算
- `g.finYear = {tax:0, road:0, police:0, fire:0, other:0}` 月次累積(セーブ対象)。1月に `g.lastFin` へ退避してリセット(lastFinもセーブ)
- `economy()` の支出(予算%でスケール):
  - 道路 `roads*0.10*road%` + 線路 `rails*0.20*road%`
  - 警察 `署数*15*police%`、消防 `署数*12*fire%`
  - 石炭発電所25、原子力40、公園2、スタジアム20、港15、空港30(2×2はアンカーのみ数える)
- 道路予算<60%のとき: 毎月、道路・線路タイルごとに確率 `(60-road%)/4000` で RUBBLE 化。発生時はまれにトースト「🚧 道路が傷んでいます」
- 1月に `g.pendingBudget = true` を立てる(UI側が消費)

### 需要ゲート(特殊建造物)
`calcStats()` の需要計算後に適用。建物は「アンカーが存在し通電している」ことが条件:
- 人口≥1200 かつ スタジアムなし → `demand.r = min(demand.r, 0.05)`
- 工業雇用≥500 かつ 港なし → `demand.i = min(demand.i, 0.05)`
- 商業雇用≥400 かつ 空港なし → `demand.c = min(demand.c, 0.05)`
ゲート発動中は24ヶ月に1回までトーストでヒント(例:「🏟️ 住民はスタジアムを求めています」)。`g.hintAt = {}`(セーブ不要)で間隔管理

### 災害
- `g.autoDisaster = true`(セーブ対象)、`g.actors = []`(セーブ対象外、要素 `{kind,x,y,ttl,tx,ty}`)
- `triggerDisaster(kind)`: kind ∈ fire | flood | quake | tornado | monster
  - fire: ランダムな発展済みタイルを発火(既存火災ロジック流用)
  - flood: 陸に接する WATER からランダムに選び、距離2以内の陸タイル(WATER以外)を `T.FLOOD` に(fireT=4+乱数4 を残存期間に流用)。マルチタイル建物は足元全体をFLOODに
  - quake: 8+乱数8ヶ所のランダム地点で3×3を確率0.6でRUBBLE化(発展済み区画なら確率0.25でFIRE)。WATERは無傷。NUCLEARが被災したら確率0.3でメルトダウン(足元4タイルFIRE+トースト「☢️」)。`g.shakeT = 60`(描画の画面揺れ用、C担当)
  - tornado: マップ端から出現、ttl=24。毎simTickランダムに1歩移動し、通過タイルをRUBBLE化(WATERは素通り)
  - monster: マップ端から出現、公害最大の地点へ毎tick1歩(揺らぎあり)、通過タイル破壊+隣接に確率0.3で発火。ttl=30
- `actorsStep()`: FLOODの減衰(fireT--、0でGRASSへ。fireT>2の間は隣へ確率0.15で拡大)+アクター移動・破壊・ttl管理
- 破壊ヘルパー: マルチタイル建物は足元全体をRUBBLEに
- 自動災害: month>24 かつ autoDisaster のとき毎月確率0.004で発生(fire 50% / flood 20% / tornado 15% / quake 10% / monster 5%、monsterは平均公害が高いときのみ)

### 市民評価
- `computeEvaluation()` 毎月実行 → `g.eval = {score, approval, problems:[]}`
- 指標: avgCrime、avgPollution(発展タイル平均)、渋滞率(渋滞道路/全道路)、失業率 `max(0,(pop*0.6-jobs)/max(1,pop*0.6))`、無電区画率
- `approval = clamp(round(75 - avgCrime*0.15 - avgPoll*0.1 - 渋滞率*40 - 失業率*50 - (taxRate-7)*2.5), 0, 100)`
- `problems`: [犯罪, 公害, 交通渋滞, 税金, 失業, 電力不足] から値が大きい順に最大3件(日本語ラベル)
- `score = clamp(round(pop*0.5 + approval*3 + 500), 0, 9999)`

### セーブv2
- `saveGame`: `v:2` で budget / autoDisaster / finYear / lastFin を追加保存
- `loadGame`: v1とv2の両方を受理。v1には新フィールドのデフォルトを補う
- `newGame()` で全新フィールドを初期化

### simMonth() の新しい順序
computePower → computeMaps → updateTraffic → updateCrime → calcStats → zoneGrowth → fireStep → actorsStep → economy → computeEvaluation → month++ → milestones → (1月: lastFin退避・finYearリセット・pendingBudget=true) → 12ヶ月ごと自動セーブ → updateHUD

## B. UI(パネル群)— 別エージェント担当

予算ウィンドウ(1月自動表示+メニュー)、災害メニュー、評価パネル、データマップ選択。`g.overlayMode`('none'|'power'|'pollution'|'crime'|'landvalue'|'traffic'|'police'|'fire')をセットする。

## C. グラフィック — 別エージェント担当

2×2建物の本格スプライト(プレースホルダー差し替え)、渋滞道路の車、竜巻・怪獣・画面揺れ(g.shakeT)、オーバーレイ描画(renderOverlay等のフック実装)。
