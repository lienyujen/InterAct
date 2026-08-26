import ExcelJS from 'exceljs'
import type { QuestionAnalysis, SessionAnalysis, SessionMetrics, SessionReportData } from '../types'

const COLORS = {
  primary: '1463FF',
  header: '172033',
  border: 'D8DDE8',
  paleBlue: 'EEF5FF',
  paleGreen: 'ECFDF5',
  white: 'FFFFFF',
}

const questionTypeLabels = {
  send_screen: '派送畫面',
  poll: '投票題',
  multiple_choice: '選擇題',
  true_false: '是非題',
  short_answer: '問答題',
  pronunciation: '朗讀發音',
  oral_response: '口語表達',
  custom_quiz: '自訂測驗',
}

const quizItemTypeLabels = {
  multiple_choice: '選擇題',
  fill_blank: '填充題',
  short_answer: '簡答題',
}

const exitTicketCategoryLabels = {
  lesson_summary: '課程總結',
  learning_assessment: '學習程度評估',
  course_satisfaction: '課程回饋',
  student_question: '提出疑問',
}

function formatDate(value: string | null) {
  return value ? new Date(value) : null
}

function listText(values: string[]) {
  return values.length ? values.map((value, index) => `${index + 1}. ${value}`).join('\n') : '無'
}

function questionAnalysisMap(data: SessionReportData) {
  const map = new Map<string, QuestionAnalysis>()
  for (const summary of data.aiSummaries) {
    if (summary.type !== 'question_analysis' || !summary.question_id) continue
    const output = summary.output_json as Partial<QuestionAnalysis>
    if (output.question_understanding && output.response_analysis) {
      map.set(summary.question_id, output as QuestionAnalysis)
    }
  }
  return map
}

function styleTableSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } }
  const header = sheet.getRow(1)
  header.height = 28
  header.font = { bold: true, color: { argb: COLORS.white } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } }
  header.alignment = { vertical: 'middle' }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7F8FB' } }
    }
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true }
      cell.border = {
        bottom: { style: 'hair', color: { argb: COLORS.border } },
      }
    })
  })
}

function addOverviewSection(sheet: ExcelJS.Worksheet, title: string, rows: Array<[string, string | number | Date | null]>) {
  const titleRow = sheet.addRow([title])
  sheet.mergeCells(titleRow.number, 1, titleRow.number, 2)
  titleRow.height = 26
  titleRow.font = { bold: true, color: { argb: COLORS.white } }
  titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.primary } }
  titleRow.alignment = { vertical: 'middle' }

  for (const [label, value] of rows) {
    const row = sheet.addRow([label, value])
    row.getCell(1).font = { bold: true, color: { argb: COLORS.header } }
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.paleBlue } }
    row.getCell(2).alignment = { vertical: 'top', wrapText: true }
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'hair', color: { argb: COLORS.border } },
      }
    })
  }
  sheet.addRow([])
}

export async function exportSessionReport(data: SessionReportData, analysis: SessionAnalysis, metrics: SessionMetrics) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'InterAct'
  workbook.created = new Date()
  workbook.modified = new Date()
  workbook.calcProperties.fullCalcOnLoad = true

  const overview = workbook.addWorksheet('總覽', { views: [{ state: 'frozen', ySplit: 2 }] })
  overview.columns = [{ width: 28 }, { width: 105 }]
  const reportTitle = overview.addRow([`InterAct 課堂互動報告｜${data.session.title}`])
  overview.mergeCells('A1:B1')
  reportTitle.height = 36
  reportTitle.font = { bold: true, size: 18, color: { argb: COLORS.white } }
  reportTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } }
  reportTitle.alignment = { vertical: 'middle' }
  overview.addRow([])

  addOverviewSection(overview, '場次資訊', [
    ['場次名稱', data.session.title],
    ['場次代碼', data.session.code],
    ['開始時間', formatDate(data.session.created_at)],
    ['結束時間', formatDate(data.session.ended_at)],
    ['課堂長度（分鐘）', metrics.duration_minutes],
  ])
  overview.getCell('B6').numFmt = 'yyyy-mm-dd hh:mm'
  overview.getCell('B7').numFmt = 'yyyy-mm-dd hh:mm'

  addOverviewSection(overview, '互動統計', [
    ['參與者人數', metrics.participant_count],
    ['彈幕次數', metrics.message_count],
    ['曾發送彈幕人數', metrics.active_message_participants],
    ['題目數', metrics.question_count],
    ['總作答數', metrics.answer_count],
    ['平均作答率', metrics.average_response_rate / 100],
    ['已判定答案數', metrics.assessed_answer_count],
    ['答對數', metrics.correct_answer_count],
    ['整體正確率', metrics.correct_rate === null ? '尚未設定正確答案' : metrics.correct_rate / 100],
    ['Exit Ticket 份數', metrics.exit_ticket_count],
    ['錄音作答數', metrics.audio_response_count],
    ['錄音完成分析數', metrics.analyzed_audio_count],
    ['錄音平均分數', metrics.average_audio_score ?? '尚無完成的錄音分析'],
    ['文字／連結派送數', data.sharedContents.length],
  ])
  const interactionStart = 11
  overview.getCell(`B${interactionStart + 5}`).numFmt = '0.0%'
  if (metrics.correct_rate !== null) overview.getCell(`B${interactionStart + 8}`).numFmt = '0.0%'

  addOverviewSection(overview, 'AI 整節課分析', [
    ['總結', analysis.executive_summary],
    ...(analysis.lesson_key_points?.length
      ? [['課堂重點整理', listText(analysis.lesson_key_points)] as [string, string]]
      : []),
    ['互動程度', analysis.engagement_analysis.level],
    ['互動分析', analysis.engagement_analysis.summary],
    ['參與觀察', listText(analysis.engagement_analysis.participation_observations)],
    ['彈幕觀察', listText(analysis.engagement_analysis.danmaku_observations)],
    ['整體理解', analysis.learning_analysis.overall_understanding],
    ['學習優勢', listText(analysis.learning_analysis.strengths)],
    ['常見迷思', listText(analysis.learning_analysis.misconceptions)],
    ['立即行動', listText(analysis.teaching_recommendations.immediate_actions)],
    ['下節課建議', listText(analysis.teaching_recommendations.next_lesson_actions)],
    ['追問題目', listText(analysis.teaching_recommendations.follow_up_questions)],
    ['分析限制', listText(analysis.limitations)],
  ])
  overview.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true }
    })
  })

  const messageCountByParticipant = new Map<string, number>()
  for (const message of data.messages) {
    messageCountByParticipant.set(message.participant_id, (messageCountByParticipant.get(message.participant_id) || 0) + 1)
  }
  const answerCountByParticipant = new Map<string, number>()
  for (const answer of data.answers) {
    answerCountByParticipant.set(answer.participant_id, (answerCountByParticipant.get(answer.participant_id) || 0) + 1)
  }
  for (const attempt of data.customQuizResults.attempts) {
    answerCountByParticipant.set(attempt.participant_id, (answerCountByParticipant.get(attempt.participant_id) || 0) + 1)
  }

  const participants = workbook.addWorksheet('參與者')
  participants.columns = [
    { header: '姓名', key: 'name', width: 20 },
    { header: '加入時間', key: 'joinedAt', width: 22 },
    { header: '最後活動時間', key: 'lastSeenAt', width: 22 },
    { header: '彈幕次數', key: 'messageCount', width: 14 },
    { header: '作答次數', key: 'answerCount', width: 14 },
  ]
  for (const participant of data.participants) {
    participants.addRow({
      name: participant.name,
      joinedAt: formatDate(participant.joined_at),
      lastSeenAt: formatDate(participant.last_seen_at),
      messageCount: messageCountByParticipant.get(participant.id) || 0,
      answerCount: answerCountByParticipant.get(participant.id) || 0,
    })
  }
  participants.getColumn('joinedAt').numFmt = 'yyyy-mm-dd hh:mm:ss'
  participants.getColumn('lastSeenAt').numFmt = 'yyyy-mm-dd hh:mm:ss'
  styleTableSheet(participants)

  const analysisMap = questionAnalysisMap(data)
  const screenshotMap = new Map(data.screenshots.map((screenshot) => [screenshot.id, screenshot.public_url]))
  const quizByQuestion = new Map(data.customQuizResults.quizzes.map((quiz) => [quiz.question_id, quiz]))
  const quizKeyByItem = new Map(data.customQuizResults.keys.map((key) => [key.item_id, key]))
  const questions = workbook.addWorksheet('題目')
  questions.columns = [
    { header: '題次', key: 'number', width: 8 },
    { header: '類型', key: 'type', width: 14 },
    { header: '題目／AI 辨識', key: 'title', width: 38 },
    { header: '狀態', key: 'status', width: 12 },
    { header: '選項', key: 'options', width: 25 },
    { header: '正確答案', key: 'correctAnswer', width: 14 },
    { header: '作答數', key: 'answerCount', width: 12 },
    { header: '作答率', key: 'responseRate', width: 12 },
    { header: '正確率', key: 'correctRate', width: 12 },
    { header: 'AI 理解摘要', key: 'analysis', width: 50 },
    { header: '常見迷思', key: 'misconceptions', width: 45 },
    { header: '截圖網址', key: 'screenshotUrl', width: 48 },
  ]
  data.questions.forEach((question, index) => {
    const questionAnswers = data.answers.filter((answer) => answer.question_id === question.id)
    const assessed = questionAnswers.filter((answer) => answer.is_correct !== null)
    const questionAnalysis = analysisMap.get(question.id)
    const quiz = quizByQuestion.get(question.id)
    if (quiz) {
      const quizAttempts = data.customQuizResults.attempts.filter((attempt) => attempt.quiz_id === quiz.id)
      const quizItems = data.customQuizResults.items.filter((item) => item.quiz_id === quiz.id)
      for (const item of quizItems) {
        const itemAnswers = data.customQuizResults.answers.filter((answer) => answer.item_id === item.id)
        const scored = itemAnswers.filter((answer) => typeof answer.score === 'number')
        const correct = scored.filter((answer) => Number(answer.score) >= Number(item.points))
        const key = quizKeyByItem.get(item.id)
        questions.addRow({
          number: `${index + 1}-${item.position}`,
          type: `自訂測驗／${quizItemTypeLabels[item.type]}`,
          title: item.prompt_text,
          status: question.status,
          options: item.options.join('\n'),
          correctAnswer: key?.accepted_answers.join('、') || key?.rubric || '',
          answerCount: itemAnswers.length,
          responseRate: data.participants.length ? quizAttempts.length / data.participants.length : 0,
          correctRate: scored.length ? correct.length / scored.length : '',
          analysis: questionAnalysis?.response_analysis.understanding_summary || '',
          misconceptions: questionAnalysis?.response_analysis.misconceptions.join('\n') || '',
          screenshotUrl: question.screenshot_id ? screenshotMap.get(question.screenshot_id) || '' : '',
        })
      }
      return
    }
    questions.addRow({
      number: index + 1,
      type: questionTypeLabels[question.type],
      title: questionAnalysis?.question_understanding.detected_question || question.prompt_text || question.title,
      status: question.status,
      options: question.options.join('、'),
      correctAnswer: question.correct_answers?.length ? question.correct_answers.join('、') : question.correct_answer || '',
      answerCount: questionAnswers.length,
      responseRate: data.participants.length ? questionAnswers.length / data.participants.length : 0,
      correctRate: assessed.length ? assessed.filter((answer) => answer.is_correct).length / assessed.length : '',
      analysis: questionAnalysis?.response_analysis.understanding_summary || '',
      misconceptions: questionAnalysis?.response_analysis.misconceptions.join('\n') || '',
      screenshotUrl: question.screenshot_id ? screenshotMap.get(question.screenshot_id) || '' : '',
    })
  })
  questions.getColumn('responseRate').numFmt = '0.0%'
  questions.getColumn('correctRate').numFmt = '0.0%'
  styleTableSheet(questions)

  const questionNumber = new Map(data.questions.map((question, index) => [question.id, index + 1]))
  const questionById = new Map(data.questions.map((question) => [question.id, question]))
  const quizItemById = new Map(data.customQuizResults.items.map((item) => [item.id, item]))
  const quizAttemptById = new Map(data.customQuizResults.attempts.map((attempt) => [attempt.id, attempt]))
  const answers = workbook.addWorksheet('答案')
  answers.columns = [
    { header: '題次', key: 'questionNumber', width: 8 },
    { header: '題型', key: 'questionType', width: 14 },
    { header: '姓名', key: 'participantName', width: 20 },
    { header: '選項答案', key: 'answerValue', width: 16 },
    { header: '文字答案', key: 'answerText', width: 55 },
    { header: '正確性', key: 'correctness', width: 14 },
    { header: '得分', key: 'score', width: 12 },
    { header: 'AI 回饋', key: 'feedback', width: 55 },
    { header: '送出時間', key: 'submittedAt', width: 22 },
  ]
  for (const answer of data.answers) {
    const question = questionById.get(answer.question_id)
    answers.addRow({
      questionNumber: questionNumber.get(answer.question_id) || '',
      questionType: question ? questionTypeLabels[question.type] : '',
      participantName: answer.participant_name,
      answerValue: answer.answer_values?.length ? answer.answer_values.join('、') : answer.answer_value || '',
      answerText: answer.answer_text || '',
      correctness: answer.is_correct === null ? '未判定' : answer.is_correct ? '正確' : '錯誤',
      submittedAt: formatDate(answer.submitted_at),
    })
  }
  for (const answer of data.customQuizResults.answers) {
    const attempt = quizAttemptById.get(answer.attempt_id)
    const item = quizItemById.get(answer.item_id)
    if (!attempt || !item) continue
    const itemPoints = Number(item.points) || 0
    const score = typeof answer.score === 'number' ? answer.score : null
    answers.addRow({
      questionNumber: `${questionNumber.get(attempt.question_id) || ''}-${item.position}`,
      questionType: `自訂測驗／${quizItemTypeLabels[item.type]}`,
      participantName: attempt.participant_name,
      answerValue: answer.answer_values?.join('、') || '',
      answerText: answer.answer_text || '',
      correctness: score === null ? '評分中' : score >= itemPoints ? '正確／滿分' : score > 0 ? '部分得分' : '錯誤／零分',
      score: score === null ? '' : `${score}/${itemPoints}`,
      feedback: answer.feedback?.zh_tw || answer.feedback?.en || '',
      submittedAt: formatDate(answer.created_at),
    })
  }
  answers.getColumn('submittedAt').numFmt = 'yyyy-mm-dd hh:mm:ss'
  styleTableSheet(answers)

  const quizScores = workbook.addWorksheet('自訂測驗總成績')
  quizScores.columns = [
    { header: '題次', key: 'questionNumber', width: 10 },
    { header: '測驗名稱', key: 'quizTitle', width: 42 },
    { header: '姓名', key: 'participantName', width: 20 },
    { header: '狀態', key: 'status', width: 14 },
    { header: '總分', key: 'totalScore', width: 12 },
    { header: '滿分', key: 'maxScore', width: 12 },
    { header: 'AI 總回饋', key: 'feedback', width: 65 },
    { header: '錯誤訊息', key: 'error', width: 42 },
    { header: '送出時間', key: 'submittedAt', width: 22 },
    { header: '評分完成時間', key: 'gradedAt', width: 22 },
  ]
  const quizById = new Map(data.customQuizResults.quizzes.map((quiz) => [quiz.id, quiz]))
  for (const attempt of data.customQuizResults.attempts) {
    const quiz = quizById.get(attempt.quiz_id)
    quizScores.addRow({
      questionNumber: questionNumber.get(attempt.question_id) || '',
      quizTitle: quiz?.title || '',
      participantName: attempt.participant_name,
      status: attempt.status === 'graded' ? '已評分' : attempt.status === 'grading' ? '評分中' : '評分失敗',
      totalScore: attempt.total_score ?? '',
      maxScore: attempt.max_score,
      feedback: attempt.feedback?.zh_tw || attempt.feedback?.en || '',
      error: attempt.error_message || '',
      submittedAt: formatDate(attempt.submitted_at),
      gradedAt: formatDate(attempt.graded_at),
    })
  }
  quizScores.getColumn('submittedAt').numFmt = 'yyyy-mm-dd hh:mm:ss'
  quizScores.getColumn('gradedAt').numFmt = 'yyyy-mm-dd hh:mm:ss'
  styleTableSheet(quizScores)

  const audioResponses = workbook.addWorksheet('錄音評測')
  audioResponses.columns = [
    { header: '題次', key: 'questionNumber', width: 8 },
    { header: '題型', key: 'questionType', width: 14 },
    { header: '姓名', key: 'participantName', width: 20 },
    { header: '辨識語言', key: 'language', width: 16 },
    { header: '分數', key: 'score', width: 10 },
    { header: '逐字稿', key: 'transcript', width: 55 },
    { header: 'AI 分析', key: 'summary', width: 55 },
    { header: '內容對照', key: 'relevance', width: 45 },
    { header: '表達清晰度', key: 'clarity', width: 45 },
    { header: '完成度', key: 'completeness', width: 45 },
    { header: '優點', key: 'strengths', width: 45 },
    { header: '改善建議', key: 'improvements', width: 50 },
    { header: '分析限制', key: 'limitations', width: 40 },
    { header: '送出時間', key: 'submittedAt', width: 22 },
  ]
  for (const response of data.audioResponses) {
    const question = questionById.get(response.question_id)
    const item = response.analysis_json
    audioResponses.addRow({
      questionNumber: questionNumber.get(response.question_id) || '',
      questionType: question ? questionTypeLabels[question.type] : '',
      participantName: response.participant_name,
      language: response.detected_language || '',
      score: response.score ?? '',
      transcript: response.transcript || '',
      summary: item?.summary || response.error_message || '',
      relevance: item?.relevance || '',
      clarity: item?.clarity || '',
      completeness: item?.completeness || '',
      strengths: item?.strengths.join('\n') || '',
      improvements: item?.improvements.join('\n') || '',
      limitations: item?.limitations.join('\n') || '',
      submittedAt: formatDate(response.submitted_at),
    })
  }
  audioResponses.getColumn('submittedAt').numFmt = 'yyyy-mm-dd hh:mm:ss'
  styleTableSheet(audioResponses)

  const messages = workbook.addWorksheet('彈幕')
  messages.columns = [
    { header: '時間', key: 'createdAt', width: 22 },
    { header: '姓名', key: 'participantName', width: 20 },
    { header: '顯示模式', key: 'displayMode', width: 14 },
    { header: '內容', key: 'content', width: 85 },
  ]
  for (const message of data.messages) {
    messages.addRow({
      createdAt: formatDate(message.created_at),
      participantName: message.participant_name,
      displayMode: message.anonymous_at_display ? '匿名' : '具名',
      content: message.content,
    })
  }
  messages.getColumn('createdAt').numFmt = 'yyyy-mm-dd hh:mm:ss'
  styleTableSheet(messages)

  const sharedContents = workbook.addWorksheet('文字派送')
  sharedContents.columns = [
    { header: '派送時間', key: 'createdAt', width: 22 },
    { header: '內容類型', key: 'contentType', width: 16 },
    { header: '文字內容', key: 'body', width: 75 },
    { header: '網址', key: 'url', width: 65 },
  ]
  for (const content of data.sharedContents) {
    sharedContents.addRow({
      createdAt: formatDate(content.created_at),
      contentType: content.body && content.url ? '文字＋連結' : content.url ? '連結' : '文字',
      body: content.body || '',
      url: content.url
        ? { text: content.url, hyperlink: content.url, tooltip: '開啟派送網址' }
        : '',
    })
  }
  sharedContents.getColumn('createdAt').numFmt = 'yyyy-mm-dd hh:mm:ss'
  sharedContents.getColumn('url').font = { color: { argb: COLORS.primary }, underline: true }
  styleTableSheet(sharedContents)

  const captions = workbook.addWorksheet('即時字幕逐字稿')
  captions.columns = [
    { header: '時間', key: 'createdAt', width: 22 },
    { header: '語言', key: 'language', width: 14 },
    { header: '類型', key: 'kind', width: 12 },
    { header: '字幕內容', key: 'text', width: 100 },
  ]
  for (const segment of data.captionSegments) {
    captions.addRow({
      createdAt: formatDate(segment.created_at),
      language: segment.language,
      kind: segment.is_translation ? '翻譯' : '原文',
      text: segment.text,
    })
  }
  captions.getColumn('createdAt').numFmt = 'yyyy-mm-dd hh:mm:ss'
  styleTableSheet(captions)

  const exitTickets = workbook.addWorksheet('Exit Ticket')
  exitTickets.columns = [
    { header: '姓名', key: 'participantName', width: 20 },
    { header: '類型', key: 'category', width: 18 },
    { header: '題目', key: 'prompt', width: 55 },
    { header: '回答', key: 'response', width: 55 },
    { header: '星等', key: 'rating', width: 12 },
    { header: '送出時間', key: 'submittedAt', width: 22 },
  ]
  for (const ticket of data.exitTickets) {
    const legacyResponse = [
      ticket.most_useful,
      ticket.still_confused,
      ticket.next_suggestion,
    ].filter(Boolean).join('\n')
    exitTickets.addRow({
      participantName: ticket.participant_name,
      category: data.session.exit_ticket_category
        ? exitTicketCategoryLabels[data.session.exit_ticket_category]
        : '舊版綜合回饋',
      prompt: data.session.exit_ticket_prompt || '舊版 Exit Ticket',
      response: ticket.response_text || legacyResponse,
      rating: ticket.rating || ticket.understanding_score || '',
      submittedAt: formatDate(ticket.submitted_at),
    })
  }
  exitTickets.getColumn('submittedAt').numFmt = 'yyyy-mm-dd hh:mm:ss'
  styleTableSheet(exitTickets)

  const aiQuestions = workbook.addWorksheet('AI 題目分析')
  aiQuestions.columns = [
    { header: '題次', key: 'questionNumber', width: 8 },
    { header: '題型', key: 'questionType', width: 14 },
    { header: 'AI 辨識題目', key: 'detectedQuestion', width: 45 },
    { header: '科目', key: 'subject', width: 20 },
    { header: '概念', key: 'concepts', width: 35 },
    { header: '建議答案', key: 'suggestedAnswer', width: 14 },
    { header: '信心', key: 'confidence', width: 12 },
    { header: '理解摘要', key: 'summary', width: 55 },
    { header: '優勢', key: 'strengths', width: 45 },
    { header: '迷思', key: 'misconceptions', width: 45 },
    { header: '立即建議', key: 'recommendations', width: 55 },
  ]
  data.questions.forEach((question, index) => {
    const item = analysisMap.get(question.id)
    if (!item) return
    aiQuestions.addRow({
      questionNumber: index + 1,
      questionType: questionTypeLabels[question.type],
      detectedQuestion: item.question_understanding.detected_question,
      subject: item.question_understanding.subject,
      concepts: item.question_understanding.concepts.join('、'),
      suggestedAnswer: item.question_understanding.suggested_correct_answer || '',
      confidence: item.question_understanding.confidence,
      summary: item.response_analysis.understanding_summary,
      strengths: item.response_analysis.strengths.join('\n'),
      misconceptions: item.response_analysis.misconceptions.join('\n'),
      recommendations: item.teaching_recommendations.immediate_actions.join('\n'),
    })
  })
  styleTableSheet(aiQuestions)

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const safeTitle = data.session.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60) || '課堂報告'
  anchor.href = url
  anchor.download = `InterAct-${safeTitle}-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
