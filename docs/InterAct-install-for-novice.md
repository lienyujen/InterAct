# InterAct 從零部署與打包完整教學

這份教材給第一次接觸程式、終端機、資料庫與 API 的 Windows 使用者。照順序完成即可，不需要先學會寫程式。

> 適用版本：InterAct Windows x64 portable 版  
> 最後更新：2026-07-22  
> 重要：每位講師都要使用自己的 Supabase、Gemini、GitHub 與 Reurl 帳號，不要共用別人的 API key 或資料庫。

## 一、先理解會建立什麼

InterAct 不是只有一個 EXE。完整系統由四項雲端服務與一個 Windows 程式組成：

| 元件 | 用途 | 學員是否直接接觸 |
| --- | --- | --- |
| Supabase | 場次、姓名、回答、即時同步、圖片及後端函式 | 會透過網頁連線 |
| Gemini API | 圖片題目、問答及整堂課分析 | 不會看到 API key |
| GitHub Pages | 放置學員掃 QR Code 後開啟的網頁 | 會直接開啟 |
| Reurl.cc | 把很長的學員網址縮短 | 會看到短網址 |
| `interact.exe` | 講者端 Windows 程式 | 只有講者使用 |

打包完成後，學員不需要安裝程式，只需用瀏覽器開啟網址。講者電腦也不必另裝 Node.js 才能執行已打包的 `interact.exe`。

## 二、準備帳號與電腦

### 2.1 電腦需求

- Windows 10 或 Windows 11，64 位元。
- 穩定網路。
- 至少保留 3 GB 磁碟空間。
- 建議把專案解壓縮到簡單路徑，例如 `C:\InterAct`，不要放在雲端同步資料夾。

### 2.2 建立四個帳號

1. [GitHub](https://github.com/signup)
2. [Supabase](https://supabase.com/dashboard)
3. [Google AI Studio](https://aistudio.google.com/)
4. [Reurl.cc](https://reurl.cc/main/tw)

各服務的免費額度與收費規則可能調整，正式使用前請在各服務的 Pricing 頁面確認。所有 Gemini 呼叫都會計入建立該 key 的 Google 專案額度。

## 三、取得 InterAct 原始碼

1. 登入 GitHub。
2. 開啟 [InterAct 專案](https://github.com/lienyujen/InterAct)。
3. 按右上角 **Fork**。
4. Owner 選自己的 GitHub 帳號。
5. Repository name 建議保留 `InterAct`。
6. 按 **Create fork**。
7. 進入自己的 fork，按 **Code**，再按 **Download ZIP**。
8. 將 ZIP 解壓縮到 `C:\InterAct`。如果解壓縮後多一層 `InterAct-main`，也可以直接使用該資料夾。

以下所有指令都要在「包含 `package.json` 的那一層資料夾」執行。

## 四、安裝必要工具

### 4.1 安裝 Node.js 24 LTS

1. 開啟 [Node.js 官方下載頁](https://nodejs.org/en/download)。
2. 選擇 **v24 LTS** 的 Windows 64-bit Installer。
3. 使用預設選項完成安裝。
4. 關閉所有 PowerShell 或 Terminal 視窗，再重新開啟。
5. 輸入：

```powershell
node --version
npm --version
```

成功時，`node --version` 應顯示 `v24...`。

### 4.2 安裝 pnpm 11

在 PowerShell 輸入：

```powershell
npm install -g pnpm@11.7.0
pnpm --version
```

成功時應顯示 `11.7.0`。

### 4.3 安裝 GitHub CLI

在 PowerShell 輸入：

```powershell
winget install --id GitHub.cli --source winget
```

安裝後關閉整個 Terminal 視窗，再重新開啟，輸入：

```powershell
gh --version
gh auth login
```

登入時依序選擇：

1. `GitHub.com`
2. `HTTPS`
3. 使用瀏覽器登入
4. 在瀏覽器確認授權

如果電腦沒有 `winget`，可改用 [GitHub CLI 官方 Windows MSI](https://cli.github.com/)。

## 五、開啟正確的 PowerShell 位置

1. 用檔案總管開啟 InterAct 資料夾。
2. 確認看得到 `package.json`、`src`、`supabase`、`skills`。
3. 在資料夾空白處按右鍵，選 **在終端機中開啟**。
4. 輸入：

```powershell
Get-Location
Get-ChildItem package.json
```

第二行若能列出 `package.json`，位置就正確。

## 六、建立並部署 Supabase

> 這個步驟只能用在全新、空白的 Supabase 專案。已經有正式資料的專案不要重跑初始化腳本。

### 6.1 建立專案

1. 開啟 [Supabase Dashboard](https://supabase.com/dashboard)。
2. 按 **New project**。
3. 專案名稱可填 `InterAct`。
4. 建立一組 Database Password，放在密碼管理器中。
5. Region 選擇靠近主要使用地區的位置。
6. 等待專案建立完成。

### 6.2 抄下三個正確值

在 Supabase 專案的 **Connect** 或 **Project Settings > API Keys** 找到：

| 名稱 | 正確格式 | 用途 |
| --- | --- | --- |
| Project ref | 20 個小寫英數字 | CLI 部署 |
| Project URL | `https://xxxxxxxxxxxxxxxxxxxx.supabase.co` | 網頁與 EXE |
| Publishable key | `sb_publishable_...` | 網頁與 EXE |

Project ref 也可從 Dashboard 網址的 `/project/` 後方找到。

以下是錯誤例子，不可當 Project URL：

```text
https://supabase.com/dashboard/project/xxxxxxxxxxxxxxxxxxxx/settings/api-keys
```

絕對不要使用或分享 `sb_secret_...`、`service_role`、Database Password。Publishable key 本來就是給網頁與桌面程式使用，但資料安全仍依賴專案內的 RLS 規則。

### 6.3 登入 Supabase CLI

在 InterAct 資料夾的 PowerShell 輸入：

```powershell
pnpm dlx supabase login
```

瀏覽器開啟後完成授權，再回到 PowerShell。

### 6.4 部署資料庫與核心函式

把下方 `YOUR_PROJECT_REF` 換成自己的 20 字元 Project ref，不要保留大括號或引號：

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\deploy-supabase.ps1 -ProjectRef YOUR_PROJECT_REF
```

過程若要求 Database Password，就輸入建立專案時保存的密碼。輸入密碼時畫面不顯示字元是正常現象。

### 6.5 Supabase 成功檢查

回到 Supabase Dashboard，逐項確認：

- Table Editor 看得到 `sessions`、`participants`、`messages`、`questions`、`answers`、`session_events` 等資料表。
- Storage 看得到 `interact-screenshots`。
- Edge Functions 看得到 `create-session`、`participant-action`、`presenter-action`。

三項都成功才進入下一步。

## 七、建立並部署 Gemini API

### 7.1 建立 Gemini key

1. 開啟 [Google AI Studio API Keys](https://aistudio.google.com/app/apikey)。
2. 使用自己的 Google 帳號登入並接受條款。
3. 建立或選擇自己的 Google Cloud project。
4. 按 **Create API key**。
5. 複製新 key，暫時保留在剪貼簿或密碼管理器。

請使用新建立的 auth key。不要把 Gemini key 放進 `.env`、GitHub Variables、前端程式、教學截圖、Email 或通訊軟體。

### 7.2 部署 Gemini secret 與 AI 函式

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\deploy-gemini.ps1 -ProjectRef YOUR_PROJECT_REF
```

看到提示後貼上 Gemini key，再按 Enter。安全輸入模式不顯示任何字元，這是正常的。腳本會把 key 存進 Supabase Edge Function secrets，並部署所有 AI 函式。預設模型為 `gemini-3.6-flash`。

如果該 Google 專案無法使用預設模型，先在 AI Studio 查明可用模型，再使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\deploy-gemini.ps1 -ProjectRef YOUR_PROJECT_REF -Model 可用的模型名稱
```

## 八、部署 GitHub Pages 學員端

### 8.1 啟用 fork 的 Actions

1. 回到自己 fork 的 GitHub repository。
2. 點 **Actions**。
3. 如果看到停用提示，按 **I understand my workflows, go ahead and enable them**。
4. 到 **Settings > Pages**。
5. Build and deployment 的 Source 選 **GitHub Actions**。

### 8.2 決定公開網址

若 GitHub 帳號是 `teacherlin`，repository 是 `InterAct`，公開網址就是：

```text
https://teacherlin.github.io/InterAct
```

不要在公開網址後面加 `/#/join/...`。

### 8.3 寫入 GitHub Variables 並啟動部署

以下指令必須整行輸入，替換四個自己的值：

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\configure-github-pages.ps1 -Repository GITHUB帳號/InterAct -SupabaseUrl https://YOUR_PROJECT_REF.supabase.co -PublishableKey sb_publishable_你的值 -PublicAppUrl https://GITHUB帳號.github.io/InterAct
```

這三個 GitHub Variables 是：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PUBLIC_APP_URL`

它們都是前端公開設定。Gemini 與 Reurl key 不可放在這裡。

### 8.4 GitHub Pages 成功檢查

1. Repository 點 **Actions**。
2. 點 `Deploy to GitHub Pages`。
3. 等待 build 與 deploy 都出現綠色勾勾。
4. 開啟自己的 `https://帳號.github.io/InterAct`。

看到 InterAct 頁面即表示學員網站已上線。第一次部署可能需要幾分鐘。

## 九、部署 Reurl.cc 短網址

Reurl 不是網站主機，只負責把 GitHub Pages 長網址縮短。未設定 Reurl 時 InterAct 仍可使用，只是會顯示長網址。

### 9.1 取得 API key

1. 登入 [Reurl.cc](https://reurl.cc/main/tw)。
2. 開啟 [API 文件](https://reurl.cc/main/dev/doc/tw)。
3. 按 **登入查看 ApiKey**。
4. 複製自己的 API key。

Reurl 官方目前標示 Web API 每位使用者每日 100 次，規則日後可能調整。

### 9.2 部署 Reurl secret 與函式

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\deploy-reurl.ps1 -ProjectRef YOUR_PROJECT_REF
```

看到提示後貼上 Reurl API key，再按 Enter。畫面不顯示字元是正常的。

### 9.3 Reurl 成功檢查

Reurl 會把結果快取在場次資料中，因此部署完成後必須建立「全新場次」。QR Code 下方若出現 `https://reurl.cc/...` 即成功。

## 十、打包 Windows `interact.exe`

### 10.1 執行自動打包腳本

將下方三個值換成自己的資料，整行輸入：

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\package-windows.ps1 -SupabaseUrl https://YOUR_PROJECT_REF.supabase.co -PublishableKey sb_publishable_你的值 -PublicAppUrl https://GITHUB帳號.github.io/InterAct
```

腳本會依序：

1. 建立本機 `.env`。
2. 安裝鎖定版本的程式套件。
3. 檢查並建置 React 網頁。
4. 在 Windows 暫存區壓縮 Electron portable 程式。
5. 將完成品複製到專案根目錄，檔名為 `interact.exe`。

第一次可能需要 5 到 15 分鐘。看到 `description is missed`、`author is missed`、`default Electron icon is used` 是提示，不是打包失敗。

### 10.2 打包成功標準

回到 InterAct 資料夾，應看到：

```text
interact.exe
```

檔案通常約 90 MB。雙擊後應可建立場次，QR Code 必須指向自己的 GitHub Pages 網址。

### 10.3 Windows 安全警告

目前測試版沒有商業程式碼簽章，因此從網路下載後可能出現 Microsoft Defender SmartScreen「Windows 已保護您的電腦」。只有在檔案來自可信任來源且已核對雜湊時才繼續執行。公開產品化時應採用 Microsoft Store 或可信任的程式碼簽章方案，不應長期要求一般使用者略過警告。

## 十一、完整驗收

至少準備一台 Windows 講者電腦與一支不在同一網路的手機，依序測試：

- [ ] `interact.exe` 能開啟並建立場次。
- [ ] QR Code 與短網址能從手機開啟。
- [ ] 學員可以輸入姓名並加入。
- [ ] 講者端顯示正確在線人數。
- [ ] 彈幕能送出、關閉及切換匿名。
- [ ] 文字與網址派送正常。
- [ ] 多選、是非、問答、投票題正常。
- [ ] 截圖可跨螢幕框選並派送。
- [ ] 停止作答後 AI 分析正常。
- [ ] 抽籤與搶答正常。
- [ ] Exit Ticket 與整堂課報告正常。
- [ ] Excel 報表可匯出並開啟。
- [ ] 學員端 Facebook 與 YouTube 圖示可開新分頁。

## 十二、最常見問題

### `node`、`pnpm` 或 `gh` 不是可辨識的命令

關閉整個 PowerShell 或 Windows Terminal，再開新視窗。仍失敗就重新安裝對應工具。

### 找不到 `package.json`

PowerShell 開錯資料夾。回到檔案總管，進入真正包含 `package.json` 的那一層，再選「在終端機中開啟」。

### `ProjectRef` 驗證失敗

Project ref 必須是 Supabase Dashboard 網址 `/project/` 後的 20 字元，不是專案名稱，也不是完整 URL。

### Supabase 網址錯誤

正確格式只有：

```text
https://YOUR_PROJECT_REF.supabase.co
```

不要使用 `supabase.com/dashboard/...`。

### GitHub Actions 顯示 Missing repository variable

重新執行第八章的 `configure-github-pages.ps1`，並確認 `-Repository` 是自己的 `帳號/repository`。

### GitHub Pages 顯示 404

確認 Settings > Pages 的 Source 是 GitHub Actions，Actions 頁面的 build 與 deploy 都是綠色勾勾，並等待數分鐘後按 `Ctrl + F5`。

### AI 顯示未設定或模型不存在

重新執行 `deploy-gemini.ps1`。確認 key 是新建立的 Gemini key，且指定模型確實出現在該 AI Studio 專案的可用模型中。

### QR Code 仍顯示長網址

重新執行 `deploy-reurl.ps1`，然後建立新場次。舊場次會保留原本快取結果。

### 打包時出現 `EPERM` 或 `EBUSY`

先關閉所有 InterAct 程式，再重跑 `package-windows.ps1`。此腳本已使用 Windows 暫存區打包，可避開大多數 Dropbox 或 OneDrive 鎖檔問題。

### 無法覆蓋 `interact.exe`

代表舊的 InterAct 還在執行。開啟工作管理員，結束 `InterAct` 後再打包。

## 十三、更新與換 key

- 只換 Gemini key：重跑 `deploy-gemini.ps1`。
- 只換 Reurl key：重跑 `deploy-reurl.ps1`，並用新場次測試。
- 換 Supabase 專案：必須重新完成 Supabase、Gemini、GitHub、Reurl 與 Windows 打包五階段。
- 換 GitHub 帳號或 repository 名稱：重跑 GitHub Pages 設定與 Windows 打包。
- 取得新版原始碼：重新下載最新版 ZIP，再使用自己的值重新打包。
- 不要對已有正式資料的 Supabase 專案重跑全新資料庫初始化；更新資料庫前應先備份並依新版 migration 操作。

## 十四、安全與隱私底線

- `sb_publishable_...` 可放在前端；`sb_secret_...`、`service_role` 與 Database Password 絕對不可。
- Gemini 與 Reurl key 只能存在 Supabase secrets。
- 不要把任何秘密 key 貼到聊天、Issue、README、GitHub Variables、截圖或教學影片。
- 每位講師使用自己的 Supabase，可避免不同講師的姓名與課堂資料混在一起。
- Gemini 分析會處理題目截圖與學員回答；使用前應依組織規範告知參與者，避免輸入個資或敏感資料。
- 目前版本適合封閉測試，不應直接承載醫療、財務、未公開商業或其他高度敏感資訊。

## 官方參考資料

- [Node.js 下載與 LTS](https://nodejs.org/en/download)
- [pnpm Windows 安裝](https://pnpm.io/installation)
- [GitHub CLI](https://cli.github.com/)
- [Supabase Edge Functions 部署](https://supabase.com/docs/guides/functions/deploy)
- [Supabase API key 類型](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Gemini API key](https://ai.google.dev/gemini-api/docs/api-key)
- [GitHub Actions Variables](https://docs.github.com/en/actions/concepts/workflows-and-actions/variables)
- [GitHub Pages 自訂 Actions workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Reurl.cc API 文件](https://reurl.cc/main/dev/doc/tw)
- [Microsoft SmartScreen 與程式簽章](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
