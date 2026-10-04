export const cameraPollPresets = [
  { id: 'true_false', label: '是非題：大圈圈／大叉叉', options: ['是', '否'], gestures: ['雙手舉高，在頭頂圍成一個大圈圈', '雙手在胸前比一個大叉叉'] },
  { id: 'poster', label: '大海報回答題：A4 白紙文字', options: ['可讀取的白紙', '文字不清楚的白紙'], gestures: ['手持 A4 白紙，文字清楚可讀', '手持 A4 白紙，但文字無法讀取'] },
  { id: 'choice', label: '選擇題：手指數量', options: ['A', 'B', 'C', 'D'], gestures: ['一根手指', '兩根手指', '三根手指', '四根手指'] },
  { id: 'understanding', label: '理解度投票', options: ['還不理解', '理解一點', '大致理解', '完全理解'], gestures: ['一根手指', '兩根手指', '三根手指', '四根手指'] },
  { id: 'confidence', label: '信心投票', options: ['沒有信心', '有一點信心', '有信心', '非常有信心'], gestures: ['一根手指', '兩根手指', '三根手指', '四根手指'] },
  { id: 'hands', label: '舉手統計', options: ['舉手', '未舉手'], gestures: ['至少一隻手舉高', '雙手均未舉高'] },
  { id: 'standing', label: '站立／坐下', options: ['站立', '坐下'], gestures: ['身體站立', '坐在座位上'] },
  { id: 'direction', label: '左右動作', options: ['向左', '向右'], gestures: ['以學生自己的方向向左伸手或側傾', '以學生自己的方向向右伸手或側傾'] },
  { id: 'imitation', label: '體育／動作模仿（AI 判斷）', options: ['符合指定動作', '需要調整'], gestures: ['符合教師在活動說明中指定的可見姿勢', '姿勢可見但未符合教師指定的動作'] },
  { id: 'custom', label: '其他／自訂（AI 判斷）', options: ['符合條件', '未符合條件'], gestures: ['依教師活動說明判斷符合的可見手勢或姿勢', '依教師活動說明判斷不符合的可見手勢或姿勢'] },
]
