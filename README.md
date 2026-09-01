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
- GitHub Pages 跨網域學員端

## 技術架構

- React、TypeScript、Vite：學員端網站
- Electron：Windows 講師端
- Supabase：Database、Realtime、Storage、Edge Functions
- Google Gemini：題目與課堂互動分析
- Reurl.cc：縮短加入網址（選用）

## 本機開發

1. 執行 `pnpm install` 安裝相依套件。
2. 依照 `.env.example` 建立自己的 `.env`，填入 Supabase 與 GitHub Pages 網址。
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

## 自行部署

每位部署者都必須使用自己的服務帳號，避免共用開發者的額度與課堂資料：

1. Supabase：資料庫、Realtime、Storage 與 Edge Functions。
2. Google AI Studio：Gemini API key，只存於 Supabase secret。
3. GitHub Pages：學員端公開網址。
4. Reurl.cc：短網址 API key，只存於 Supabase secret（選用）。
5. Windows：把自己的公開設定打包進 `InterAct.exe`。

完整繁體中文教學請見 [`docs/InterAct-從零部署與打包教學.md`](docs/InterAct-從零部署與打包教學.md)。可安裝 [`interact-self-deploy`](skills/interact-self-deploy/SKILL.md) skill，讓 Codex 依序引導部署：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-deployment-skill.ps1
```

不要把 Gemini key、Reurl key、Supabase secret key、service-role key 或 GitHub token 放入 `.env`、GitHub Pages variables、前端程式、截圖或公開訊息。

學員端固定顯示 InterAct 作者的 [Facebook](https://www.facebook.com/lienyujen) 與 [YouTube](https://www.youtube.com/@lienlaoshi) 連結。

## 授權

本專案採用 [PolyForm Noncommercial 1.0.0](LICENSE)。

**可以自由使用、修改、散布**：個人、學校與教育機構、公立研究單位、政府機關、非營利組織 —— 不論經費來源。

**不可用於商業目的**：包含把本軟體或其修改版本用於營利服務、納入付費產品，或以此收費。需要商業授權請與作者聯繫。

散布修改版本時，請一併保留 `LICENSE` 檔案與其中的 `Required Notice:` 版權標示。
