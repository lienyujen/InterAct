# InterAct 即時互動教學系統

InterAct stands for Intelligent Teaching, Engagement, Response and Classroom Technology.

InterAct 是提供教師、講師、訓練師與演講者使用的即時課堂互動系統。講師在 Windows 端建立場次，學員掃描 QR Code 後即可用手機瀏覽器加入，不需要安裝 App。

## 主要功能

- 即時彈幕、匿名切換與文字雲
- 桌面區域截圖派題
- 投票、選擇、是非、問答、朗讀發音與口語表達
- 文字與網址派送
- 抽籤、搶答與 Exit Ticket
- Gemini 題目分析與整節課報告
- Excel 完整報表匯出
- 免部署學員端：加入連結自帶專案資訊，掃碼即用

## 技術架構

- React、TypeScript、Vite：學員端網站
- Electron：Windows 講師端
- Supabase：Database、Realtime、Storage、Edge Functions
- Google Gemini：題目與課堂互動分析
- Reurl.cc：縮短加入網址（選用）

## 快速開始（不需要開發環境）

1. 從 [Releases](https://github.com/lienyujen/InterAct/releases) 下載 `InterAct.zip`，解壓後執行裡面的 `InterAct.exe`。
2. 在 [Supabase](https://supabase.com/dashboard) 免費建立一個專案。
3. 開啟 InterAct，出現設定畫面時填入專案識別碼與 publishable key。
4. 展開「還沒建立後端？讓 InterAct 幫你部署」，貼上一組
   [Supabase 存取權杖](https://supabase.com/dashboard/account/tokens)與 Gemini API key，按下自動部署。

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

`pnpm desktop:package` 會在 `release/` 產生 Windows x64 版本。新手可使用自動化腳本，完成後會把 `InterAct.exe` 複製到專案根目錄：

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\package-windows.ps1 -SupabaseUrl https://YOUR_PROJECT_REF.supabase.co -PublishableKey sb_publishable_YOUR_VALUE -PublicAppUrl https://YOUR_GITHUB_USER.github.io/InterAct
```

## 自行部署（進階）

想用 CLI 自行掌控每個步驟，或要打包自己的執行檔時，每位部署者都必須使用自己的服務帳號，避免共用開發者的額度與課堂資料：

1. Supabase：資料庫、Realtime、Storage 與 Edge Functions。
2. Google AI Studio：Gemini API key，只存於 Supabase secret。
3. Reurl.cc：短網址 API key，只存於 Supabase secret（選用）。
4. OpenAI：即時字幕與同步口譯用，只存於 Supabase secret（選用，依音訊時長計費）。
5. Windows：把自己的公開設定打包進 `InterAct.exe`。

**學員端網頁不需要自行部署。** 加入連結會帶著你的 Supabase 專案識別碼，共用的學員端會據此連到你的專案，課堂資料不會混在一起。

完整繁體中文教學請見 [`docs/InterAct-從零部署與打包教學.md`](docs/InterAct-從零部署與打包教學.md)。可安裝 [`interact-self-deploy`](skills/interact-self-deploy/SKILL.md) skill，讓 Codex 依序引導部署：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-deployment-skill.ps1
```

不要把 Gemini key、Reurl key、Supabase secret key、service-role key 或 GitHub token 放入 `.env`、GitHub Pages variables、前端程式、截圖或公開訊息。

學員端固定顯示 InterAct 作者的 [Facebook](https://www.facebook.com/lienyujen) 與 [YouTube](https://www.youtube.com/@lienlaoshi) 連結。

## 自行託管學員端

預設情況下，QR Code 指向共用的學員端網頁 `https://lienyujen.github.io/InterAct`。它只是一份靜態網頁，會依照加入連結上的參數連到**你自己的** Supabase 專案 —— 你的課堂資料不會經過作者的專案。

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

### 取得商業授權

商業使用者請依自身規模自由樂捐：

**https://www.paypal.com/paypalme/lienyujen**

**付款後請留存收據**，該收據即為你的商業使用授權證明。金額由你依使用規模自行斟酌，沒有固定價目。

有其他授權需求或疑問，歡迎直接與作者聯繫。

散布修改版本時，請一併保留 `LICENSE` 檔案與其中的 `Required Notice:` 版權標示。
