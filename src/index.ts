import { Context, Logger, h } from 'koishi'
import * as path from 'path'
import * as fs from 'fs/promises'
import { Config, schema } from './types'
import { LotteryHandler } from './lottery/handler'
import { registerLotteryCommands } from './lottery/commands'
import { RaffleHandler } from './raffle/handler'
import { RaffleTimerManager } from './raffle/timer'
import { registerRaffleCommands } from './raffle/commands'
import { sendTemporaryJoinMessage } from './utils'

export const name = 'lucky-draw'
export { Config, schema } from './types'

export function apply(ctx: Context, config: Config) {
  const logger = new Logger('lucky-draw')

  // 1. 构建保存文件的目录：ctx.baseDir/data/luckydraw
  const root = path.join(ctx.baseDir, 'data', 'luckydraw')

  // 2. 如果目录不存在则递归创建
  fs.mkdir(root, { recursive: true }).catch((error) => {
    logger.error(`创建 luckydraw 数据目录失败: ${error.message}`)
  })

  // 3. 定义文件路径
  const lotteryPoolFilePath = path.join(root, 'lottery_pools.json')
  const userDrawEntriesFilePath = path.join(root, 'user_draw_entries.json')
  const raffleDataFilePath = path.join(root, 'raffle_activities.json')

  // 初始化处理器
  const lotteryHandler = new LotteryHandler(lotteryPoolFilePath, userDrawEntriesFilePath)
  const raffleHandler = new RaffleHandler(raffleDataFilePath)
  const raffleTimerManager = new RaffleTimerManager(ctx, raffleHandler, logger)

  // 初始化文件
  lotteryHandler.initializeFiles().catch((error) => {
    logger.error(`初始化抽签文件时出错: ${error.message}`)
  })
  raffleHandler.initializeFiles().catch((error) => {
    logger.error(`初始化抽奖文件时出错: ${error.message}`)
  })

  // 初始化抽奖定时器
  raffleTimerManager.initializeRaffleTimers().catch((error) => {
    logger.error(`初始化抽奖定时器时出错: ${error.message}`)
  })

  // 如果启用了调试模式，则输出调试信息
  if (config.debugMode) {
    logger.info('🚀 LuckyDraw 插件已加载，调试模式已启用')
  }

  // 注册抽签命令
  registerLotteryCommands(ctx, config, lotteryHandler, logger)

  // 注册抽奖命令
  registerRaffleCommands(ctx, config, raffleHandler, raffleTimerManager, logger)

  // 监听消息，处理抽奖口令
  ctx.on('message', async (session) => {
    // 跳过命令消息
    if (session.content?.startsWith('.') || session.content?.startsWith('/')) {
      return
    }

    // 只处理群聊消息
    if (!session.guildId) {
      return
    }

    const messageContent = session.content?.trim()
    if (!messageContent) {
      return
    }

    try {
      const raffleData = await raffleHandler.loadRaffleData()

      // 查找匹配口令的活动
      for (const [activityId, activity] of Object.entries(raffleData)) {
        if (
          activity.keyword &&
          activity.keyword === messageContent &&
          activity.status === 'active' &&
          activity.guildId === session.guildId
        ) {
          // 检查是否已经参与
          const alreadyJoined = activity.participants.some(p => p.userId === session.userId)
          if (alreadyJoined) {
            return // 静默处理，不提示
          }

          // 添加参与者
          activity.participants.push({
            userId: session.userId,
            username: session.username || '未知用户',
            joinedAt: Date.now()
          })

          raffleData[activityId] = activity
          await raffleHandler.saveRaffleData(raffleData)

          // 发送临时消息，5秒后撤回
          await sendTemporaryJoinMessage(
            session.bot,
            session.guildId,
            activity.name,
            activityId,
            activity.participants.length,
            config.debugMode,
            logger
          )

          if (config.debugMode) {
            logger.info(`用户 ${session.username} (${session.userId}) 通过口令"${activity.keyword}"参与了抽奖活动 ${activityId}`)
          }

          return
        }
      }
    } catch (error) {
      // 静默处理错误，不干扰正常消息
      if (config.debugMode) {
        logger.error(`处理抽奖口令时出错: ${error}`)
      }
    }
  })

  // 监听表情回应事件，处理抽奖参与
  ctx.on('notice', async (session) => {
    if (session.subtype !== 'group-msg-emoji-like') {
      return
    }

    const data = session.onebot as any
    const messageId = data.message_id
    const userId = data.user_id?.toString()
    const likes = data.likes || []

    if (config.debugMode) {
      logger.info(`[抽奖参与] 收到表情回应事件: messageId=${messageId}, userId=${userId}, likes=${JSON.stringify(likes)}`)
    }

    if (!messageId || !userId || likes.length === 0) {
      return
    }

    try {
      const raffleData = await raffleHandler.loadRaffleData()

      // 查找匹配的活动（消息ID匹配）
      for (const [activityId, activity] of Object.entries(raffleData)) {
        if (
          activity.announceMessageId === messageId &&
          activity.status === 'active' &&
          activity.emojiId
        ) {
          if (config.debugMode) {
            logger.info(`[抽奖参与] 找到匹配活动: ${activityId}, 要求表情: ${activity.emojiId}`)
          }

          // 检查表情回应中是否包含活动要求的表情
          const hasRequiredEmoji = likes.some(like => like.emoji_id === activity.emojiId)
          if (!hasRequiredEmoji) {
            if (config.debugMode) {
              logger.info(`[抽奖参与] 表情不匹配，跳过`)
            }
            continue
          }

          // 检查是否已经参与
          const alreadyJoined = activity.participants.some(p => p.userId === userId)
          if (alreadyJoined) {
            if (config.debugMode) {
              logger.info(`[抽奖参与] 用户已参与，跳过`)
            }
            continue
          }

          // 获取用户信息
          const username = session.username || '未知用户'

          // 添加参与者
          activity.participants.push({
            userId: userId,
            username: username,
            joinedAt: Date.now()
          })

          raffleData[activityId] = activity
          await raffleHandler.saveRaffleData(raffleData)

          if (config.debugMode) {
            logger.info(`[抽奖参与] 用户 ${username} (${userId}) 成功参与抽奖活动 ${activityId}`)
          }

          // 发送临时消息，5秒后撤回
          const guildId = activity.guildId || session.guildId
          if (guildId) {
            await sendTemporaryJoinMessage(
              session.bot,
              guildId,
              activity.name,
              activityId,
              activity.participants.length,
              config.debugMode,
              logger
            )
          }

          break
        }
      }
    } catch (error) {
      if (config.debugMode) {
        logger.error(`[抽奖参与] 处理表情回应参与时出错: ${error}`)
      }
    }
  })

  // 插件卸载时清理定时器
  ctx.on('dispose', () => {
    raffleTimerManager.clearAllTimers()
  })
}
