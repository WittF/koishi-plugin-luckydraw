import { Context, Logger, Session } from 'koishi'
import { Config, RafflePrize } from '../types'
import { RaffleHandler } from './handler'
import { RaffleTimerManager } from './timer'
import { sendMessage, generateActivityId, checkAdmin, formatTime, parseTimeString } from '../utils'

export function registerRaffleCommands(
  ctx: Context,
  config: Config,
  handler: RaffleHandler,
  timerManager: RaffleTimerManager,
  logger: Logger
) {
  // `raffle.create` 命令：交互式创建抽奖活动
  ctx.command('raffle.create', '创建抽奖活动（交互式）')
    .action(async ({ session }) => {
      const userId = session.userId

      // 验证管理员身份
      if (!checkAdmin(userId, config.adminQQ)) {
        await sendMessage(session, '❌ 你没有权限创建抽奖活动，只有管理员可以操作！')
        return
      }

      // 检查是否在群聊中
      if (!session.guildId) {
        await sendMessage(session, '❌ 抽奖活动只能在群聊中创建！')
        return
      }

      try {
        // 步骤1: 输入活动名称
        await sendMessage(session, '📝 请输入抽奖活动名称：')
        const activityName = await session.prompt(60000)
        if (!activityName) {
          await sendMessage(session, '⏱️ 输入超时，已取消创建。')
          return
        }

        // 步骤2: 输入开奖时间
        await sendMessage(session, '⏰ 请输入开奖时间\n支持格式：\n• 相对时间: 1h（1小时后）、30m（30分钟后）、1d（1天后）\n• 今天时间: 18:00\n• 绝对时间: 2024-12-31 18:00')
        const timeInput = await session.prompt(60000)
        if (!timeInput) {
          await sendMessage(session, '⏱️ 输入超时，已取消创建。')
          return
        }

        const drawTime = parseTimeString(timeInput)
        if (!drawTime) {
          await sendMessage(session, '❌ 时间格式无效，请重试。')
          return
        }

        if (drawTime <= Date.now()) {
          await sendMessage(session, '❌ 开奖时间必须晚于当前时间！')
          return
        }

        // 步骤3: 输入奖品信息
        await sendMessage(session, '🎁 请输入奖品信息\n格式：奖品名称|奖品描述|数量\n例如：一等奖|iPhone 15 Pro|1\n支持多行输入，每行一个奖品')
        const prizesInput = await session.prompt(120000)
        if (!prizesInput) {
          await sendMessage(session, '⏱️ 输入超时，已取消创建。')
          return
        }

        // 解析奖品信息
        const prizes: RafflePrize[] = []
        const lines = prizesInput.split('\n').map(l => l.trim()).filter(l => l.length > 0)

        for (const line of lines) {
          const parts = line.split('|').map(p => p.trim())
          if (parts.length !== 3) {
            await sendMessage(session, `❌ 格式错误: "${line}"\n请使用格式: 奖品名称|奖品描述|数量`)
            return
          }

          const [name, description, countStr] = parts
          const count = parseInt(countStr)

          if (isNaN(count) || count <= 0) {
            await sendMessage(session, `❌ 数量必须为正整数: "${line}"`)
            return
          }

          prizes.push({ name, description, count })
        }

        if (prizes.length === 0) {
          await sendMessage(session, '❌ 至少需要添加一个奖品！')
          return
        }

        // 步骤4: 询问是否设置口令
        await sendMessage(session, '🔑 是否设置参与口令？\n发送口令文字，或发送"跳过"不设置口令')
        const keywordInput = await session.prompt(60000)
        if (!keywordInput) {
          await sendMessage(session, '⏱️ 输入超时，已取消创建。')
          return
        }

        const keyword = keywordInput.trim() === '跳过' ? undefined : keywordInput.trim()

        // 创建抽奖活动
        const activityId = generateActivityId()
        const activity = {
          id: activityId,
          name: activityName,
          guildId: session.guildId,
          prizes,
          participants: [],
          drawTime,
          status: 'active' as const,
          createdBy: userId,
          createdAt: Date.now(),
          keyword
        }

        const raffleData = await handler.loadRaffleData()
        raffleData[activityId] = activity
        await handler.saveRaffleData(raffleData)

        // 设置定时开奖
        timerManager.scheduleRaffleDraw(activityId, activity)

        // 发送确认消息
        const totalPrizes = prizes.reduce((sum, p) => sum + p.count, 0)
        let confirmMsg = `✅ 抽奖活动创建成功！\n\n`
        confirmMsg += `🎉 活动名称: ${activityName}\n`
        confirmMsg += `🆔 活动ID: ${activityId}\n`
        confirmMsg += `⏰ 开奖时间: ${formatTime(drawTime)}\n`
        confirmMsg += `🎁 奖品总数: ${totalPrizes} 个\n`
        if (keyword) {
          confirmMsg += `🔑 参与口令: ${keyword}\n`
        }
        confirmMsg += `\n📋 奖品列表:\n`
        prizes.forEach((p, idx) => {
          confirmMsg += `${idx + 1}. ${p.name} - ${p.description} (${p.count}个)\n`
        })
        confirmMsg += `\n💡 用户可使用 `
        if (keyword) {
          confirmMsg += `发送口令"${keyword}" 或执行 raffle.join ${activityId} 参与抽奖`
        } else {
          confirmMsg += `raffle.join ${activityId} 参与抽奖`
        }

        await sendMessage(session, confirmMsg)

        if (config.debugMode) {
          logger.info(`管理员 ${userId} 创建了抽奖活动: ${activityName} (${activityId})`)
        }

      } catch (error) {
        logger.error(`创建抽奖活动失败: ${error}`)
        await sendMessage(session, '❌ 创建抽奖活动时出错，请稍后再试。')
      }
    })

  // `raffle.join <活动ID>` 命令：参与抽奖
  ctx.command('raffle.join <activityId:string>', '参与抽奖活动')
    .action(async ({ session }, activityId: string) => {
      if (!activityId) {
        await sendMessage(session, '❌ 请提供抽奖活动ID！')
        return
      }

      try {
        const raffleData = await handler.loadRaffleData()
        const activity = raffleData[activityId]

        if (!activity) {
          await sendMessage(session, `❌ 找不到抽奖活动 ${activityId}`)
          return
        }

        if (activity.status !== 'active') {
          await sendMessage(session, `❌ 该抽奖活动已${activity.status === 'drawn' ? '结束' : '取消'}`)
          return
        }

        // 检查是否在正确的群
        if (activity.guildId && activity.guildId !== session.guildId) {
          await sendMessage(session, '❌ 该抽奖活动不属于本群！')
          return
        }

        // 检查是否已经参与
        const alreadyJoined = activity.participants.some(p => p.userId === session.userId)
        if (alreadyJoined) {
          await sendMessage(session, '❌ 你已经参与过该抽奖活动了！')
          return
        }

        // 添加参与者
        activity.participants.push({
          userId: session.userId,
          username: session.username || '未知用户',
          joinedAt: Date.now()
        })

        raffleData[activityId] = activity
        await handler.saveRaffleData(raffleData)

        await sendMessage(session, `✅ 参与成功！\n\n🎉 活动名称: ${activity.name}\n⏰ 开奖时间: ${formatTime(activity.drawTime)}\n👥 当前参与人数: ${activity.participants.length}`)

        if (config.debugMode) {
          logger.info(`用户 ${session.username} (${session.userId}) 参与了抽奖活动 ${activityId}`)
        }

      } catch (error) {
        logger.error(`参与抽奖失败: ${error}`)
        await sendMessage(session, '❌ 参与抽奖时出错，请稍后再试。')
      }
    })

  // `raffle.list` 命令：查看进行中的抽奖活动
  ctx.command('raffle.list', '查看进行中的抽奖活动')
    .action(async ({ session }) => {
      try {
        const raffleData = await handler.loadRaffleData()
        const activities = Object.values(raffleData).filter(a =>
          a.status === 'active' &&
          (!a.guildId || a.guildId === session.guildId)
        )

        if (activities.length === 0) {
          await sendMessage(session, '📭 当前没有进行中的抽奖活动')
          return
        }

        let message = `📋 进行中的抽奖活动（${activities.length}个）:\n\n`
        activities.forEach((activity, idx) => {
          const totalPrizes = activity.prizes.reduce((sum, p) => sum + p.count, 0)
          message += `${idx + 1}. ${activity.name}\n`
          message += `   🆔 ID: ${activity.id}\n`
          message += `   ⏰ 开奖: ${formatTime(activity.drawTime)}\n`
          message += `   🎁 奖品: ${totalPrizes}个\n`
          message += `   👥 参与: ${activity.participants.length}人\n\n`
        })

        message += `💡 使用 raffle.join <活动ID> 参与抽奖`
        await sendMessage(session, message)

      } catch (error) {
        logger.error(`查看抽奖活动列表失败: ${error}`)
        await sendMessage(session, '❌ 查看抽奖活动列表时出错')
      }
    })

  // `raffle.info <活动ID>` 命令：查看抽奖详情
  ctx.command('raffle.info <activityId:string>', '查看抽奖活动详情')
    .action(async ({ session }, activityId: string) => {
      if (!activityId) {
        await sendMessage(session, '❌ 请提供抽奖活动ID！')
        return
      }

      try {
        const raffleData = await handler.loadRaffleData()
        const activity = raffleData[activityId]

        if (!activity) {
          await sendMessage(session, `❌ 找不到抽奖活动 ${activityId}`)
          return
        }

        const totalPrizes = activity.prizes.reduce((sum, p) => sum + p.count, 0)
        let message = `🎊 抽奖活动详情\n\n`
        message += `📝 活动名称: ${activity.name}\n`
        message += `🆔 活动ID: ${activity.id}\n`
        message += `📊 状态: ${activity.status === 'active' ? '进行中' : activity.status === 'drawn' ? '已开奖' : '已取消'}\n`
        message += `⏰ 开奖时间: ${formatTime(activity.drawTime)}\n`
        message += `👥 参与人数: ${activity.participants.length}\n`
        message += `🎁 奖品总数: ${totalPrizes} 个\n\n`

        message += `📋 奖品列表:\n`
        activity.prizes.forEach((p, idx) => {
          message += `${idx + 1}. ${p.name} - ${p.description} (${p.count}个)\n`
        })

        if (activity.status === 'drawn' && activity.winners && activity.winners.length > 0) {
          // 只显示真正中奖的用户
          const realWinners = activity.winners.filter(w => w.prize !== 'None - none')
          if (realWinners.length > 0) {
            message += `\n🏆 中奖名单:\n`
            realWinners.forEach((w, idx) => {
              message += `${idx + 1}. ${w.username}\n   奖品: ${w.prize}\n`
            })
          } else {
            message += `\n💨 本次抽奖无人中奖`
          }
        }

        if (activity.keyword) {
          message += `\n🔑 参与口令: ${activity.keyword}`
        }

        await sendMessage(session, message)

      } catch (error) {
        logger.error(`查看抽奖详情失败: ${error}`)
        await sendMessage(session, '❌ 查看抽奖详情时出错')
      }
    })

  // `raffle.cancel <活动ID>` 命令：取消抽奖（管理员）
  ctx.command('raffle.cancel <activityId:string>', '取消抽奖活动（仅管理员）')
    .action(async ({ session }, activityId: string) => {
      const userId = session.userId

      if (!checkAdmin(userId, config.adminQQ)) {
        await sendMessage(session, '❌ 你没有权限取消抽奖活动！')
        return
      }

      if (!activityId) {
        await sendMessage(session, '❌ 请提供抽奖活动ID！')
        return
      }

      try {
        const raffleData = await handler.loadRaffleData()
        const activity = raffleData[activityId]

        if (!activity) {
          await sendMessage(session, `❌ 找不到抽奖活动 ${activityId}`)
          return
        }

        if (activity.status !== 'active') {
          await sendMessage(session, `❌ 该抽奖活动已${activity.status === 'drawn' ? '开奖' : '取消'}，无法取消`)
          return
        }

        // 取消定时器
        timerManager.cancelTimer(activityId)

        // 更新状态
        activity.status = 'cancelled'
        raffleData[activityId] = activity
        await handler.saveRaffleData(raffleData)

        await sendMessage(session, `✅ 抽奖活动 "${activity.name}" 已取消`)

        if (config.debugMode) {
          logger.info(`管理员 ${userId} 取消了抽奖活动 ${activityId}`)
        }

      } catch (error) {
        logger.error(`取消抽奖失败: ${error}`)
        await sendMessage(session, '❌ 取消抽奖时出错')
      }
    })

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
      const raffleData = await handler.loadRaffleData()

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
            await sendMessage(session, '❌ 你已经参与过该抽奖活动了！')
            return
          }

          // 添加参与者
          activity.participants.push({
            userId: session.userId,
            username: session.username || '未知用户',
            joinedAt: Date.now()
          })

          raffleData[activityId] = activity
          await handler.saveRaffleData(raffleData)

          await sendMessage(
            session,
            `✅ 口令正确！参与成功！\n\n🎉 活动名称: ${activity.name}\n⏰ 开奖时间: ${formatTime(activity.drawTime)}\n👥 当前参与人数: ${activity.participants.length}`
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
}
