# InterAct macOS 從零部署、簽章與公證完整教學

這份教材給第一次接觸程式、終端機、資料庫與 API 的 Mac 使用者。請照順序完成，每完成一個檢查點再進入下一章。

> 適用版本：InterAct macOS universal DMG（Apple Silicon 與 Intel）
> 最後更新：2026-07-23
> 發布方式：Developer ID 簽章、Apple notarization、GitHub Releases 直接下載
> 重要：每位講師都必須使用自己的 Supabase、Gemini、GitHub、Reurl.cc 與 Apple Developer 帳號。

## 一、完成後會有什麼

InterAct 由四項雲端服務和一個 Mac 講者程式組成：

| 元件 | 用途 | 學員是否直接使用 |
| --- | --- | --- |
| Supabase | 場次、姓名、回答、即時同步、圖片及後端函式 | 透過網頁間接連線 |
| Gemini API | 圖片題目、簡答及整堂課分析 | 不會看到 API key |
| GitHub Pages | 放置學員掃 QR Code 後開啟的網頁 | 會直接開啟 |
| Reurl.cc | 將很長的學員網址縮短 | 會看到短網址 |
| `InterAct.app`／DMG | 講者端程式、畫面截取及控制介面 | 只有講者使用 |

GitHub Actions 會在 Apple 的 Mac runner 上建立一份 universal DMG，完成 Developer ID 簽章與 Apple 公證，再放到 GitHub Releases。一般使用者可從 Releases 下載，不需要安裝 Node.js。

## 二、準備帳號與 Mac

### 2.1 Mac 需求

- 建議使用仍由 Apple 支援的 macOS 版本。
- Apple Silicon（M 系列）或 Intel Mac 均可。
- 至少保留 5 GB 可用空間。
- 穩定網路。
- 若需要在本機測試，必須能使用「終端機」。

### 2.2 建立五個帳號

1. [GitHub](https://github.com/signup)
2. [Supabase](https://supabase.com/dashboard)
3. [Google AI Studio](https://aistudio.google.com/)
4. [Reurl.cc](https://reurl.cc/main/tw)
5. [Apple Developer](https://developer.apple.com/programs/)

Supabase、Gemini 與 Reurl.cc 的免費額度或收費規則可能改變，正式使用前請確認各服務 Pricing 頁面。

### 2.3 Apple Developer 的用途

直接下載的 Mac App 若沒有簽章與公證，Gatekeeper 會警告或封鎖。公開提供 DMG 前必須：

1. 加入 Apple Developer Program。
2. 建立 `Developer ID Application` 憑證。
3. 將程式送 Apple notary service 檢查。
4. 將公證票證 staple 到 App 與 DMG。

這不是 Mac App Store 上架，也不需要 App Review。本教學只做網站或 GitHub Releases 直接下載。

## 三、取得自己的 InterAct repository

1. 登入 GitHub。
2. 開啟 [InterAct 專案](https://github.com/lienyujen/InterAct)。
3. 按右上角 **Fork**。
4. Owner 選自己的 GitHub 帳號。
5. Repository name 建議保留 `InterAct`。
6. 按 **Create fork**。
7. 進入自己的 fork，按 **Code > Download ZIP**。
8. 在 Finder 的「下載項目」雙擊 ZIP。
9. 將解壓縮後的資料夾移到自己的文件資料夾，例如 `~/Documents/InterAct`。

以下指令都必須在包含 `package.json` 的 InterAct 資料夾執行。

## 四、安裝必要工具

### 4.1 安裝 Node.js 24 LTS

1. 開啟 [Node.js 下載頁](https://nodejs.org/en/download)。
2. 選擇 Node.js 24 LTS 的 macOS Installer。
3. 依安裝程式完成安裝。
4. 關閉「終端機」並重新開啟。
5. 輸入：

```bash
node --version
npm --version
```

`node --version` 應顯示 `v24...`。

### 4.2 安裝 pnpm 11

```bash
npm install -g pnpm@11.7.0
pnpm --version
```

應顯示 `11.7.0`。

### 4.3 安裝 Homebrew 與 GitHub CLI

若尚未安裝 Homebrew，開啟 [brew.sh](https://brew.sh/) 並使用官方安裝指令。完成後輸入：

```bash
brew install gh
gh --version
gh auth login
```

登入時選擇：

1. `GitHub.com`
2. `HTTPS`
3. 使用瀏覽器登入
4. 在瀏覽器確認授權

### 4.4 開啟正確資料夾

在終端機輸入 `cd`、打一個空格，再把 InterAct 資料夾從 Finder 拖進終端機，按 Return：

```bash
cd ~/Documents/InterAct
pwd
ls package.json
```

最後一行若顯示 `package.json`，位置就正確。

讓 Mac 部署腳本可以執行：

```bash
chmod +x skills/interact-self-deploy/scripts/*.sh
```

## 五、建立並部署 Supabase

> 這個初始化流程只能用在全新、空白的 Supabase project。已有正式資料的 project 不可重跑初始化。

### 5.1 建立 project

1. 開啟 [Supabase Dashboard](https://supabase.com/dashboard)。
2. 按 **New project**。
3. 名稱可填 `InterAct`。
4. 建立 Database Password，存入密碼管理器。
5. Region 選擇靠近主要使用地區的位置。
6. 等待 project 建立完成。

### 5.2 保存三個公開設定

在 **Connect** 或 **Project Settings > API Keys** 找到：

| 名稱 | 格式 | 用途 |
| --- | --- | --- |
| Project ref | 20 個小寫英數字 | CLI 部署 |
| Project URL | `https://xxxxxxxxxxxxxxxxxxxx.supabase.co` | 網頁與 App |
| Publishable key | `sb_publishable_...` | 網頁與 App |

不要使用 Dashboard 網址代替 Project URL。不要分享 `sb_secret_...`、`service_role`、Database Password。

### 5.3 登入 Supabase CLI

```bash
pnpm dlx supabase login
```

瀏覽器開啟後完成授權。

### 5.4 部署資料庫與核心函式

將 `YOUR_PROJECT_REF` 換成自己的 20 字元 Project ref：

```bash
./skills/interact-self-deploy/scripts/deploy-supabase.sh YOUR_PROJECT_REF
```

若要求 Database Password，輸入建立 project 時保存的密碼。

### 5.5 Supabase 檢查點

回到 Dashboard 確認：

- Table Editor 有 `sessions`、`participants`、`messages`、`questions`、`answers`、`session_events`。
- Storage 有 `interact-screenshots`。
- Edge Functions 有 `create-session`、`participant-action`、`presenter-action`。

全部存在才繼續。

## 六、建立並部署 Gemini API

### 6.1 建立 Gemini key

1. 開啟 [Google AI Studio API Keys](https://aistudio.google.com/app/apikey)。
2. 登入並接受條款。
3. 建立或選擇自己的 Google Cloud project。
4. 按 **Create API key**。
5. 將 key 暫存於密碼管理器。

Gemini key 不可放進 `.env`、GitHub Variables、前端程式、Issue、教學截圖或聊天訊息。

### 6.2 部署 secret 與 AI 函式

```bash
./skills/interact-self-deploy/scripts/deploy-gemini.sh YOUR_PROJECT_REF
```

終端機提示後貼上 Gemini key。輸入過程不顯示字元是正常現象。腳本會將 key 放入 Supabase secrets，並部署 AI Edge Functions。

預設模型是 `gemini-3.6-flash`。若自己的 Google project 無法使用此模型，可指定另一個確定可用的模型：

```bash
./skills/interact-self-deploy/scripts/deploy-gemini.sh YOUR_PROJECT_REF 可用的模型名稱
```

### 6.3 Gemini 檢查點

建立測試場次、派送一題並執行 AI 分析。看到分析結果才繼續。

## 七、部署 GitHub Pages 學員端

### 7.1 啟用 Actions 與 Pages

1. 開啟自己的 fork。
2. 點 **Actions**。
3. 若顯示停用，按 **I understand my workflows, go ahead and enable them**。
4. 到 **Settings > Pages**。
5. 將 **Build and deployment > Source** 設為 **GitHub Actions**。

不要選 `Deploy from a branch`，否則原始 TypeScript 可能覆蓋編譯後的網站。

### 7.2 決定公開網址

若 GitHub 帳號是 `teacherlin`，repository 是 `InterAct`：

```text
https://teacherlin.github.io/InterAct
```

不要在公開網址後加入 `/#/join/...`。

### 7.3 設定 Variables 並啟動部署

替換四個自己的值：

```bash
./skills/interact-self-deploy/scripts/configure-github-pages.sh \
  GITHUB帳號/InterAct \
  https://YOUR_PROJECT_REF.supabase.co \
  sb_publishable_你的值 \
  https://GITHUB帳號.github.io/InterAct
```

腳本只會設定三個公開 Variables：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PUBLIC_APP_URL`

Gemini、Reurl、Apple 憑證和 GitHub token 都不可放在 Variables。

### 7.4 GitHub Pages 檢查點

1. 到 **Actions > Deploy to GitHub Pages**。
2. 確認 build 與 deploy 都是綠色勾勾。
3. 用手機行動網路開啟 Pages 網址。
4. 確認可看到 InterAct 首頁。

## 八、部署 Reurl.cc

Reurl 只負責縮短網址，不是網站主機。未設定時 InterAct 仍可使用長網址。

### 8.1 取得 API key

1. 登入 [Reurl.cc](https://reurl.cc/main/tw)。
2. 開啟 [API 文件](https://reurl.cc/main/dev/doc/tw)。
3. 按 **登入查看 ApiKey**。
4. 將 key 存入密碼管理器。

### 8.2 部署 secret 與函式

```bash
./skills/interact-self-deploy/scripts/deploy-reurl.sh YOUR_PROJECT_REF
```

提示後貼上 Reurl API key。它只會寫入 Supabase secrets。

### 8.3 Reurl 檢查點

建立全新場次。QR Code 下方若顯示 `https://reurl.cc/...` 即成功。舊場次可能保留先前的快取結果。

## 九、準備 Apple Developer 簽章

### 9.1 建立 Developer ID Application 憑證

1. 在 Mac 開啟 Xcode，登入 Apple Developer 帳號。
2. 依 Apple Developer 網站指引建立 `Developer ID Application` certificate。
3. 開啟「鑰匙圈存取」。
4. 在「我的憑證」找到 Developer ID Application。
5. 同時選取憑證及其下方私密金鑰。
6. 匯出為 `.p12`。
7. 設定一組新的匯出密碼並存入密碼管理器。

不要上傳未加密的私密金鑰。

### 9.2 將 `.p12` 轉成 GitHub Secret 可用文字

假設檔案位於 `~/Downloads/InterAct-Developer-ID.p12`：

```bash
base64 -i ~/Downloads/InterAct-Developer-ID.p12 | pbcopy
```

內容已複製到剪貼簿。不要貼到聊天或文件。

### 9.3 建立 App Store Connect API key

1. 登入 [App Store Connect](https://appstoreconnect.apple.com/)。
2. 到 **Users and Access > Integrations > App Store Connect API**。
3. 建立可用於公證的 API key。
4. 記下 **Key ID** 與 **Issuer ID**。
5. 下載 `.p8` 私密金鑰；Apple 通常只允許下載一次。
6. 將 `.p8` 與 `.p12` 放入受保護的位置。

### 9.4 寫入 GitHub Actions Secrets

到自己的 repository：

**Settings > Secrets and variables > Actions > Secrets > New repository secret**

建立以下五個 Secrets：

| Secret 名稱 | 內容 |
| --- | --- |
| `MACOS_CERTIFICATE_P12` | 剛才 base64 編碼的完整 `.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | `.p12` 匯出密碼 |
| `APPLE_API_KEY_ID` | App Store Connect Key ID |
| `APPLE_API_ISSUER` | App Store Connect Issuer ID |
| `APPLE_API_KEY_P8` | `.p8` 檔案的完整文字內容 |

Secrets 建立後無法再次顯示內容是正常現象。不要建立同名 Variables。

限制可修改 Actions workflow 的人員，因為修改過的 workflow 可能讀取 repository secrets。

## 十、建立 notarized universal DMG

### 10.1 啟動正式發布

1. 到 repository 的 **Actions**。
2. 點 **Release notarized macOS DMG**。
3. 按 **Run workflow**。
4. 選擇要發布的 branch。
5. `release_tag` 輸入語意版本，例如 `v0.1.0`。
6. 保持 `publish_release` 為勾選。
7. 按綠色 **Run workflow**。

workflow 會：

1. 檢查三個公開 Variables 與五個 Apple Secrets。
2. 執行 lint 及 React/Vite build。
3. 建立 Apple Silicon＋Intel universal App。
4. 使用 Developer ID 簽章。
5. 送 Apple notarization。
6. 驗證 `codesign`、Gatekeeper 與 stapled ticket。
7. 建立 DMG、ZIP 及 `SHA256SUMS.txt`。
8. 發布到 GitHub Releases。

第一次可能需要 10–30 分鐘，Apple notary service 忙碌時可能更久。

### 10.2 下載 DMG

成功後到 repository 右側的 **Releases**：

1. 開啟剛建立的版本。
2. 下載 `.dmg`。
3. 可同時下載 `SHA256SUMS.txt` 核對檔案。
4. 雙擊 DMG。
5. 將 InterAct 拖到 Applications。
6. 從 Applications 開啟 InterAct。

### 10.3 Gatekeeper 檢查點

正常情況下，macOS 會顯示已識別的開發者名稱，而不是「已損毀」或「無法確認開發者」。

若仍被 Gatekeeper 阻擋，不要教使用者移除 quarantine。回到 Actions 查看：

- `codesign --verify`
- `spctl --assess`
- `stapler validate`

任何一項失敗都不應公開該 DMG。

## 十一、螢幕錄影權限

InterAct 的「截圖派題」需要 macOS 的螢幕錄影權限。

1. 在 InterAct 內第一次按「截圖派題」。
2. macOS 若顯示提示，允許 InterAct 錄製螢幕。
3. 到 **系統設定 > 隱私權與安全性 > 螢幕與系統音訊錄製**。
4. 確認 InterAct 已開啟。
5. 完全退出 InterAct。
6. 重新開啟後再測試截圖。

若先前拒絕，InterAct 會開啟正確的系統設定頁面。權限變更後必須重啟 App。

## 十二、本機未簽章測試版（選用）

正式對外發布一律使用 GitHub Actions。若開發者只想在自己的 Mac 快速驗證，可執行：

```bash
./skills/interact-self-deploy/scripts/package-macos-local.sh \
  https://YOUR_PROJECT_REF.supabase.co \
  sb_publishable_你的值 \
  https://GITHUB帳號.github.io/InterAct
```

輸出位於 `release/`。這份本機版本刻意不簽章，只能用於開發測試，不可公開散布。

## 十三、完整驗收

至少準備一台 Mac 與一支使用行動網路的手機：

- [ ] 從 GitHub Releases 下載 DMG。
- [ ] Gatekeeper 正常接受簽章與公證。
- [ ] Apple Silicon Mac 可執行。
- [ ] 若要支援 Intel，至少在 Intel Mac 或可靠測試環境驗證。
- [ ] App 能建立場次。
- [ ] QR Code 與短網址可從手機開啟。
- [ ] 學員可輸入姓名並加入。
- [ ] 講者端顯示正確在線人數。
- [ ] 彈幕、匿名切換與關閉正常。
- [ ] 文字及網址派送正常。
- [ ] 截圖權限提示清楚，單螢幕與多螢幕截圖正常。
- [ ] 投票、多選、是非、簡答正常。
- [ ] AI 分析與 Exit Ticket 正常。
- [ ] 抽籤與搶答正常。
- [ ] Excel 報表可匯出並由 Numbers 或 Excel 開啟。
- [ ] 退出與重新開啟 App 正常。

## 十四、常見問題

### `command not found: node`、`pnpm` 或 `gh`

關閉終端機再重新開啟。仍失敗就重新安裝對應工具。

### `permission denied` 執行 `.sh`

```bash
chmod +x skills/interact-self-deploy/scripts/*.sh
```

### GitHub Pages 顯示原始空白頁

確認 **Settings > Pages > Source** 是 **GitHub Actions**，不是 Deploy from a branch。重新執行 `configure-github-pages.sh`。

### Actions 顯示 Missing repository variable

重跑 `configure-github-pages.sh`，確認 repository 是自己的 `帳號/InterAct`。

### Actions 顯示 Missing secret

到 **Settings > Secrets and variables > Actions > Secrets** 建立缺少的 Apple Secret。不要放到 Variables。

### `Developer ID Application` 找不到

確認 Apple Developer Program 會員狀態有效，且憑證與私密金鑰同時存在「鑰匙圈存取」的「我的憑證」。

### Notarization 失敗

查看 workflow 中 electron-builder 的 notary log。常見原因是：

- API Key ID、Issuer ID 或 `.p8` 不相符。
- 使用了錯誤的憑證種類。
- `.p12` 沒有包含私密金鑰。
- `.p12` 密碼錯誤。
- Apple Developer membership 已失效。

### DMG 可開啟但截圖是黑畫面

到系統設定開啟 InterAct 的「螢幕與系統音訊錄製」權限，完全退出再開啟。多螢幕使用者要逐一測試。

### AI 顯示模型不存在

確認 Google AI Studio project 可使用指定模型，再重跑 `deploy-gemini.sh` 並傳入可用模型名稱。

### QR Code 仍是長網址

重跑 `deploy-reurl.sh`，再建立全新場次。

## 十五、更新與更換設定

- 只換 Gemini key：重跑 `deploy-gemini.sh`。
- 只換 Reurl key：重跑 `deploy-reurl.sh`，再建立新場次。
- 換 Supabase project：重做 Supabase、Gemini、GitHub Pages、Reurl 與 Mac release。
- 換 GitHub 帳號或 repository 名稱：重跑 GitHub Pages 設定並發布新 DMG。
- 改前端公開設定：更新 Variables 後，Pages 與 DMG 都要重新 build。
- Developer ID 憑證到期或撤銷：更新 `.p12` Secrets 並發布新版本。
- `.p8` 遺失或撤銷：建立新 API key 並更新三個 Apple API Secrets。

## 十六、安全與隱私底線

- `sb_publishable_...` 可存在前端；`sb_secret_...`、`service_role`、Database Password 絕對不可。
- Gemini 與 Reurl key 只能存在 Supabase secrets。
- `.p12`、`.p12` 密碼與 `.p8` 只能存在受保護的備份及 GitHub Actions Secrets。
- 不要把 Secrets 貼到聊天、Issue、PR、README、截圖或教學影片。
- 每位講師使用自己的 Supabase，避免不同講師的姓名與課堂資料混在一起。
- Gemini 分析會處理題目截圖與學員回答，使用前應依組織規範告知參與者。
- 目前版本不應直接承載醫療、財務或未公開商業等高度敏感資料。

## 官方參考資料

- [Node.js 下載](https://nodejs.org/en/download)
- [pnpm 安裝](https://pnpm.io/installation)
- [GitHub CLI](https://cli.github.com/)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Gemini API key](https://ai.google.dev/gemini-api/docs/api-key)
- [GitHub Pages custom workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)
- [Apple Developer ID](https://developer.apple.com/developer-id/)
- [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [electron-builder macOS](https://www.electron.build/mac/)
- [Electron screen capture permission](https://www.electronjs.org/docs/latest/api/system-preferences)
