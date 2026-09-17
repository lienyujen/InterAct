# InterAct 即時互動教學系統

InterAct stands for Intelligent Teaching, Engagement, Response and Classroom Technology.

InterAct 是提供教師、講師、訓練師與演講者使用的即時課堂互動系統。講師在 Windows 或 macOS 上建立場次，學員掃描 QR Code 後即可用手機瀏覽器加入，不需要安裝 App。

## 主要功能

十二種題型，全部從**截圖派題**出發 —— 把螢幕上正在講的東西框起來，當場就是一道題，不必事先做成投影片：

- 派送畫面：把老師螢幕上的一塊送到每個人手上，後排看不清楚的問題一鍵解決
- 圖上點選：學生在圖片上點，老師端把全班的點疊回原圖，看見錯在哪裡而不只是錯幾題
- 投票、選擇題、是非題、問答題
- 排序題與配對題：手機、平板、觸控螢幕都能拖曳作答
- 自訂測驗：AI 讀截圖或檔案，直接出一份含選擇、填充、簡答的考卷
- 上傳作答：手寫算式、作文、素描拍照上傳
- 口語表達與朗讀發音：全班同時錄音

**課堂節奏**

- 作答倒數，隨時停止與恢復作答
- 再做一次：同一題開第二輪，直接對照幾人改了答案、改對幾人
- 抽籤、只抽未作答的人、搶答

**聽得到、看得懂**

- 即時字幕與同步口譯
- 題目自動雙語顯示，學生自行切換語言
- 即時彈幕、文字雲與匿名模式

**AI 協助**

- 一次批改全班的上傳作答；問答題收齊後一次讀完全班的文字，歸納理解程度與共同迷思
- 口語與朗讀評測：逐字稿、分數與三面向評語
- 單題迷思分析與整節課完整報告
- Exit Ticket 依當天實際上到的內容生成

**下課之後**

- Excel 完整報表匯出：總覽加十一張明細工作表
- 參與度計分與徽章
- 免部署學員端：加入連結自帶專案資訊，掃碼即用

每一項功能在課堂上解決什麼問題、哪些步驟用了 AI，請見 [`docs/InterAct-教學功能手冊.md`](docs/InterAct-教學功能手冊.md)。

## 技術架構

- React、TypeScript、Vite：學員端網站
- Electron：Windows 講師端
- Supabase：Database、Realtime、Storage、Edge Functions
- Google Gemini：出題、批改、翻譯、題目分析與整節課報告
- Gemini Live 或 OpenAI Realtime：即時字幕與同步口譯（二擇一）
- SortableJS：排序題與配對題的跨裝置拖曳
- ExcelJS：報表匯出
- Reurl.cc：縮短加入網址（選用）

## 快速開始（不需要開發環境）

1. 從 [Releases](https://github.com/lienyujen/InterAct/releases) 下載講師端：
   - **Windows 10/11（64 位元）**：`InterAct.zip`，解壓後執行裡面的 `InterAct.exe`，免安裝。
   - **macOS**：`InterAct.dmg`，拖進「應用程式」即可（Apple Silicon 與 Intel 通用）。
2. 在 [Supabase](https://supabase.com/dashboard) 免費建立一個專案。
3. 開啟 InterAct，出現設定畫面時填入專案識別碼與 publishable key。
4. 展開「還沒建立後端？讓 InterAct 幫你部署」，貼上一組
   [Supabase 存取權杖](https://supabase.com/dashboard/account/tokens)與 Gemini API key，按下自動部署。

macOS 首次開啟要多做兩件事，之後不必再做：安裝檔未經 Apple 簽章，請到「系統設定 → 隱私權與安全性」按「強制打開」；
並在「隱私權與安全性 → 螢幕錄製」開啟 InterAct 後**重新啟動 InterAct**，截圖派題才會有畫面。

InterAct 會替你建立資料表、部署 Edge Functions 並設定金鑰，不需要安裝 Node 或 Supabase CLI。
建議使用 fine-grained token 並只勾選該專案的 Edge Functions 寫入與資料庫權限；權杖只在部署當下使用，不會被儲存。

學員端不必自行部署 —— QR Code 會帶上你的專案識別碼，共用學員端會連回你自己的 Supabase。

## 本機開發

1. 執行 `pnpm install` 安裝相依套件。
2. 依照 `.env.example` 建立自己的 `.env`，填入 Supabase 網址與 publishable key（`VITE_PUBLIC_APP_URL` 選填，不填則使用共用學員端）。
3. 執行 `pnpm dev` 啟動網頁開發環境。
4. 執行 `pnpm desktop:dev` 啟動 Windows 講師端開發環境。

## 建置與打包

```bash
pnpm lint
pnpm build
pnpm desktop:package
```

`pnpm desktop:package` 會在 `release/` 產生 Windows x64 版本；在 Mac 上執行 `pnpm desktop:package:mac` 會產生 Apple Silicon 與 Intel 通用的 `InterAct.dmg`（macOS 版只能在 macOS 上打包）。新手可使用自動化腳本，完成後會把 `InterAct.exe` 複製到專案根目錄：

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\package-windows.ps1 -SupabaseUrl https://YOUR_PROJECT_REF.supabase.co -PublishableKey sb_publishable_YOUR_VALUE -PublicAppUrl https://YOUR_GITHUB_USER.github.io/InterAct
```

## 自行部署（進階）

想用 CLI 自行掌控每個步驟，或要打包自己的執行檔時，每位部署者都必須使用自己的服務帳號，避免共用開發者的額度與課堂資料：

1. Supabase：資料庫、Realtime、Storage 與 Edge Functions。
2. Google AI Studio：Gemini API key，只存於 Supabase secret。
3. Reurl.cc：短網址 API key，只存於 Supabase secret（選用）。
4. OpenAI：即時字幕與同步口譯用，只存於 Supabase secret（選用，依音訊時長計費）。
5. Windows 或 macOS：把自己的公開設定打包進 `InterAct.exe` 或 `InterAct.dmg`。

**學員端網頁不需要自行部署。** 加入連結會帶著你的 Supabase 專案識別碼，共用的學員端會據此連到你的專案，課堂資料不會混在一起。

完整繁體中文教學請見 [`docs/InterAct-從零部署與打包教學.md`](docs/InterAct-從零部署與打包教學.md)。可安裝 [`interact-self-deploy`](skills/interact-self-deploy/SKILL.md) skill，讓 Codex 依序引導部署：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-deployment-skill.ps1
```

不要把 Gemini key、Reurl key、Supabase secret key、service-role key 或 GitHub token 放入 `.env`、GitHub Pages variables、前端程式、截圖或公開訊息。

學員端固定顯示 InterAct 作者的 [Facebook](https://www.facebook.com/lienyujen) 與 [YouTube](https://www.youtube.com/@lienlaoshi) 連結。

## 自行託管學員端

預設情況下，QR Code 指向共用的學員端網頁 `https://join.ehuayu.org`。（1.4.0 以前的版本指向 `https://lienyujen.github.io/InterAct`，該網址仍然有效。）它只是一份靜態網頁，會依照加入連結上的參數連到**你自己的** Supabase 專案 —— 你的課堂資料不會經過作者的專案。

想改用自己的網址，打包前設定：

```
VITE_PUBLIC_APP_URL=https://你的帳號.github.io/你的repo
```

任何靜態空間都可以（GitHub Pages、Cloudflare Pages、Netlify⋯），把 `pnpm build` 產生的 `dist/` 放上去即可。

**商業使用者請自行託管。** GitHub 的服務條款不允許把 Pages 當成免費空間用於商業用途，所以補習班、企業內訓與收費課程請部署自己的學員端，不要使用共用網址。Cloudflare Pages 免費方案沒有商業限制，是合適的選擇。

## 容量與限制

同時上線人數的瓶頸**不在學員端網頁**，而在你自己的 Supabase 專案。

學員端是靜態檔案、透過 CDN 供應，沒有同時連線上限；GitHub Pages 的 100 GB/月頻寬換算約可負擔 40 萬次首次載入，且瀏覽器會快取。

真正的限制是 Supabase 的 **Realtime 同時連線數**：

| | 免費方案 | Pro（每月 $25）|
|---|---|---|
| Realtime 同時連線 | **200** | 500，超出每千條 $10 |
| Realtime 訊息 | 200 萬/月 | 500 萬/月 |
| Edge Function 呼叫 | 50 萬/月 | 200 萬/月 |
| 資料庫 | 500 MB | 8 GB |
| 儲存空間 | 1 GB | 100 GB |

每位在線學員會佔用一至數條連線，一堂 50 人的課約需 60–80 條。因此**免費方案大致可支撐 150 人同時上課，或兩三堂課並行**；超過就會開始掉連線，需要升級 Pro。

實際數字請以 [Supabase 定價頁](https://supabase.com/pricing) 為準。

## 授權

本專案採用 [PolyForm Noncommercial 1.0.0](LICENSE)。

**可以自由使用、修改、散布**：個人、學校與教育機構、公立研究單位、政府機關、非營利組織 —— 不論經費來源。

**不可用於商業目的**：包含把本軟體或其修改版本用於營利服務、納入付費產品，或以此收費。

以下情況**均屬商業用途**，需取得商業授權：

- 補習班、才藝班等營利教育機構
- 企業內訓講師（含受企業委託授課的外部講師）
- 收費線上課程、付費工作坊、付費研習
- 自行修改內容並以其營利，有此需求請與作者聯絡

### 取得商業授權

前三項商業使用者請依自身規模自由樂捐：

**https://www.paypal.com/paypalme/lienyujen**

**LINE Bank 銀行帳戶：824 連線商業銀行（總行 6880），帳號： 111011583074**

**付款後請留存收據**，該收據即為你的商業使用授權證明。金額由你依使用規模自行斟酌，沒有固定價目。

**第四項不適用樂捐，收據也不構成授權。** 把整套拿去改成自己的產品，必須另外取得作者書面授權，請先與作者聯絡。

除前三項純教學用途外，有其他授權需求或疑問，請直接與作者聯繫。

散布修改版本時，務必一併保留 `LICENSE` 檔案與其中的 `Required Notice:` 版權標示。
