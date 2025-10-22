import { Context, Logger, h } from 'koishi'
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
      this.logger.info(`开始执行活动 ${activityId} 的抽奖开奖`)

      // 获取活动信息
      const activityData = await this.handler.getActivity(activityId)

      if (!activityData) {
        this.logger.error(`活动 ${activityId} 不存在`)
        return
      }

      const { activity, participants } = activityData

      if (activity.status !== 'active') {
        this.logger.warn(`活动 ${activityId} 状态不是进行中: ${activity.status}`)
        return
      }

      // 执行抽奖
      const winners = await this.handler.drawWinners(activityId)

      if (winners.length === 0 || participants.length === 0) {
        this.logger.warn(`抽奖活动 ${activityId} 没有参与者`)
        // 发送无人参与通知
        await this.sendNoParticipantsNotification(activity.guildId, activity.name)
        return
      }

      // 发送开奖通知
      await this.sendWinnerNotification(activity.guildId, activity.name, winners, participants.length)

      this.logger.info(`抽奖活动 ${activityId} 开奖完成，共 ${winners.length} 人中奖，${participants.length} 人参与`)
    } catch (error) {
      this.logger.error(`执行活动 ${activityId} 抽奖失败:`, error)

      try {
        // 即使抽奖失败，也尝试更新状态为已开奖
        await this.handler.updateActivityStatus(activityId, 'drawn')
      } catch (updateError) {
        this.logger.error(`更新活动状态失败:`, updateError)
      }
    }
  }

  // 发送无人参与通知
  private async sendNoParticipantsNotification(guildId: string, title: string): Promise<void> {
    try {
      const messageElements: any[] = [
        `🎊 抽奖活动 "${title}" 已开奖！\n\n`,
        `📊 参与人数: 0\n\n`,
        `💨 本次抽奖无人参与，活动已结束！`
      ]

      // 使用 bot.sendMessage 发送消息到群聊
      for (const bot of this.ctx.bots) {
        try {
          await bot.sendMessage(guildId, messageElements)
          break // 发送成功后跳出循环
        } catch (err) {
          this.logger.warn(`Bot ${bot.sid} 发送开奖通知失败: ${err}`)
        }
      }
    } catch (error) {
      this.logger.error(`发送无人参与通知失败:`, error)
    }
  }

  // 发送中奖通知
  private async sendWinnerNotification(
    guildId: string,
    title: string,
    winners: Array<{ userId: string; username: string; prizeName: string }>,
    participantCount: number
  ): Promise<void> {
    try {
      // 构建消息元素
      const messageElements: any[] = []
      messageElements.push(`🎊 抽奖活动 "${title}" 已开奖！\n\n`)
      messageElements.push(`📊 参与人数: ${participantCount}\n`)

      if (winners.length > 0) {
        messageElements.push(`🎁 中奖名单:\n\n`)

        // 按奖品名称分组
        const prizeGroups = new Map<string, Array<{ userId: string; username: string }>>()
        winners.forEach(winner => {
          const prizeName = winner.prizeName
          if (!prizeGroups.has(prizeName)) {
            prizeGroups.set(prizeName, [])
          }
          prizeGroups.get(prizeName).push({
            userId: winner.userId,
            username: winner.username
          })
        })

        // 按奖品显示中奖者
        prizeGroups.forEach((winnerList, prizeName) => {
          messageElements.push(`【${prizeName}】\n`)
          winnerList.forEach(winner => {
            messageElements.push('- ')
            messageElements.push(h.at(winner.userId))
            messageElements.push('\n')
          })
          messageElements.push('\n')
        })

        messageElements.push(`恭喜以上中奖用户！`)
      } else {
        messageElements.push(`💨 本次抽奖无人中奖，谢谢参与！`)
      }

      // 使用 bot.sendMessage 发送消息到群聊
      for (const bot of this.ctx.bots) {
        try {
          await bot.sendMessage(guildId, messageElements)
          break // 发送成功后跳出循环
        } catch (err) {
          this.logger.warn(`Bot ${bot.sid} 发送开奖通知失败: ${err}`)
        }
      }
    } catch (error) {
      this.logger.error(`发送开奖通知失败:`, error)
    }
  }

  // 设置抽奖定时器
  scheduleRaffleDraw(guildId: string, activityId: string, drawTime: number, title: string): void {
    const delay = drawTime - Date.now()
    if (delay <= 0) {
      this.performRaffleDraw(activityId)
      return
    }

    const key = activityId

    // 清除已存在的定时器
    this.cancelTimer(guildId, activityId)

    const timer = setTimeout(() => {
      this.performRaffleDraw(activityId)
      this.timers.delete(key)
    }, delay)

    this.timers.set(key, timer)
    this.logger.info(`已设置抽奖定时器: ${title}, 开奖时间: ${formatTime(drawTime)}`)
  }

  // 初始化已有的抽奖定时器
  async initializeRaffleTimers(): Promise<void> {
    try {
      this.logger.info('初始化抽奖定时器...')

      // 清理现有定时器
      this.clearAllTimers()

      // 获取所有进行中的活动
      const activities = await this.ctx.database.get('raffle_activity', { status: 'active' })

      for (const activity of activities) {
        const { guildId, id, drawTime, name } = activity
        const now = Date.now()
        const delay = drawTime - now

        if (delay > 0) {
          // 设置定时器
          this.scheduleRaffleDraw(guildId, id, drawTime, name)
          this.logger.info(`为群 ${guildId} 的活动 ${id} 设置定时器，将在 ${Math.round(delay / 1000)} 秒后结束`)
        } else {
          // 已经超时，立即执行抽奖
          this.logger.warn(`群 ${guildId} 的活动 ${id} 已超时，立即执行抽奖`)
          await this.performRaffleDraw(id)
        }
      }

      this.logger.info(`定时器初始化完成，共设置 ${this.timers.size} 个定时器`)
    } catch (error) {
      this.logger.error(`初始化抽奖定时器失败: ${error}`)
    }
  }

  // 取消定时器
  cancelTimer(guildId: string, activityId: string): void {
    const timer = this.timers.get(activityId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(activityId)
      this.logger.debug(`清除定时器: ${activityId}`)
    }
  }

  // 清理所有定时器
  clearAllTimers(): void {
    this.timers.forEach(timer => clearTimeout(timer))
    this.timers.clear()
    this.logger.info('已清理所有抽奖定时器')
  }

  // 获取当前活动定时器数量
  getTimerCount(): number {
    return this.timers.size
  }

  // 检查指定活动是否有定时器
  hasTimer(guildId: string, activityId: string): boolean {
    return this.timers.has(activityId)
  }

  // 销毁定时器管理器
  dispose(): void {
    this.clearAllTimers()
    this.logger.info('定时器管理器已销毁')
  }
}
