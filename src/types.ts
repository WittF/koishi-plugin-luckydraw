import { Schema } from 'koishi'

// ===== 类型扩展 =====
declare module 'koishi' {
  interface Session {
    onebot?: any
  }

  interface Events {
    'notice'(session: Session): void
  }

  interface Tables {
    // 抽奖系统表
    raffle_activity: RaffleActivity
    raffle_participant: RaffleParticipant
    raffle_prize: RafflePrize
    raffle_winner: RaffleWinner

    // 抽签系统表
    lottery_pool: LotteryPool
    lottery_prize: LotteryPrize
    user_lottery_draws: UserLotteryDraws
  }
}

// ===== 配置接口 =====
export interface Config {
  adminQQ: string   // 管理员 QQ 号
  debugMode: boolean // 调试模式
}

export const schema: Schema<Config> = Schema.object({
  adminQQ: Schema.string().description('管理员 QQ 号').default(''),
  debugMode: Schema.boolean().description('启用调试模式').default(false),
})

// ===== 数据库表接口定义 =====

// 抽奖活动表
export interface RaffleActivity {
  id: string              // 活动ID (主键)
  name: string            // 活动名称
  guildId: string         // 群组ID
  drawTime: number        // 开奖时间戳
  status: 'pending' | 'active' | 'drawn' | 'cancelled'  // 活动状态
  createdBy: string       // 创建者ID
  createdAt: number       // 创建时间戳
  keyword: string         // 参与口令 (可选)
  emojiId: string         // 参与表情ID (可选)
  announceMessageId: string  // 播报消息ID (可选)
}

// 抽奖参与者表
export interface RaffleParticipant {
  id: number              // 自增ID (主键)
  activityId: string      // 活动ID (外键)
  userId: string          // 用户ID
  username: string        // 用户名
  joinedAt: number        // 参与时间戳
}

// 抽奖奖品表
export interface RafflePrize {
  id: number              // 自增ID (主键)
  activityId: string      // 活动ID (外键)
  name: string            // 奖品名称
  description: string     // 奖品描述
  count: number           // 奖品数量
}

// 抽奖中奖者表
export interface RaffleWinner {
  id: number              // 自增ID (主键)
  activityId: string      // 活动ID (外键)
  userId: string          // 用户ID
  username: string        // 用户名
  prizeName: string       // 奖品名称
  wonAt: number           // 中奖时间戳
}

// 抽签池表
export interface LotteryPool {
  id: number              // 自增ID (主键)
  poolName: string        // 抽签池名称 (唯一)
  maxDraws: number        // 最大抽取次数 (0表示无限制)
}

// 抽签奖品表
export interface LotteryPrize {
  id: number              // 自增ID (主键)
  poolId: number          // 抽签池ID (外键)
  prizeId: number         // 奖品序号
  name: string            // 奖品名称
  description: string     // 奖品描述
}

// 用户抽签记录表
export interface UserLotteryDraws {
  id: number              // 自增ID (主键)
  userId: string          // 用户ID
  poolName: string        // 抽签池名称
  drawCount: number       // 已抽取次数
}

// ===== 辅助类型 =====
export interface Prize {
  id: number
  name: string
  description: string
}

export interface RaffleData {
  [activityId: string]: RaffleActivity
}
