import { Context } from 'koishi'
import { LotteryPool, LotteryPrize, UserLotteryDraws, Prize } from '../types'

export class LotteryHandler {
  constructor(private ctx: Context) {}

  // 初始化数据库表
  async initializeTables(): Promise<void> {
    // 抽签池表
    this.ctx.model.extend('lottery_pool', {
      id: 'unsigned',
      poolName: {
        type: 'string',
        length: 255
      },
      maxDraws: {
        type: 'unsigned',
        initial: 0
      }
    }, {
      primary: 'id',
      autoInc: true,
      unique: ['poolName']
    })

    // 抽签奖品表
    this.ctx.model.extend('lottery_prize', {
      id: 'unsigned',
      poolId: 'unsigned',
      prizeId: 'unsigned',
      name: 'string',
      description: 'text'
    }, {
      primary: 'id',
      autoInc: true,
      foreign: {
        poolId: ['lottery_pool', 'id']
      }
    })

    // 用户抽签记录表
    this.ctx.model.extend('user_lottery_draws', {
      id: 'unsigned',
      userId: 'string',
      poolName: 'string',
      drawCount: {
        type: 'unsigned',
        initial: 0
      }
    }, {
      primary: 'id',
      autoInc: true
    })
  }

  // 创建或更新抽签池
  async createOrUpdatePool(poolName: string, prizes: Prize[], maxDraws: number = 0): Promise<void> {
    // 检查抽签池是否存在
    const existingPools = await this.ctx.database.get('lottery_pool', { poolName })

    let poolId: number

    if (existingPools.length > 0) {
      // 更新最大抽取次数
      poolId = existingPools[0].id
      await this.ctx.database.set('lottery_pool', { id: poolId }, { maxDraws })

      // 删除旧奖品
      await this.ctx.database.remove('lottery_prize', { poolId })
    } else {
      // 创建新抽签池
      const newPool = await this.ctx.database.create('lottery_pool', {
        poolName,
        maxDraws
      })
      poolId = newPool.id
    }

    // 添加奖品
    for (const prize of prizes) {
      await this.ctx.database.create('lottery_prize', {
        poolId,
        prizeId: prize.id,
        name: prize.name,
        description: prize.description
      })
    }
  }

  // 获取抽签池及其奖品
  async getPool(poolName: string): Promise<{ pool: LotteryPool; prizes: LotteryPrize[] } | null> {
    const pools = await this.ctx.database.get('lottery_pool', { poolName })
    if (pools.length === 0) return null

    const pool = pools[0]
    const prizes = await this.ctx.database.get('lottery_prize', { poolId: pool.id })

    return { pool, prizes }
  }

  // 获取所有抽签池
  async getAllPools(): Promise<Array<{ pool: LotteryPool; prizes: LotteryPrize[] }>> {
    const pools = await this.ctx.database.get('lottery_pool', {})
    const result = []

    for (const pool of pools) {
      const prizes = await this.ctx.database.get('lottery_prize', { poolId: pool.id })
      result.push({ pool, prizes })
    }

    return result
  }

  // 获取用户在指定抽签池的抽取次数
  async getUserDrawCount(userId: string, poolName: string): Promise<number> {
    const records = await this.ctx.database.get('user_lottery_draws', {
      userId,
      poolName
    })

    if (records.length === 0) return 0
    return records[0].drawCount
  }

  // 增加用户抽取次数
  async incrementUserDrawCount(userId: string, poolName: string): Promise<number> {
    const records = await this.ctx.database.get('user_lottery_draws', {
      userId,
      poolName
    })

    if (records.length === 0) {
      // 创建新记录
      await this.ctx.database.create('user_lottery_draws', {
        userId,
        poolName,
        drawCount: 1
      })
      return 1
    } else {
      // 更新现有记录
      const newCount = records[0].drawCount + 1
      await this.ctx.database.set('user_lottery_draws', {
        userId,
        poolName
      }, {
        drawCount: newCount
      })
      return newCount
    }
  }

  // 执行抽签
  async draw(userId: string, poolName: string): Promise<Prize | null> {
    // 获取抽签池信息
    const poolData = await this.getPool(poolName)
    if (!poolData) {
      throw new Error('抽签池不存在')
    }

    const { pool, prizes } = poolData

    // 检查抽取次数限制
    if (pool.maxDraws > 0) {
      const currentCount = await this.getUserDrawCount(userId, poolName)
      if (currentCount >= pool.maxDraws) {
        return null // 已达到最大抽取次数
      }
    }

    // 随机抽取
    if (prizes.length === 0) {
      throw new Error('抽签池中没有奖品')
    }

    const randomIndex = Math.floor(Math.random() * prizes.length)
    const selectedPrize = prizes[randomIndex]

    // 增加抽取次数
    await this.incrementUserDrawCount(userId, poolName)

    return {
      id: selectedPrize.prizeId,
      name: selectedPrize.name,
      description: selectedPrize.description
    }
  }

  // 删除抽签池
  async deletePool(poolName: string): Promise<void> {
    const pools = await this.ctx.database.get('lottery_pool', { poolName })
    if (pools.length === 0) return

    const poolId = pools[0].id

    // 删除相关记录
    await this.ctx.database.remove('lottery_prize', { poolId })
    await this.ctx.database.remove('user_lottery_draws', { poolName })
    await this.ctx.database.remove('lottery_pool', { id: poolId })
  }

  // 重置用户抽签次数
  async resetUserDraws(userId: string, poolName?: string): Promise<void> {
    if (poolName) {
      await this.ctx.database.remove('user_lottery_draws', {
        userId,
        poolName
      })
    } else {
      await this.ctx.database.remove('user_lottery_draws', { userId })
    }
  }
}
