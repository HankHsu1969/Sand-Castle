# 沙堡物語 · Sandcastle Dreams — AI 交接文件

給接手這個專案的 AI：先讀這份，就能掌握架構、規則與已知陷阱。README 的操作表較舊，**以本文件為準**。

- **最新進度與待辦**：看 `docs/工作日誌.md` 最上面那一則。
- **收工流程**：使用者說「收工，更新交接文件」時：
  1. 在日誌最上面加一則今天的總結：完成項目與 commit、決定與原因、待辦。
  2. 架構或規則有變的話，同步更新本文件。
  3. commit 後直接推到 main。

## 一句話

放鬆向的 3D 堆沙堡遊戲（Three.js + Vite，純 JavaScript ES modules，無框架）。玩家在熱帶沙灘上堆沙、挖護城河、蓋水桶塔與城牆、雕刻立體沙雕，迎接漲潮；共 5 關，另有拍照模式。

## 快速開始

```bash
npm install
npm run dev      # http://localhost:5199
npm run build    # 輸出 dist/
```

- 預覽伺服器設定在 `.claude/launch.json`（名稱 `sandcastle`，port 5199）。
- 主程式進入點 `src/main.js`，遊戲實例掛在 `window.__game`，方便在主控台除錯。

## 使用者偏好與工作規則（重要）

- **語言**：使用者用繁體中文溝通，回覆請用繁體中文；遊戲內文字也是繁體中文。
- **Git**：commit 後**直接推到 `main`**，不要開分支、不要建議 PR（使用者明確要求過）。只在使用者要求時才 commit / push。
  - commit 訊息用繁體中文，結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- **部署**：GitHub `HankHsu1969/Sand-Castle` → Netlify 網站 `hank-sand-castle` 從 `main` 自動部署（build 設定在 Netlify 介面：`npm run build`、publish `dist`；專案內沒有 `netlify.toml`）。
- **素材來源**：
  - 圖像用 Higgsfield（`gpt_image_2`，quality medium）。
  - 音效用 ElevenLabs Sound Effects。使用者**不喜歡程式合成的海浪或環境音**，要真實錄音感。
  - 3D 模型用 Higgsfield 的 Hunyuan3D v3（geometry-only）。
- **驗證**：改完要在預覽裡實際跑過、截圖確認，並跑 `npm run build`。使用者會自己試玩並回報。

## 技術棧

- three r186、Vite 8，`vite.config.js` 設 `base: './'`。
- 後製：EffectComposer，順序為 clamp → bloom → 移軸 / 調色 → OutputPass；ACES 色調映射，每關有自己的曝光。
- 音樂：Web Audio 即時合成（pad / kalimba / Karplus-Strong）。
- 環境音與工具音效：ElevenLabs 錄音樣本。
- 存檔：localStorage `sandcastle.save.v1`，內容包含進度、寶藏、設定（`quality` / `tilt` / `hints`）。蓋好的城堡**不會**存檔。
- 測試版：`src/game/Game.js` 的 `UNLOCK_ALL_LEVELS = true`，五關全開。

## 目錄結構

| 路徑 | 職責 |
|---|---|
| `index.html` | 所有靜態 DOM：封面、選單、面板、HUD、拍照列、說明卡；樣式在 `src/style.css` |
| `src/game/Game.js` | 主類別：開機、狀態機、關卡載入、輸入、拾取（pick）、復原、道具擺放、主迴圈 `frame()` |
| `src/game/Tools.js` | 所有工具（`TOOLS` 陣列）、筆刷、水桶塔、城牆、水道、雕刻、沙雕操作 |
| `src/game/Goals.js` | 關卡任務判定與漲潮事件 |
| `src/game/Intro.js` | 片頭運鏡（開場是平坦沙灘，不蓋城堡） |
| `src/game/Photo.js` | 拍照模式：卡通人物「珊珊」、構圖、拍立得合成 |
| `src/game/photo-poses.json` | 各關泳裝每個姿勢的像素高度（用來換算人物尺寸） |
| `src/ui/UI.js` | DOM 綁定：工具列、裝飾與沙雕選單、設定、面板、提示、任務欄 |
| `src/world/Terrain.js` | 沙地高度場與沙子材質（`createSandMaterial`、`sandUniforms`） |
| `src/world/Sculpt.js` | 立體沙雕的體素系統（surface nets 網格化） |
| `src/world/SculptModels.js` + `sculpt-models.json` | 12 種預設大型沙雕的載入器與清單 |
| `src/world/WaterSim.js` | 淺水「虛擬管線」流體：潮汐、碎浪、河流 |
| `src/world/Erosion.js` | 水流侵蝕沙子（擴散 + 坍塌角） |
| `src/world/Environment.js` | 天空、太陽、霧、環境貼圖、海面 |
| `src/world/Scenery.js` / `plants.json` | 外圍地形的椰子樹與植物（交叉面片 instancing） |
| `src/world/Landmarks.js` | 每關地標：棧橋、燈塔、小屋、小船、提基火把（火焰是 shader 卡片） |
| `src/world/Marine.js` | 水中生物（魚群、海龜、魟魚、海豚） |
| `src/world/Props.js` | 18 種裝飾（貝殼等）、旗幟、寶箱、螃蟹窩 |
| `src/world/Critters.js` / `Particles.js` | 小螃蟹 / 沙粒與閃光粒子 |
| `src/world/levels.js` | 5 關定義（地形函式、天空、潮汐、任務）、`SHOWCASE`（標題畫面）、寶藏清單 |
| `src/world/fog.js` / `shaders.js` | 方向性霧（`withFog`）與共用 GLSL |
| `src/fx/Post.js` | 後製管線 |
| `src/audio/AudioEngine.js` | 音樂、樣本載入、`sfx()`、工具循環音效 `brush()` |
| `tools/process_assets.py` | 素材處理：切圖去背（`cut_sheet`）、無縫材質（`tileable`）、法線 |
| `tools/bake_sculptures.py` | 把 GLB 烘焙成 `.sand` 體素檔 |
| `raw/` | 原始下載檔（Higgsfield 圖、GLB），**不在 git 中** |
| `public/assets/` | 遊戲用素材：`img/`、`icons/`、`audio/`、`sculptures/`、`treasures/` |

## 核心系統

### 1. 狀態機與主迴圈（Game.js）

- 狀態流程：`boot → gate`（封面，點擊進入）`→ intro`（片頭）`→ menu → play`。
  - 從 `play` 可進入 `complete`（過關）或 `photo`（拍照模式）；全部破關後是 `ending`。
- 只有 `play` 狀態會把左鍵交給工具（`tools.begin`）；`photo` 狀態下可以轉鏡頭，但工具停用。
- `frame()` 每幀的順序：
  1. 移動鏡頭。
  2. `pick()`（地形 + 沙雕射線）→ `tools.updateCursor` → `tools.move(hit)`（拖曳類工具每幀都要呼叫）→ `tools.update`。
  3. `sculpt.update()`（網格化每幀有時間預算）。
  4. 任務、水模擬、侵蝕。
  5. `terrain.flush()` → `sim.syncGround`。
  6. 道具、生物、環境。
  7. `photo.update()` → `post.render()` → `photo.afterRender()`（這時截圖）。
- `pick()`：先打地形；目前工具會作用在沙雕上時（`tools.reachesSculpture()`），再打沙雕，取較近的。沙雕命中點帶有 `.sculpt` 和 `.normal`。

### 2. 沙地高度場（Terrain.js，`src/core/config.js`）

- 常數：
  - `N=320` 格、`S=0.12` 間距、`HALF≈19.14`。
  - 1 世界單位 ≈ 30 公分（`CM_PER_UNIT`）。
- 陣列：
  - `h`：目前高度。
  - `h0`：原始地形。
  - `mask`：邊緣鎖定權重。
  - `built`：材質用的 `aBuilt` attribute，被動過的沙不顯示風紋。
  - `solid`：上方沙雕的頂高，沒有沙雕時為 `NO_SOLID`。
- `topAt(x, z)` = max(地形, 沙雕頂)。鏡頭、任務、水都會用到。
- 改了 `h` 後要 `markDirty(i0, j0, i1, j1)`，由 `flush()` 重算法線 / AO 並上傳 GPU。
- 「蓋起來的沙」判定：`h - h0 > 0.06`（`Tools.js` 的 `BUILT`）。

### 3. 立體沙雕體素（Sculpt.js）

高度場做不出懸空、側面與內凹，所以沙雕另外用 3D 密度格子：

- 參數：`VOX=0.035`（約 1 公分），稀疏 chunk 每塊 24³，`Uint8` 密度（0 是空氣、255 是實心沙），等值面 0.5。
- 網格化：surface nets；每個 chunk 讀周圍 `PAD=5` 格，用來算平滑法線與兩層 AO。
- 所有編輯都經過 `edit(box, fn)`。它負責：
  - 寫入 undo 紀錄 `rec`。
  - 寫入雕刻用的快照 `strokeSnap`：同一筆雕刻線瞄準的是下筆前的表面，所以不會越刻越深。
  - 標記 dirty chunk、更新邊界與 `topRect`。
- 筆刷：
  - `brushAdd`：堆沙 / 挖沙。
  - `brushSmooth`：抹順。
  - `brushFlatten`：沿平面壓平。
  - `carve`：刻線；emboss 模式是堆出細邊。
  - `addBlock`：方塊、長塊。
  - `addModel`：預設沙雕。
  - `convertStructure`：把高度場上的城堡轉成沙雕，形狀不變，原地高度場降回沙灘。
- **不懸空規則**：`addBlock` / `addModel` 會讓懸空的底部一路填到下方支撐面（地形或下方沙雕，`columnTop` 查詢）。
- `flushTop()` 把沙雕頂高寫進 `terrain.solid`，再呼叫 `onTop`（即 `sim.syncGround`）。所以沙雕會擋水，也會算進高度任務。
- 復原：`Game.pushUndo()` 會呼叫 `sculpt.beginRecord()`；`undo()` 會呼叫 `sculpt.restore(rec)` 再 `flushAll()`。
- 大型編輯（放沙雕、轉換城堡）用 `flushAll()` 同步網格化，一般筆刷靠每幀約 7 毫秒的預算。

### 4. 預設大型沙雕（12 種）

- 清單：海豚、女王頭像、城堡、趴著的貓、美人魚、海龜、章魚、螃蟹、海馬、睡獅、恐龍、海盜船。
- 產製流程：Higgsfield 畫造型圖 → Hunyuan3D v3（`generate_type: Geometry`）轉 GLB → 執行 `python tools/bake_sculptures.py <preview.png>`（需要 `trimesh`、`numpy`、`scipy`、`Pillow`）。
  - 腳本會比對輪廓，自動判斷原圖是從哪一面拍的，讓那一面成為 +Z 正面。
  - 接著體素化、轉成平滑 SDF 密度，再裁切讓底座落在 y=0。
- `.sand` 格式：gzip 壓縮，內容依序為 `b'SCU1'`、`nx, ny, nz`（uint16 LE）、`nx*ny*nz` 個 uint8（x 變化最快）。執行時用 `DecompressionStream` 解壓。
- 每筆資料：`{id, name, size（最長邊的世界單位）, thumb}`。縮圖在 `public/assets/sculptures/thumbs/`。
- 放置在 `Tools.placeModel`：正面朝鏡頭，尺寸 = `size × modelScale()`（0.75～1.4，跟「大小」滑桿連動），底座埋進底下最低的沙。

### 5. 工具（Tools.js）

| 鍵 | id | 名稱 | 說明 |
|---|---|---|---|
| 1 | raise | 堆沙 | 在沙雕上變成 3D 堆沙 |
| 2 | dig | 挖沙 | 會挖到寶藏；在沙雕上變成 3D 挖 |
| 3 | smooth | 抹順 | 高度場 / 沙雕都可用 |
| 4 | flatten | 壓平 | 在沙雕上是沿平面削切 |
| 5 | carve | 雕刻 | 拖曳刻線，Shift 是堆出細邊；在塔樓陡峭側面下刀會自動轉成沙雕 |
| B | sculpt | 沙雕塊 | 選單：方塊 / 長塊 / 12 種大型沙雕；點城堡會轉成沙雕 |
| 6 | tower | 水桶塔 | 拖曳可連續蓋一排；不會削掉相鄰建築；點在塔頂會疊高 |
| 7 | wall | 城牆 | 沿拖曳路徑蓋 |
| 8 | channel | 挖渠 | 沿拖曳路徑挖水道 |
| 9 | decor | 裝飾 | 選單；Ctrl+點擊移除；可貼在沙雕表面 |
| 0 | flag | 旗幟 | 最多 8 面 |

- 拖曳類工具（城牆、挖渠、雕刻）用 `extendPath`，以下筆前的快照為基準。
- 水桶塔是動畫 stamp：連點時新的那座會接管舊 stamp 正在升起的格子；`settleStamps()` 則把升起中的塔一次完成。
- 裝飾與沙雕的選擇視窗選完會收成小標籤（`UI.showPicker(name, open)`）。

### 6. 水、潮汐、侵蝕

- `WaterSim`：`M=160` 格（高度場的一半解析度）的虛擬管線模擬。
- 地面高度取 max(地形, 沙雕)。另存一份 `beach`（只有地形），乾燥格子的水面後備值用它，否則沙雕側面會被誤染成水下色調。
- 漲潮（T 鍵或按鈕）由 `Goals` 驅動。侵蝕只作用在高度場；**沙雕不會被潮水侵蝕**。

### 7. 繪圖

- 沙子材質是 `MeshStandardMaterial` 加上 `onBeforeCompile`，包含：
  - 三平面貼圖、濕沙變深、水下吸收與焦散。
  - 只在 `aBuilt=0`（沒被動過的沙）顯示的風紋。
  - 方向性霧。
- 地形、沙雕、外圍地形共用 `sandUniforms`。
- `withFog(material, key, extra)` 的快取 key 必須隨 `extra` 不同而不同。
- 每關的天空 / 曝光在 `levels.js`，由 `Environment.applyLevel` 套用。

### 8. 音效（AudioEngine.js）

- 樣本在 `loadSamples()` 載入：
  - 海浪循環：`ocean_loop*.wav`。
  - 單次浪花與海鷗：`wash*`、`gulls*`。
  - 四種沙子工具循環：`sand_dig`（挖沙、挖渠）、`sand_pack`（堆沙、城牆）、`sand_smooth`（抹順、壓平）、`sand_scrape`（雕刻）。
- `brush(active, kind)` 每幀被工具呼叫，讓對應的循環淡入；停止呼叫約 0.2 秒後自動淡出。對應表是 `BRUSH_LOOP` / `BRUSH_LEVEL`。
- 海浪音量用 `OCEAN_TRIM`（-4 dB）。
- `sfx(name)` 是短音效，程式合成（thump、shell、shutter 等）。
- ElevenLabs 的音效來源 flow id：`2QuM2cu3c3MhO4RG3eIr`。

### 9. 拍照模式（Photo.js）

- 進入：P 鍵或 📷 按鈕。人物「珊珊」是直立面向鏡頭的立牌；另有一個看不見的分身朝向太陽，負責投出輪廓陰影（材質用 `map + alphaTest`；`customDepthMaterial` 試過無效）。
- 每關泳裝不同：`public/assets/img/photo/l1…l5/pose0…3.png`。姿勢：比 YA、揮手、指著作品（換邊時會翻轉）、蹲下比心。
- 快門在 `afterRender()` 從 canvas 擷取畫面，合成拍立得（關卡名 + 日期），只在畫面上顯示並可下載。**沒有寄信功能**（使用者已取消）。

### 10. UI 與設定

- `UI.js` 綁定 `index.html` 裡的元素。HUD 能點擊靠 CSS 規則 `#hud.show #bottom > *`。
- 設定面板：音樂 / 音效 / 環境音音量、畫質、移軸效果、顯示工具說明（中間那條說明列，預設開）。
- 說明卡按 H 開關，內容在 `index.html` 的 `#help`。

### 11. 關卡（levels.js）

| id | 名稱 | 任務重點 |
|---|---|---|
| 1 | 晨曦海灣 | 高度、2 座塔、4 個裝飾、1 個寶藏 |
| 2 | 珊瑚潟湖 | 城牆長度、4 座塔、高處插旗、寶藏 |
| 3 | 棕櫚小島 | 引水到標記、3 座塔、漲潮後旗子不倒 |
| 4 | 沙洲屏障 | 保護螃蟹窩撐過漲潮、6 個裝飾、2 座塔 |
| 5 | 夕陽三角洲 | 5 座塔、城牆、高度、漲潮守旗、寶藏 |

## 操作

| 輸入 | 功能 |
|---|---|
| 左鍵 | 使用工具 |
| 右鍵拖曳 | 旋轉視角 |
| Shift+右鍵 | 平移 |
| 滾輪 | 縮放 |
| WASD | 移動 |
| Q / E | 旋轉 |
| 1–0、B | 切換工具 |
| `[` `]` 或 Alt+滾輪 | 調整筆刷大小 |
| F | 把視角中心移到游標處，雕刻細節時好用 |
| P | 拍照模式 |
| T | 迎接漲潮 |
| H | 說明 |
| Ctrl+Z | 復原 |
| Esc | 暫停 / 離開拍照 |

## 在預覽裡測試的技巧

- 直接操作 `window.__game`（底下簡寫為 `g`）。常用設定：
  - `g.persist = () => {}`：避免汙染存檔。
  - `document.querySelector('#gate').classList.add('hidden')`，再 `await g.startLevel(i)`。
  - `g.clock.getDelta = () => 1/30` 加上手動呼叫 `g.frame()`：逐幀推進。
- 模擬滑鼠拖曳：
  - 對 `g.renderer.domElement` 發送 `PointerEvent`。
  - 先 stub 掉 `setPointerCapture`。
  - 用 `camera.project` 換算螢幕座標。
- 預覽面板太小或隱藏時 `innerWidth` 可能是 0，先固定視窗大小（例如 1280×720）。
- 截圖可能是舊畫面，重新整理或多跑幾幀再截。
- 改到 `Sculpt.js`、`Game.js` 這類模組會觸發整頁重新載入，測試輔助函式要重建。
- 鏡頭目標的 y 會被拉回地面附近（`moveCamera`；沙雕上方則可停在沙雕高度範圍內）。要特寫高處時可暫時 stub `g.moveCamera`。

## 已知陷阱（踩過的坑）

- `BufferAttribute.addUpdateRange` 會累積，**不要**呼叫 `clearUpdateRanges`；three 上傳後會自己清。
- 拖曳類工具依賴 `frame()` 裡的 `tools.move(hit)`；少了它，城牆和挖渠只會蓋一點。
- 沙雕底部懸空違反物理，新放置的東西都要經過支撐填充（`support` 參數）。
- `src/style.css` 的規則特異度：`.modal-card` 等通用規則寫在後面，新增的卡片樣式要提高特異度（例如 `.modal-card.photo-card`）。
- 去背：Higgsfield 白底圖用從邊緣 flood fill 的方式（`cut_sheet`），手臂與身體之間被包住的白色區域要另外依面積判斷（見拍照人物的切圖）。
- 合成音效容易被使用者嫌不自然；需要聲音時優先用 ElevenLabs 生成真實錄音。

## 已知限制與可能的下一步

- 沙雕不會被潮水侵蝕；蓋好的作品不會存檔。
- 預設沙雕的細節精度約 4 公分（烘焙解析度最長邊 128 格）；放置時畫面會頓約 0.1～0.6 秒。
- README 的操作說明較舊，可以依本文件更新。
