import { Session, h } from 'koishi'

// 生成一个四位数随机ID
export function generatePrizeId(): number {
  return Math.floor(1000 + Math.random() * 9000)
}

// 生成活动ID
export function generateActivityId(): string {
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `${timestamp}${random}`
}

// 验证是否为管理员
export function checkAdmin(userId: string, adminQQ: string): boolean {
  return userId === adminQQ
}

// 格式化时间
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

// 解析时间字符串（支持多种格式）
export function parseTimeString(timeStr: string): number | null {
  // 支持格式: "2024-01-01 12:00", "12:00", "1h", "30m", "1d"
  const now = Date.now()

  // 相对时间: 1h, 30m, 1d
  const relativeMatch = timeStr.match(/^(\d+)([mhd])$/)
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1])
    const unit = relativeMatch[2]
    const multiplier = { m: 60000, h: 3600000, d: 86400000 }
    return now + value * multiplier[unit]
  }

  // 绝对时间: YYYY-MM-DD HH:mm 或 HH:mm
  try {
    const date = new Date(timeStr)
    if (!isNaN(date.getTime())) {
      return date.getTime()
    }
  } catch {}

  // 今天的某个时间: HH:mm
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/)
  if (timeMatch) {
    const hours = parseInt(timeMatch[1])
    const minutes = parseInt(timeMatch[2])
    const targetDate = new Date()
    targetDate.setHours(hours, minutes, 0, 0)
    if (targetDate.getTime() < now) {
      targetDate.setDate(targetDate.getDate() + 1) // 如果已经过了今天的这个时间，就设为明天
    }
    return targetDate.getTime()
  }

  return null
}

// 封装发送消息的函数
export async function sendMessage(session: Session, content: string | any[]): Promise<void> {
  try {
    const formattedContent = Array.isArray(content) ? content.join(' ') : content

    // 处理私聊和群聊的消息格式
    const promptMessage = session.channelId.startsWith('private:')
      ? [h.quote(session.messageId), formattedContent]
      : [h.quote(session.messageId), h.at(session.userId), '\n', formattedContent]

    await session.send(promptMessage.flat())
  } catch (error) {
    console.error('发送消息失败:', error)
  }
}
