export const MANUAL_ANSWER_STYLE_GUIDE = `保持专业、直接、清晰，对新手友好，但不设定人物角色。
禁止任何人格化开场、寒暄、口号和俚语，例如“好了”“咱们”“今天就”“老鸟”“跟着我”。
不要评价用户，也不要用聊天式铺垫；直接从内容标题开始。
允许把手册中的专业表述解释成易懂中文，但解释不得引入手册来源之外的事实。`

export const MANUAL_ANSWER_STRUCTURE_GUIDE = `回答在完整解决问题的前提下保持精炼，删除重复解释，并按以下结构组织；没有内容的章节直接省略：
### 前提条件
列出模式、页面、开关、任务设置、网络条件、控制权或其他开始前条件。
### 操作说明
按实际先后顺序给出完整步骤；一个问题存在多个手册支持的合法含义时，分场景建立四级标题，分别给出完整流程。
### 成功判断
列出手册描述的显示变化、提示、符号、声音或其他完成标志；资料没有提供时可以省略本节。
### 注意事项
只列出与本问题直接相关的限制、易混淆概念、取消方式和故障信息。不要再复述操作步骤。`

export const LOCAL_RESEARCH_PRESENTATION_GUIDE = `本地手册答案要采用成熟技术资料的写法：
- 开头先给出一个简短、具体的标题，再用 1—2 句话说明当前武器、系统或功能是做什么的、适用于什么任务；直接介绍功能，不要寒暄或自称“教官”。概述中的事实同样必须引用手册来源。
- “前提条件”只保留真正必须在第一步操作前满足的状态，例如正确挂载、系统供电/预热、主模式、主武器开关、任务数据或传感器可用性。不要把进入具体页面、选择子模式等核心操作提前塞进前提条件。
- 多种工作模式先各用一句话解释用途和适用场景，再给出连续编号步骤。一个编号只承载一个主要动作，必要解释紧跟在该步骤下方，不要把同一动作拆成许多碎片。
- 使用“英文原名（简明中文解释）”帮助新手理解，但不要逐字翻译面板标签；合并重复的挂载、开关和模式条件。
- 成功判断写成用户能在座舱中实际看到、听到或确认的反馈；注意事项只保留会影响操作结果的限制、冲突和取消方式。`

export const LOCAL_MANUAL_ANSWER_STRUCTURE_GUIDE = `回答在完整解决问题的前提下保持精炼，删除重复解释，并按以下结构组织；没有内容的章节直接省略：
### 前提条件
只列出开始操作前必须满足的模式、页面、开关、任务设置或控制权。
### 操作说明
按实际先后顺序给出完整步骤；一个问题存在多个手册支持的合法含义时，按场景分别给出流程。可观察到的结果直接写入对应操作步骤，不另设“成功判断”章节。
### 注意事项
只列出与本问题直接相关的限制、易混淆概念、取消方式和故障信息，不复述前提和操作步骤。`

const PERSONA_OPENING = /^(?:好(?:了|的)?[，,！!。\s]|咱们|今天(?:就|来)|下面(?:我|咱们)|作为|先别急|别急|老鸟|跟着我)/i

export function normalizeManualAnswerStyle(answer: string): string {
  const normalized = answer.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (!normalized) return normalized
  const lines = normalized.split('\n')
  while (lines.length > 0 && (!lines[0].trim() || PERSONA_OPENING.test(lines[0].trim()))) lines.shift()
  const firstHeading = lines.findIndex((line) => /^#{2,4}\s+/.test(line.trim()))
  if (firstHeading > 0 && lines.slice(0, firstHeading).some((line) => PERSONA_OPENING.test(line.trim()))) lines.splice(0, firstHeading)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function ensureManualAnswerStructure(answer: string): string {
  const normalized = normalizeManualAnswerStyle(answer)
  if (!normalized) return normalized
  const hasOperation = /^#{2,4}\s+.*(?:操作|步骤|流程)/mi.test(normalized)
  return hasOperation ? normalized : `### 操作说明\n${normalized}`
}
