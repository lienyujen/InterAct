export type ParticipantLocale = 'zh-TW' | 'en'

const messages = {
  'zh-TW': {
    language: '語言', chinese: '繁體中文', english: 'English', courseEnded: '課程已結束', classDismissed: '下課啦！',
    thankYou: '謝謝你的參與。', aiSummary: 'AI 課程總結', todayHighlights: '今天的課程重點', lessonKeyPoints: '課堂重點整理',
    learningReview: '學習整理', strengths: '本次掌握的重點', reviewMore: '可以再複習', sharedResources: '課堂文字與連結',
    attendee: '與會者', welcome: '歡迎加入', session: 'InterAct 場次', sendFeedback: '送出問題或回饋',
    messagePlaceholder: '送出後會即時出現在講者畫面，上限36個中文字或24個英文單字', limit: '上限 36 個中文字或 24 個英文單字',
    used: '目前使用', send: '送出', questionEnded: '本題已結束。', submittedAnswer: '已送出答案：', interactiveQuestion: '互動題',
    answerPlaceholder: '請輸入你的回答', submitAnswer: '送出答案', presenterDispatch: '講者派送', collapse: '收合舊內容', expandAll: '展開全部',
    items: '則', copied: '已複製', copy: '複製文字', openLink: '開啟網址', dispatched: '派送',
    exitSubmitted: 'Exit Ticket 已送出', learningLevel: '學習程度：', stars: '顆星', required: '必答 1', optional: '選填 2',
    ratingPrompt: '請用 1 到 5 顆星評估你今天的學習理解程度', ratingLabel: '學習程度星等', optionalPlaceholder: '選填：可輸入你的回答、建議或回饋',
    sending: '送出中...', submitExit: '送出 Exit Ticket', recordingSent: '錄音已送出，AI 正在分析；停止作答後會顯示評測結果。',
    personalAssessment: '你的個人評測', detectedLanguage: '辨識語言：', points: '分', relevance: '內容對照', clarity: '表達清晰度',
    completeness: '完成度', doneWell: '做得好的地方', nextStep: '下一步建議', transcript: '查看辨識內容', noTranscript: '未辨識到語音內容',
    assessmentFailed: '錄音已收到，但 AI 評測未完成。請告知講師。', assessmentPending: 'AI 評測仍在處理中，請稍候。',
    recordingHint: '最長 3 分鐘。請在安靜處錄音，完成後按停止。', stopRecording: '停止錄音', uploading: '上傳並分析中...', startRecording: '開始錄音',
    interpretation: '即時語音口譯', headphoneLanguage: '耳機語言', testHeadphones: '測試耳機', stopListening: '停止聆聽', startListening: '開始聆聽口譯',
    connecting: '正在連接教師端口譯...', waitingTeacher: '已連線，等待教師說話...', playing: '口譯播放中', connectionFailed: '口譯連線失敗，請重試。',
    audioNotEnabled: '音訊輸出未啟用；請點右上角喇叭後重新開始聆聽。', headphoneHint: '建議戴上耳機，選擇語言後開始聆聽。',
    testPlayed: '已播放測試音；若沒有聽見，請檢查裝置音量與耳機輸出。', imageAlt: '講者派送圖片', congratulations: '恭喜！',
    winnerIs: '得獎的是', canBuzz: '現在可以搶答', waitPresenter: '請等待主講者開始', submitting: '送出中', buzz: '搶答', preparing: '準備中',
    sessionGoneTitle: '這場次已經莎喲娜啦了！', sessionGoneMessage: '下回請早！',
  },
  en: {
    language: 'Language', chinese: '繁體中文', english: 'English', courseEnded: 'Class ended', classDismissed: 'That’s a wrap!',
    thankYou: 'Thank you for participating.', aiSummary: 'AI class summary', todayHighlights: 'Today’s class highlights', lessonKeyPoints: 'Key takeaways',
    learningReview: 'Learning review', strengths: 'What the class understood', reviewMore: 'Worth reviewing', sharedResources: 'Class text and links',
    attendee: 'Participant', welcome: ', welcome to ', session: 'InterAct session', sendFeedback: 'Send a question or feedback',
    messagePlaceholder: 'Your message appears on the presenter screen immediately (up to 24 English words)', limit: 'Up to 24 English words or 36 CJK characters',
    used: 'Used', send: 'Send', questionEnded: 'This question has ended.', submittedAnswer: 'Answer submitted: ', interactiveQuestion: 'Interactive question',
    answerPlaceholder: 'Enter your answer', submitAnswer: 'Submit answer', presenterDispatch: 'Presenter dispatch', collapse: 'Hide older items', expandAll: 'Show all',
    items: 'items', copied: 'Copied', copy: 'Copy text', openLink: 'Open link', dispatched: 'Sent',
    exitSubmitted: 'Exit Ticket submitted', learningLevel: 'Understanding: ', stars: 'stars', required: 'Required 1', optional: 'Optional 2',
    ratingPrompt: 'Rate your understanding of today’s class from 1 to 5 stars', ratingLabel: 'Understanding rating', optionalPlaceholder: 'Optional: enter your answer, suggestion, or feedback',
    sending: 'Sending...', submitExit: 'Submit Exit Ticket', recordingSent: 'Recording submitted. AI analysis will appear after answering is closed.',
    personalAssessment: 'Your personal assessment', detectedLanguage: 'Detected language: ', points: 'pts', relevance: 'Relevance', clarity: 'Clarity',
    completeness: 'Completeness', doneWell: 'What you did well', nextStep: 'Next steps', transcript: 'View transcript', noTranscript: 'No speech was recognized',
    assessmentFailed: 'Recording received, but AI assessment was not completed. Please tell the instructor.', assessmentPending: 'AI assessment is still processing.',
    recordingHint: 'Up to 3 minutes. Record in a quiet place and press stop when finished.', stopRecording: 'Stop recording', uploading: 'Uploading and analyzing...', startRecording: 'Start recording',
    interpretation: 'Live voice interpretation', headphoneLanguage: 'Headphone language', testHeadphones: 'Test headphones', stopListening: 'Stop listening', startListening: 'Start interpretation',
    connecting: 'Connecting to the instructor’s interpretation...', waitingTeacher: 'Connected. Waiting for the instructor to speak...', playing: 'Playing interpretation', connectionFailed: 'Interpretation connection failed. Please retry.',
    audioNotEnabled: 'Audio output is not enabled. Tap the speaker icon and start listening again.', headphoneHint: 'Wear headphones, choose a language, then start listening.',
    testPlayed: 'Test tone played. If you cannot hear it, check your volume and audio output.', imageAlt: 'Image shared by presenter', congratulations: 'Congratulations!',
    winnerIs: 'The winner is', canBuzz: 'Buzz in now', waitPresenter: 'Wait for the presenter to start', submitting: 'Sending', buzz: 'Buzz', preparing: 'Get ready',
    sessionGoneTitle: 'This session has said its sayonara!', sessionGoneMessage: 'Catch the next one bright and early!',
  },
} as const

export type ParticipantMessageKey = keyof typeof messages['zh-TW']

export function participantText(locale: ParticipantLocale, key: ParticipantMessageKey) {
  return messages[locale][key]
}

export function participantLocaleFromStorage(): ParticipantLocale {
  return localStorage.getItem('interact_participant_locale') === 'en' ? 'en' : 'zh-TW'
}
