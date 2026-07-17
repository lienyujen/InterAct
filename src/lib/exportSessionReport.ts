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
  ])
  const interactionStart = 11
  overview.getCell(`B${interactionStart + 5}`).numFmt = '0.0%'
  if (metrics.correct_rate !== null) overview.getCell(`B${interactionStart + 8}`).numFmt = '0.0%'

  addOverviewSection(overview, 'AI 整節課分析', [
    ['總結', analysis.executive_summary],
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
    questions.addRow({
      number: index + 1,
      type: questionTypeLabels[question.type],
      title: questionAnalysis?.question_understanding.detected_question || question.title,
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
  const answers = workbook.addWorksheet('答案')
  answers.columns = [
    { header: '題次', key: 'questionNumber', width: 8 },
    { header: '題型', key: 'questionType', width: 14 },
    { header: '姓名', key: 'participantName', width: 20 },
    { header: '選項答案', key: 'answerValue', width: 16 },
    { header: '文字答案', key: 'answerText', width: 55 },
    { header: '正確性', key: 'correctness', width: 14 },
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
  answers.getColumn('submittedAt').numFmt = 'yyyy-mm-dd hh:mm:ss'
  styleTableSheet(answers)

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

  const exitTickets = workbook.addWorksheet('Exit Ticket')
  exitTickets.columns = [
    { header: '姓名', key: 'participantName', width: 20 },
    { header: '最有幫助', key: 'mostUseful', width: 45 },
    { header: '仍感困惑', key: 'stillConfused', width: 45 },
    { header: '理解分數', key: 'understandingScore', width: 14 },
    { header: '參與分數', key: 'engagementScore', width: 14 },
    { header: '下次建議', key: 'nextSuggestion', width: 45 },
    { header: '送出時間', key: 'submittedAt', width: 22 },
  ]
  for (const ticket of data.exitTickets) {
    exitTickets.addRow({
      participantName: ticket.participant_name,
      mostUseful: ticket.most_useful,
      stillConfused: ticket.still_confused,
      understandingScore: ticket.understanding_score,
      engagementScore: ticket.engagement_score,
      nextSuggestion: ticket.next_suggestion,
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
