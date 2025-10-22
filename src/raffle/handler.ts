import { Context } from 'koishi'
import { RaffleActivity, RaffleParticipant, RafflePrize, RaffleWinner } from '../types'

export class RaffleHandler {
  constructor(private ctx: Context) {}

  // 初始化数据库表
  async initializeTables(): Promise<void> {
    // 抽奖活动表
    this.ctx.model.extend('raffle_activity', {
      id: 'string',
      name: 'string',
      guildId: 'string',
      drawTime: 'unsigned',
      status: {
        type: 'string',
        initial: 'pending'
      },
      createdBy: 'string',
      createdAt: 'unsigned',
      keyword: {
        type: 'string',
        nullable: true
      },
      emojiId: {
        type: 'string',
        nullable: true
      },
      announceMessageId: {
        type: 'string',
        nullable: true
      }
    }, {
      primary: 'id',
      autoInc: false
    })

    // 抽奖参与者表
    this.ctx.model.extend('raffle_participant', {
      id: 'unsigned',
      activityId: 'string',
      userId: 'string',
      username: 'string',
      joinedAt: 'unsigned'
    }, {
      primary: 'id',
      autoInc: true,
      foreign: {
        activityId: ['raffle_activity', 'id']
      }
    })

    // 抽奖奖品表
    this.ctx.model.extend('raffle_prize', {
      id: 'unsigned',
      activityId: 'string',
      name: 'string',
      description: 'text',
      count: 'unsigned'
    }, {
      primary: 'id',
      autoInc: true,
      foreign: {
        activityId: ['raffle_activity', 'id']
      }
    })

    // 抽奖中奖者表
    this.ctx.model.extend('raffle_winner', {
      id: 'unsigned',
      activityId: 'string',
      userId: 'string',
      username: 'string',
      prizeName: 'string',
      wonAt: 'unsigned'
    }, {
      primary: 'id',
      autoInc: true,
      foreign: {
        activityId: ['raffle_activity', 'id']
      }
    })
  }

  // 创建抽奖活动
  async createActivity(activity: Omit<RaffleActivity, 'createdAt' | 'status'>): Promise<RaffleActivity> {
    const newActivity: RaffleActivity = {
      ...activity,
      status: 'pending',
      createdAt: Date.now()
    }

    await this.ctx.database.create('raffle_activity', newActivity)
    return newActivity
  }

  // 添加奖品
  async addPrizes(activityId: string, prizes: Array<Omit<RafflePrize, 'id' | 'activityId'>>): Promise<void> {
    const prizesToAdd = prizes.map(prize => ({
      activityId,
      name: prize.name,
      description: prize.description,
      count: prize.count
    }))

    for (const prize of prizesToAdd) {
      await this.ctx.database.create('raffle_prize', prize)
    }
  }

  // 获取活动详情(包含奖品和参与者)
  async getActivity(activityId: string): Promise<{
    activity: RaffleActivity
    prizes: RafflePrize[]
    participants: RaffleParticipant[]
  } | null> {
    const [activity] = await this.ctx.database.get('raffle_activity', { id: activityId })
    if (!activity) return null

    const prizes = await this.ctx.database.get('raffle_prize', { activityId })
    const participants = await this.ctx.database.get('raffle_participant', { activityId })

    return { activity, prizes, participants }
  }

  // 获取群组的所有活动
  async getGuildActivities(guildId: string, status?: RaffleActivity['status']): Promise<RaffleActivity[]> {
    const query: any = { guildId }
    if (status) {
      query.status = status
    }
    return await this.ctx.database.get('raffle_activity', query)
  }

  // 更新活动状态
  async updateActivityStatus(activityId: string, status: RaffleActivity['status']): Promise<void> {
    await this.ctx.database.set('raffle_activity', { id: activityId }, { status })
  }

  // 更新活动播报消息ID
  async updateAnnounceMessageId(activityId: string, messageId: string): Promise<void> {
    await this.ctx.database.set('raffle_activity', { id: activityId }, { announceMessageId: messageId })
  }

  // 添加参与者
  async addParticipant(activityId: string, userId: string, username: string): Promise<boolean> {
    // 检查是否已参与
    const existing = await this.ctx.database.get('raffle_participant', {
      activityId,
      userId
    })

    if (existing.length > 0) {
      return false
    }

    await this.ctx.database.create('raffle_participant', {
      activityId,
      userId,
      username,
      joinedAt: Date.now()
    })

    return true
  }

  // 获取参与者数量
  async getParticipantCount(activityId: string): Promise<number> {
    const participants = await this.ctx.database.get('raffle_participant', { activityId })
    return participants.length
  }

  // 检查用户是否已参与
  async hasUserJoined(activityId: string, userId: string): Promise<boolean> {
    const participants = await this.ctx.database.get('raffle_participant', {
      activityId,
      userId
    })
    return participants.length > 0
  }

  // 执行抽奖
  async drawWinners(activityId: string): Promise<RaffleWinner[]> {
    const activityData = await this.getActivity(activityId)
    if (!activityData) {
      throw new Error('活动不存在')
    }

    const { activity, prizes, participants } = activityData

    if (activity.status !== 'active') {
      throw new Error('活动状态不正确')
    }

    const winners: RaffleWinner[] = []
    const availableParticipants = [...participants]

    for (const prize of prizes) {
      for (let i = 0; i < prize.count && availableParticipants.length > 0; i++) {
        const randomIndex = Math.floor(Math.random() * availableParticipants.length)
        const winner = availableParticipants.splice(randomIndex, 1)[0]

        const winnerRecord: Omit<RaffleWinner, 'id'> = {
          activityId,
          userId: winner.userId,
          username: winner.username,
          prizeName: prize.name,
          wonAt: Date.now()
        }

        await this.ctx.database.create('raffle_winner', winnerRecord)
        winners.push(winnerRecord as RaffleWinner)
      }
    }

    // 更新活动状态为已开奖
    await this.updateActivityStatus(activityId, 'drawn')

    return winners
  }

  // 获取中奖者列表
  async getWinners(activityId: string): Promise<RaffleWinner[]> {
    return await this.ctx.database.get('raffle_winner', { activityId })
  }

  // 取消活动
  async cancelActivity(activityId: string): Promise<void> {
    await this.updateActivityStatus(activityId, 'cancelled')
  }

  // 删除活动(及相关数据)
  async deleteActivity(activityId: string): Promise<void> {
    // 删除相关记录
    await this.ctx.database.remove('raffle_participant', { activityId })
    await this.ctx.database.remove('raffle_prize', { activityId })
    await this.ctx.database.remove('raffle_winner', { activityId })
    await this.ctx.database.remove('raffle_activity', { id: activityId })
  }
}
