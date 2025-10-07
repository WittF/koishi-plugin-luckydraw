import { Schema } from 'koishi'

// ===== 配置接口 =====
export interface Config {
  adminQQ: string   // 管理员 QQ 号
  debugMode: boolean // 调试模式
}

export const schema: Schema<Config> = Schema.object({
  adminQQ: Schema.string().description('管理员 QQ 号').default(''),
  debugMode: Schema.boolean().description('启用调试模式').default(false),
})

// ===== 抽签相关接口 =====
export interface Prize {
  id: number
  name: string
  description: string
}

export interface LotteryPool {
  [poolName: string]: {
    prizes: Prize[]
    max?: number
  }
}

export interface UserDrawEntries {
  [userId: string]: {
    [poolName: string]: number
  }
}

// ===== 抽奖相关接口 =====
export interface RafflePrize {
  name: string
  description: string
  count: number
}

export interface RaffleActivity {
  id: string
  name: string
  guildId?: string
  prizes: RafflePrize[]
  participants: Array<{ userId: string; username: string; joinedAt: number }>
  drawTime: number
  status: 'pending' | 'active' | 'drawn' | 'cancelled'
  createdBy: string
  createdAt: number
  keyword?: string  // 参与口令
  winners?: Array<{ userId: string; username: string; prize: string }>
}

export interface RaffleData {
  [activityId: string]: RaffleActivity
}
