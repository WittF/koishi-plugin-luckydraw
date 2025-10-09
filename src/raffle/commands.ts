import { Context, Logger, Session } from 'koishi'
import { Config, RafflePrize, RaffleActivity } from '../types'
import { RaffleHandler } from './handler'
import { RaffleTimerManager } from './timer'
import { sendMessage, generateActivityId, checkAdmin, formatTime, parseTimeString, deleteMessage } from '../utils'

// 辅助函数：检查是否为 None 奖品（谢谢参与）
function isNonePrize(prize: RafflePrize): boolean {
  return prize.name.toLowerCase() === 'none' && prize.description.toLowerCase() === 'none'
}

// 辅助函数：过滤掉 None 奖品
function filterRealPrizes(prizes: RafflePrize[]): RafflePrize[] {
  return prizes.filter(p => !isNonePrize(p))
}

// 辅助函数：计算真实奖品总数（排除 None）
function countRealPrizes(prizes: RafflePrize[]): number {
  return filterRealPrizes(prizes).reduce((sum, p) => sum + p.count, 0)
}

export function registerRaffleCommands(
  ctx: Context,
  config: Config,
  handler: RaffleHandler,
  timerManager: RaffleTimerManager,
  logger: Logger
) {
  // `raffle.create` 命令：交互式创建抽奖活动
  ctx.command('raffle.create [targetGuildId:string]', '创建抽奖活动（交互式）')
    .action(async ({ session }, targetGuildId?: string) => {
      const userId = session.userId

      logger.info(`[抽奖创建] 用户 ${userId} 开始创建抽奖活动`)

      // 验证管理员身份
      if (!checkAdmin(userId, config.adminQQ)) {
        await sendMessage(session, '❌ 你没有权限创建抽奖活动，只有管理员可以操作！')
        return
      }

      // 确定目标群号：如果提供了参数则使用参数，否则使用当前群号
      const guildId = targetGuildId || session.guildId

      logger.info(`[抽奖创建] 目标群号: ${guildId}, 当前会话群号: ${session.guildId}`)

      // 如果没有提供群号也不在群聊中，则报错
      if (!guildId) {
        await sendMessage(session, '❌ 请在群聊中使用该命令，或指定目标群号！')
        return
      }

      try {
        // 步骤1: 输入活动名称
        const step1Messages = await sendMessage(session, '📝 请输入抽奖活动名称\n发送"取消"可退出')
        const step1MessageId = Array.isArray(step1Messages) && step1Messages.length > 0 ? step1Messages[0] : null
        const activityName = await session.prompt(60000)
        if (step1MessageId) await deleteMessage(session, step1MessageId)

        if (!activityName) {
          await sendMessage(session, '⏱️ 输入超时，已取消创建。')
          return
        }
        if (activityName.trim() === '取消') {
          await sendMessage(session, '❌ 已取消创建抽奖活动。')
          return
        }

        // 步骤2: 输入开奖时间
        const step2Messages = await sendMessage(session, '⏰ 请输入开奖时间\n支持格式：\n• 相对时间: 1h（1小时后）、30m（30分钟后）、1d（1天后）\n• 今天时间: 18:00\n• 绝对时间: 2024-12-31 18:00\n\n发送"取消"可退出')
        const step2MessageId = Array.isArray(step2Messages) && step2Messages.length > 0 ? step2Messages[0] : null
        const timeInput = await session.prompt(60000)
        if (step2MessageId) await deleteMessage(session, step2MessageId)

        if (!timeInput) {
          await sendMessage(session, '⏱️ 输入超时，已取消创建。')
          return
        }
        if (timeInput.trim() === '取消') {
          await sendMessage(session, '❌ 已取消创建抽奖活动。')
          return
        }

        // 先验证时间格式，但不立即计算时间戳（等所有步骤完成后再计算）
        const testDrawTime = parseTimeString(timeInput)
        if (!testDrawTime) {
          await sendMessage(session, '❌ 时间格式无效，请重试。')
          return
        }

        // 步骤3: 输入奖品信息
        const step3Messages = await sendMessage(session, '🎁 请输入奖品信息\n格式：奖品名称|奖品描述|数量\n例如：一等奖|iPhone 15 Pro|1\n支持多行输入，每行一个奖品\n\n发送"取消"可退出')
        const step3MessageId = Array.isArray(step3Messages) && step3Messages.length > 0 ? step3Messages[0] : null
        const prizesInput = await session.prompt(120000)
        if (step3MessageId) await deleteMessage(session, step3MessageId)

        if (!prizesInput) {
          await sendMessage(session, '⏱️ 输入超时，已取消创建。')
          return
        }
        if (prizesInput.trim() === '取消') {
          await sendMessage(session, '❌ 已取消创建抽奖活动。')
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
        const step4Messages = await sendMessage(session, '🔑 设置参与口令？\n发送口令文字，或发送"跳过"改为设置回应特定表情\n\n发送"取消"可退出')
        const step4MessageId = Array.isArray(step4Messages) && step4Messages.length > 0 ? step4Messages[0] : null
        const keywordInput = await session.prompt(60000)
        if (step4MessageId) await deleteMessage(session, step4MessageId)

        if (!keywordInput) {
          await sendMessage(session, '⏱️ 输入超时，已取消创建。')
          return
        }
        if (keywordInput.trim() === '取消') {
          await sendMessage(session, '❌ 已取消创建抽奖活动。')
          return
        }

        let keyword: string | undefined = undefined
        let emojiId: string | undefined = undefined

        if (keywordInput.trim() !== '跳过') {
          // 用户设置了口令
          keyword = keywordInput.trim()
        } else {
          // 步骤5: 用户跳过口令，设置表情
          // 检查是否在群聊中（表情回应功能仅在群聊可用）
          if (!session.guildId) {
            await sendMessage(session, '❌ 表情回应功能仅在群聊中可用，请在群聊中创建抽奖或使用口令参与方式。')
            return
          }

          const promptMessages = await sendMessage(session, '🔑 设置要求表情\n使用特定表情回应这条消息以设置（60秒内有效）')
          const promptMessageId = Array.isArray(promptMessages) && promptMessages.length > 0 ? promptMessages[0] : null

          logger.info(`[抽奖创建] 发送提示消息，返回: ${JSON.stringify(promptMessages)}`)
          logger.info(`[抽奖创建] 提取消息ID: ${promptMessageId}`)

          if (!promptMessageId) {
            await sendMessage(session, '❌ 无法获取消息ID，请重新创建。')
            return
          }

          // 监听表情回应事件
          logger.info(`[抽奖创建] 开始监听表情回应，等待消息ID: ${promptMessageId}`)

          const emojiPromise = new Promise<string | null>((resolve) => {
            const timeout = setTimeout(() => {
              logger.info(`[抽奖创建] 60秒超时，未收到表情回应`)
              dispose()
              resolve(null)
            }, 60000)

            const dispose = ctx.on('notice', (emojiSession) => {
              logger.info(`[抽奖创建] 收到 notice 事件: subtype=${emojiSession.subtype}`)

              if (emojiSession.subtype !== 'group-msg-emoji-like') {
                return
              }

              const data = emojiSession.onebot as any

              logger.info(`[抽奖创建] 收到表情回应: message_id=${data.message_id}, 期望: ${promptMessageId}`)
              logger.info(`[抽奖创建] 完整数据: ${JSON.stringify(data)}`)

              // 检查：回应消息ID是否匹配（转为字符串比较）
              if (data.message_id?.toString() !== promptMessageId?.toString()) {
                if (config.debugMode) {
                  logger.info(`消息ID不匹配: ${data.message_id} !== ${promptMessageId}`)
                }
                return
              }

              // 检查：回应用户是否是创建人
              const likeUserId = data.user_id?.toString()
              if (likeUserId !== userId) {
                if (config.debugMode) {
                  logger.info(`用户ID不匹配: ${likeUserId} !== ${userId}`)
                }
                return
              }

              // 获取 emoji_id（从 likes 数组中取第一个表情）
              const receivedEmojiId = data.likes?.[0]?.emoji_id
              if (receivedEmojiId) {
                if (config.debugMode) {
                  logger.info(`收到有效表情ID: ${receivedEmojiId}`)
                }
                clearTimeout(timeout)
                dispose()
                resolve(receivedEmojiId)
              }
            })
          })

          emojiId = await emojiPromise

          // 撤回提示消息
          if (promptMessageId) await deleteMessage(session, promptMessageId)

          if (!emojiId) {
            await sendMessage(session, '⏱️ 未在60秒内收到有效的表情回应，已取消创建。')
            return
          }

          logger.info(`✅ 已设置参与表情（表情ID: ${emojiId}）`)
        }

        // 所有步骤完成后，重新计算开奖时间（确保相对时间从现在开始计算）
        const drawTime = parseTimeString(timeInput)
        if (!drawTime || drawTime <= Date.now()) {
          await sendMessage(session, '❌ 开奖时间必须晚于当前时间！请重新创建。')
          return
        }

        // 创建抽奖活动
        const activityId = generateActivityId()
        const activity: RaffleActivity = {
          id: activityId,
          name: activityName,
          guildId: guildId,
          prizes,
          participants: [],
          drawTime,
          status: 'active',
          createdBy: userId,
          createdAt: Date.now(),
          keyword,
          emojiId
        }

        const raffleData = await handler.loadRaffleData()
        raffleData[activityId] = activity
        await handler.saveRaffleData(raffleData)

        // 设置定时开奖
        timerManager.scheduleRaffleDraw(activityId, activity)

        // 构建活动播报消息
        const realPrizes = filterRealPrizes(prizes)
        const totalPrizes = countRealPrizes(prizes)
        let announceMsg = `🎊 抽奖活动发布\n\n`
        announceMsg += `📝 活动名称: ${activityName}\n`
        announceMsg += `🆔 活动ID: ${activityId}\n`
        announceMsg += `📊 状态: 进行中\n`
        announceMsg += `⏰ 开奖时间: ${formatTime(drawTime)}\n`
        announceMsg += `🎁 奖品总数: ${totalPrizes} 个\n\n`
        announceMsg += `📋 奖品列表:\n`
        realPrizes.forEach((p, idx) => {
          announceMsg += `${idx + 1}. ${p.name} - ${p.description} (${p.count}个)\n`
        })
        announceMsg += `\n💡 参与方式: `
        if (keyword) {
          announceMsg += `发送口令"${keyword}"`
        } else if (emojiId) {
          announceMsg += `使用指定表情回应本消息`
        }

        // 发送活动播报到目标群
        try {
          const announceMessages = await session.bot.sendMessage(guildId, announceMsg)
          logger.info(`[抽奖创建] 播报消息返回: ${JSON.stringify(announceMessages)}`)

          const announceMessageId = Array.isArray(announceMessages) && announceMessages.length > 0 ? announceMessages[0] : null
          logger.info(`[抽奖创建] 提取播报消息ID: ${announceMessageId}`)

          // 保存播报消息ID
          if (announceMessageId) {
            activity.announceMessageId = announceMessageId
            raffleData[activityId] = activity
            await handler.saveRaffleData(raffleData)
            logger.info(`[抽奖创建] 已保存播报消息ID到活动 ${activityId}`)

            // 如果使用表情参与，bot给播报消息添加表情回应以展示参与表情
            if (emojiId) {
              try {
                const bot = session.bot as any
                if (bot.internal?.setMsgEmojiLike) {
                  logger.info(`[抽奖创建] 尝试给播报消息添加表情: ${emojiId}`)
                  await bot.internal.setMsgEmojiLike(announceMessageId, emojiId)
                  logger.info(`[抽奖创建] 成功添加表情回应`)
                }
              } catch (error) {
                logger.warn(`[抽奖创建] 添加表情回应失败: ${error}`)
              }
            }
          } else {
            logger.warn(`[抽奖创建] 未获取到播报消息ID`)
          }

          // 发送创建成功确认消息
          if (targetGuildId) {
            await sendMessage(session, `✅ 抽奖活动创建成功并已发送到群 ${targetGuildId}`)
          } else {
            await sendMessage(session, `✅ 抽奖活动创建成功！`)
          }
        } catch (error) {
          logger.error(`发送抽奖播报到群 ${guildId} 失败: ${error}`)
          await sendMessage(session, `✅ 抽奖活动已创建，但发送到群失败\n\n${announceMsg}`)
        }

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

        await sendMessage(session, `✅ ${activity.name} 参与成功！\n🆔 活动ID: ${activityId}\n👥 当前参与人数：${activity.participants.length}`)

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
          const totalPrizes = countRealPrizes(activity.prizes)
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
  ctx.command('raffle.info [activityId:string]', '查看抽奖活动详情')
    .action(async ({ session }, activityId?: string) => {
      try {
        const raffleData = await handler.loadRaffleData()

        // 如果没有提供活动ID，显示本群最近的进行中抽奖
        if (!activityId) {
          const guildId = session.guildId
          if (!guildId) {
            await sendMessage(session, '❌ 请在群聊中使用该命令，或提供活动ID')
            return
          }

          // 查找本群进行中的活动，按创建时间倒序
          const activities = Object.values(raffleData)
            .filter(a => a.status === 'active' && a.guildId === guildId)
            .sort((a, b) => b.createdAt - a.createdAt)

          if (activities.length === 0) {
            await sendMessage(session, '📭 本群当前没有进行中的抽奖活动')
            return
          }

          // 显示最新的活动
          activityId = activities[0].id
        }

        const activity = raffleData[activityId]

        if (!activity) {
          await sendMessage(session, `❌ 找不到抽奖活动 ${activityId}`)
          return
        }

        const realPrizes = filterRealPrizes(activity.prizes)
        const totalPrizes = countRealPrizes(activity.prizes)
        let message = `🎊 抽奖活动详情\n\n`
        message += `📝 活动名称: ${activity.name}\n`
        message += `🆔 活动ID: ${activity.id}\n`
        message += `📊 状态: ${activity.status === 'active' ? '进行中' : activity.status === 'drawn' ? '已开奖' : '已取消'}\n`
        message += `⏰ 开奖时间: ${formatTime(activity.drawTime)}\n`
        message += `👥 参与人数: ${activity.participants.length}\n`
        message += `🎁 奖品总数: ${totalPrizes} 个\n\n`

        message += `📋 奖品列表:\n`
        realPrizes.forEach((p, idx) => {
          message += `${idx + 1}. ${p.name} - ${p.description} (${p.count}个)\n`
        })

        if (activity.status === 'drawn' && activity.winners && activity.winners.length > 0) {
          // 只显示真正中奖的用户
          const realWinners = activity.winners.filter(w => w.prize.toLowerCase() !== 'none - none')
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
        } else if (activity.emojiId) {
          message += `\n🔑 参与方式: 使用指定表情回应播报消息`
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
}
