import { Context, Logger, h } from 'koishi'
import { RaffleActivity } from '../types'
import { RaffleHandler } from './handler'
import { formatTime } from '../utils'

export class RaffleTimerManager {
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private ctx: Context,
    private handler: RaffleHandler,
    private logger: Logger
  ) {}

  // 执行抽奖开奖
  async performRaffleDraw(activityId: string): Promise<void> {
    try {
      // 重新加载最新的活动数据
      const raffleData = await this.handler.loadRaffleData()
      const activity = raffleData[activityId]

      if (!activity) {
        this.logger.error(`抽奖活动 ${activityId} 不存在`)
        return
      }

      this.logger.info(`开始执行抽奖开奖: ${activity.name} (${activityId})`)

      if (activity.participants.length === 0) {
        this.logger.warn(`抽奖活动 ${activityId} 没有参与者`)
        activity.status = 'drawn'
        activity.winners = []
        raffleData[activityId] = activity
        await this.handler.saveRaffleData(raffleData)
        return
      }

      // 计算总奖品数量（包含None奖品，用于分配逻辑）
      const totalPrizes = activity.prizes.reduce((sum, p) => sum + p.count, 0)

      // 如果参与人数少于奖品总数，所有人都能中奖
      const winnersCount = Math.min(totalPrizes, activity.participants.length)

      // 打乱参与者顺序
      const shuffled = [...activity.participants].sort(() => Math.random() - 0.5)

      // 分配奖品
      const winners: Array<{ userId: string; username: string; prize: string }> = []
      let participantIndex = 0

      for (const prize of activity.prizes) {
        for (let i = 0; i < prize.count && participantIndex < winnersCount; i++) {
          const participant = shuffled[participantIndex]
          winners.push({
            userId: participant.userId,
            username: participant.username,
            prize: `${prize.name} - ${prize.description}`
          })
          participantIndex++
        }
      }

      // 为未中奖的参与者分配"未中奖"状态
      while (participantIndex < shuffled.length) {
        const participant = shuffled[participantIndex]
        winners.push({
          userId: participant.userId,
          username: participant.username,
          prize: 'None - none'
        })
        participantIndex++
      }

      // 更新活动状态
      activity.status = 'drawn'
      activity.winners = winners
      raffleData[activityId] = activity
      await this.handler.saveRaffleData(raffleData)

      // 发送开奖通知
      if (activity.guildId) {
        try {
          // 只显示真正中奖的用户（排除None - none，不区分大小写）
          const realWinners = winners.filter(w => w.prize.toLowerCase() !== 'none - none')

          // 构建消息元素
          const messageElements: any[] = []
          messageElements.push(`🎊 抽奖活动 "${activity.name}" 已开奖！\n\n`)
          messageElements.push(`📊 参与人数: ${activity.participants.length}\n`)

          if (realWinners.length > 0) {
            messageElements.push(`🎁 中奖名单:\n\n`)
            realWinners.forEach((winner, index) => {
              messageElements.push(`${index + 1}. `)
              messageElements.push(h.at(winner.userId))
              messageElements.push(`\n   奖品: ${winner.prize}\n`)
            })
            messageElements.push(`恭喜以上中奖用户！`)
          } else {
            messageElements.push(`💨 本次抽奖无人中奖，谢谢参与！`)
          }

          // 使用 bot.sendMessage 发送消息到群聊
          for (const bot of this.ctx.bots) {
            try {
              await bot.sendMessage(activity.guildId, messageElements)
              break // 发送成功后跳出循环
            } catch (err) {
              this.logger.warn(`Bot ${bot.sid} 发送开奖通知失败: ${err}`)
            }
          }
        } catch (error) {
          this.logger.error(`发送开奖通知失败: ${error}`)
        }
      }

      this.logger.info(`抽奖活动 ${activityId} 开奖完成，共 ${winners.length} 人参与`)
    } catch (error) {
      this.logger.error(`执行抽奖开奖失败: ${error}`)
    }
  }

  // 设置抽奖定时器
  scheduleRaffleDraw(activityId: string, activity: RaffleActivity): void {
    const delay = activity.drawTime - Date.now()
    if (delay <= 0) {
      this.performRaffleDraw(activityId)
      return
    }

    const timer = setTimeout(() => {
      this.performRaffleDraw(activityId)
      this.timers.delete(activityId)
    }, delay)

    this.timers.set(activityId, timer)
    this.logger.info(`已设置抽奖定时器: ${activity.name}, 开奖时间: ${formatTime(activity.drawTime)}`)
  }

  // 初始化已有的抽奖定时器
  async initializeRaffleTimers(): Promise<void> {
    try {
      const raffleData = await this.handler.loadRaffleData()
      for (const [activityId, activity] of Object.entries(raffleData)) {
        if (activity.status === 'active' && activity.drawTime > Date.now()) {
          this.scheduleRaffleDraw(activityId, activity)
        }
      }
      this.logger.info('抽奖定时器初始化完成')
    } catch (error) {
      this.logger.error(`初始化抽奖定时器失败: ${error}`)
    }
  }

  // 取消定时器
  cancelTimer(activityId: string): void {
    const timer = this.timers.get(activityId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(activityId)
    }
  }

  // 清理所有定时器
  clearAllTimers(): void {
    this.timers.forEach(timer => clearTimeout(timer))
    this.timers.clear()
    this.logger.info('已清理所有抽奖定时器')
  }
}
