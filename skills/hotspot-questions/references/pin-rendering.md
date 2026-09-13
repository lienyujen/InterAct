# 標記的座標、繪製與取消

一個元件同時服務兩邊：學生在上面作答，老師在上面看結果。差別只有有沒有傳 `onPlace` / `onRemove`。

## 座標系統

**存分數，不存像素。** 全班在手機上作答（寬 390px），老師在投影機上看（寬 1920px）。
在其中一邊記下來的像素在另一邊毫無意義，圖片一縮放標記就全跑掉。

存的是 0 到 1 之間的比例，畫的時候乘回百分比。圖片多大都對，響應式、旋轉、放大檢視全部免費。

```ts
onPlace({
  x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
  y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
})
```

`Math.min(1, Math.max(0, ...))` 的夾擠是必要的：點在邊框上會算出 1.002 這種值。

量測的對象是**外框**而不是 `<img>` 本身。外框用 `line-height: 0` 與 `overflow: hidden`，
所以它的框就等於圖片的框，而且標記可以用 `position: absolute` 相對它定位。

## 元件

```tsx
import { useRef } from 'react'

export type Pin = { x: number; y: number; label: string; own?: boolean }

type Props = {
  imageUrl: string
  alt: string
  pins: Pin[]
  // 老師端不傳，那是一張「全班做了什麼」的圖，不是作答的地方
  onPlace?: (point: { x: number; y: number }) => void
  onRemove?: (index: number) => void
}

// 位置一律存成圖片的比例，絕不存像素：全班在手機上作答，
// 老師在投影機上讀，在其中一邊記下的像素在另一邊毫無意義。
export function HotspotImage({ imageUrl, alt, pins, onPlace, onRemove }: Props) {
  const frameRef = useRef<HTMLDivElement>(null)

  function place(event: React.MouseEvent<HTMLDivElement>) {
    if (!onPlace) return
    const frame = frameRef.current
    if (!frame) return
    const box = frame.getBoundingClientRect()
    if (!box.width || !box.height) return
    onPlace({
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    })
  }

  return (
    <div
      className={`hotspot-frame${onPlace ? ' is-answerable' : ''}`}
      ref={frameRef}
      role={onPlace ? 'button' : undefined}
      tabIndex={onPlace ? 0 : undefined}
      onClick={place}
    >
      <img alt={alt} className="hotspot-image" src={imageUrl} />
      {pins.map((pin, index) => (
        <button
          className={`hotspot-pin${pin.own ? ' is-own' : ''}`}
          disabled={!onRemove}
          key={`${index}-${pin.x}-${pin.y}`}
          style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
          title={pin.label}
          type="button"
          onClick={(event) => {
            // 否則取消一個標記的同時，會在它底下放下一個新的
            event.stopPropagation()
            onRemove?.(index)
          }}
        >
          <span>{pin.label}</span>
        </button>
      ))}
    </div>
  )
}
```

四個細節：

- **`event.stopPropagation()`** ——標記在外框裡面，點標記的 click 會冒泡到外框的 `onClick`。
  少了這一行，取消一個標記的同時會在原地放下一個新的，看起來就像什麼都沒發生。
- **`disabled={!onRemove}`** —— 老師端的標記不可互動，不會有 hover 手勢誤導老師以為點得掉。
- **標記是 `<button>`**，不是 `<div>`。鍵盤可及，也拿得到 `:active`（見下方）。
- **`key` 帶上座標** —— 只用索引當 key，刪掉中間一個標記時 React 會重用錯誤的節點，
  剩下的標記會瞬間跳位。

## CSS

```css
.hotspot-frame {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  display: block;
  /* 圖片底下不要有字型的行高空隙，否則外框比圖片高，座標就會偏 */
  line-height: 0;
  overflow: hidden;
  position: relative;
  width: 100%;
}

.hotspot-frame.is-answerable { cursor: crosshair; }

.hotspot-image { display: block; width: 100%; }

.hotspot-pin {
  align-items: center;
  background: var(--primary, #5b5ce2);
  border: 2px solid #fff;
  /* 水滴形：三個圓角加一個尖角 */
  border-radius: 50% 50% 50% 2px;
  box-shadow: 0 2px 6px rgb(0 0 0 / 35%);
  color: #fff;
  /* 半透明，讓一群標記讀起來像一群。十八個學生點同一個地方就是那個發現本身；
     不透明的標記會把它顯示成一個。 */
  opacity: 0.82;
  display: flex;
  font-size: 12px;
  font-weight: 700;
  height: 26px;
  justify-content: center;
  line-height: 1;
  padding: 0;
  position: absolute;
  /* 水滴的尖端落在被點的那一點上，不是水滴的中心。 */
  transform: translate(-50%, -100%) rotate(-45deg);
  width: 26px;
}

/* 標記整體轉了 -45 度，字要轉回來才是正的 */
.hotspot-pin span { transform: rotate(45deg); }

/* 自己的標記用另一個顏色 */
.hotspot-pin.is-own { background: var(--danger, #c62828); }

.hotspot-frame.is-answerable .hotspot-pin { cursor: pointer; }
```

`opacity: 0.82` 是這一題的教學價值所在。標記半透明，重疊處自然變深，
**一群人點在同一個地方會自己顯現成一團深色**，老師不必數。

`transform: translate(-50%, -100%)` 讓水滴的**尖端**落在被點的座標上。
少了它，標記的中心落在那一點上，所有標記看起來都偏低半個標記。

## 那個 bug：`:active` 把定位的 transform 換掉了

這是整個功能唯一真正難找的 bug，而且它在自動化測試裡永遠是綠的。

**症狀**：學生點自己的標記想取消，標記沒有消失，只是「呈現了一個下滑的動態動作」。

**原因**：設計系統裡有一條全域規則

```css
button:active { transform: translateY(1px); }
```

specificity 是 (0,1,1)，而 `.hotspot-pin` 是 (0,1,0)。**全域那條贏了。**

於是按下去的瞬間，定位用的 `translate(-50%, -100%) rotate(-45deg)` 被整個換成 `translateY(1px)`：

1. 標記從它的位置滑到左上角（而且是動畫滑過去的，因為 transform 有 transition）
2. 手指底下已經沒有標記了
3. 放開時的 click 落在圖片上，不是標記上
4. handler 永遠收不到 click —— 標記取消不掉

**修法**：按下的回饋必須**疊加**在定位之上，不能取代它。

```css
/* 全域的 button:active 設了 transform: translateY(1px)，而且在 specificity 上
   贏過 .hotspot-pin —— 所以按下標記會「取代」掉那個定位用的 transform。
   標記從手指底下滑走（而且是動畫滑走，因為 transform 有 transition），
   放開時落在圖片上，於是 handler 永遠收不到 click：標記取消不掉。
   按下的回饋必須和定位疊加，不能取代它。 */
.hotspot-pin:active {
  transform: translate(-50%, -100%) rotate(-45deg) scale(0.9);
}
```

`scale(0.9)` 給了按下的手感，而且定位保持不變。

**一般化的教訓**：只要一個元素的定位靠 `transform`，
設計系統裡每一條會碰 `transform` 的狀態規則（`:active`、`:hover`、`:focus`、動畫）
都必須把定位那一段重新寫進去。CSS 的 `transform` 不會累加，後面的會整個蓋掉前面的。

**為什麼測試抓不到**：
`element.dispatchEvent(new MouseEvent('click'))` 會直接呼叫到 handler，
不會經過 `:active`，也不會經過真實的指標下壓與抬起。
用合成事件驗證出來的「標記可以取消」是假的。**要用真的手指或真的滑鼠測。**

## 觸控目標

標記是 26px，比建議的觸控目標小。實務上還可以，因為學生是在點自己剛放下的標記、位置記得很清楚。
但如果要加大，用 `@media (any-pointer: coarse)` 而不是螢幕寬度 ——
教室裡的觸控顯示器是一個很大的粗指標裝置，用寬度判斷會漏掉它。

注意這條規則**在開發機上永遠不會生效**，所以看起來永遠是對的。要在實機上驗。
加大時記得 `:active` 那條也要跟著改，否則又會退回上面那個 bug。
