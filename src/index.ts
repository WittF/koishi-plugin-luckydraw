import { Context, Logger, h } from 'koishi'
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

  // 初始化处理器
  const lotteryHandler = new LotteryHandler(ctx)
  const raffleHandler = new RaffleHandler(ctx)
  const raffleTimerManager = new RaffleTimerManager(ctx, raffleHandler, logger)

  // 初始化数据库表
  lotteryHandler.initializeTables().catch((error) => {
    logger.error(`初始化抽签表时出错: ${error.message}`)
  })
  raffleHandler.initializeTables().catch((error) => {
    logger.error(`初始化抽奖表时出错: ${error.message}`)
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
      // 查找匹配口令的活动
      const activities = await raffleHandler.getGuildActivities(session.guildId, 'active')

      for (const activity of activities) {
        if (activity.keyword && activity.keyword === messageContent) {
          // 检查是否已经参与
          const alreadyJoined = await raffleHandler.hasUserJoined(activity.id, session.userId)
          if (alreadyJoined) {
            return // 静默处理，不提示
          }

          // 添加参与者
          const added = await raffleHandler.addParticipant(
            activity.id,
            session.userId,
            session.username || '未知用户'
          )

          if (added) {
            // 获取当前参与人数
            const participantCount = await raffleHandler.getParticipantCount(activity.id)

            // 发送临时消息，5秒后撤回
            await sendTemporaryJoinMessage(
              session.bot,
              session.guildId,
              activity.name,
              activity.id,
              participantCount,
              config.debugMode,
              logger,
              session.userId,
              activity.announceMessageId
            )

            if (config.debugMode) {
              logger.info(`用户 ${session.username} (${session.userId}) 通过口令"${activity.keyword}"参与了抽奖活动 ${activity.id}`)
            }
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
      // 获取所有进行中的活动
      const guildId = session.guildId
      if (!guildId) return

      const activities = await raffleHandler.getGuildActivities(guildId, 'active')

      logger.info(`[抽奖参与] 当前活动总数: ${activities.length}`)

      // 查找匹配的活动（消息ID匹配）
      for (const activity of activities) {
        logger.info(`[抽奖参与] 检查活动 ${activity.id}: announceMessageId=${activity.announceMessageId} (类型: ${typeof activity.announceMessageId}), messageId=${messageId} (类型: ${typeof messageId}), status=${activity.status}, emojiId=${activity.emojiId}`)

        if (
          activity.announceMessageId?.toString() === messageId?.toString() &&
          activity.status === 'active' &&
          activity.emojiId
        ) {
          logger.info(`[抽奖参与] 找到匹配活动: ${activity.id}, 要求表情: ${activity.emojiId}`)

          // 检查表情回应中是否包含活动要求的表情
          const hasRequiredEmoji = likes.some(like => like.emoji_id === activity.emojiId)
          logger.info(`[抽奖参与] 表情匹配检查: 要求=${activity.emojiId}, 收到=${JSON.stringify(likes)}, 匹配=${hasRequiredEmoji}`)

          if (!hasRequiredEmoji) {
            logger.info(`[抽奖参与] 表情不匹配，跳过`)
            continue
          }

          // 检查是否已经参与
          const alreadyJoined = await raffleHandler.hasUserJoined(activity.id, userId)
          const participantCount = await raffleHandler.getParticipantCount(activity.id)
          logger.info(`[抽奖参与] 用户参与检查: userId=${userId}, 已参与=${alreadyJoined}, 当前参与人数=${participantCount}`)

          if (alreadyJoined) {
            logger.info(`[抽奖参与] 用户已参与，跳过`)
            continue
          }

          // 获取用户信息
          const username = session.username || '未知用户'

          // 添加参与者
          const added = await raffleHandler.addParticipant(activity.id, userId, username)

          if (added) {
            if (config.debugMode) {
              logger.info(`[抽奖参与] 用户 ${username} (${userId}) 成功参与抽奖活动 ${activity.id}`)
            }

            // 发送临时消息，5秒后撤回
            const newCount = await raffleHandler.getParticipantCount(activity.id)
            await sendTemporaryJoinMessage(
              session.bot,
              guildId,
              activity.name,
              activity.id,
              newCount,
              config.debugMode,
              logger,
              userId,
              activity.announceMessageId
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
