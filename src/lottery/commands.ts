import { Context, Logger, Session } from 'koishi'
import { Config } from '../types'
import { LotteryHandler } from './handler'
import { sendMessage, generatePrizeId, checkAdmin } from '../utils'

export function registerLotteryCommands(
  ctx: Context,
  config: Config,
  handler: LotteryHandler,
  logger: Logger
) {
  // `lottery.draw <池名称>` 命令：进行抽签
  ctx.command('lottery.draw <pool:string>', '从指定抽签池抽签（抽完即止）')
    .action(async ({ session }, pool: string) => {
      const userId = session.userId

      try {
        const lotteryPool = await handler.loadLotteryPool()
        const userEntries = await handler.loadUserDrawEntries()

        // 检查奖池名称是否为空
        if (!pool) {
          await sendMessage(session, '❌ 请提供有效的抽签池名称！')
          return
        }

        // 检查指定抽签池是否存在
        if (!lotteryPool[pool] || lotteryPool[pool].prizes.length === 0) {
          logger.warn(`❌ 抽签池 "${pool}" 不存在或已空`)
          await sendMessage(session, `❌ 抽签池 "${pool}" 不存在或已空！`)
          return
        }

        // 检查是否只剩下 None 签（视为抽签结束）
        const allPrizes = lotteryPool[pool].prizes
        const nonNonePrizes = allPrizes.filter(p =>
          !(p.name.toLowerCase() === 'none' && p.description.toLowerCase() === 'none')
        )

        if (nonNonePrizes.length === 0) {
          logger.warn(`❌ 抽签池 "${pool}" 只剩谢谢参与签，抽签已结束`)
          await sendMessage(session, `❌ 抽签池 "${pool}" 的奖品已全部抽完！`)
          return
        }

        // 检查最大抽签次数（固定为1次）
        const maxEntries = 1
        const userPoolEntries = userEntries[userId]?.[pool] || 0
        if (userPoolEntries >= maxEntries) {
          logger.warn(`❌ 用户 ${userId} 已达到抽签池 "${pool}" 的最大抽签次数`)
          await sendMessage(session, `❌ 你已在抽签池 "${pool}" 中抽过签了！`)
          return
        }

        // 随机抽取奖品
        const prizes = lotteryPool[pool].prizes
        const prizeIndex = Math.floor(Math.random() * prizes.length)
        const prize = prizes.splice(prizeIndex, 1)[0] // 从抽签池中删除已抽取的奖品

        // 保存更新后的抽签池
        await handler.saveLotteryPool(lotteryPool)

        // 更新用户抽签次数
        if (!userEntries[userId]) {
          userEntries[userId] = {}
        }
        userEntries[userId][pool] = userPoolEntries + 1

        // 保存更新后的用户抽签情况
        await handler.saveUserDrawEntries(userEntries)

        // 打印调试信息
        if (config.debugMode) {
          logger.info(`📥 收到抽签请求: ${session.username} (QQ号: ${userId})`)
          logger.info(`🎉 抽取的签品: ${pool} - ${prize.name} - ${prize.description}`)
        }

        // 检查是否为"未中奖"签品（名称和描述都为None或none）
        const isNoWin = (prize.name.toLowerCase() === 'none' && prize.description.toLowerCase() === 'none')

        // 计算剩余有效签品数量（排除 None 签）
        const remainingValidPrizes = prizes.filter(p =>
          !(p.name.toLowerCase() === 'none' && p.description.toLowerCase() === 'none')
        ).length

        if (isNoWin) {
          await sendMessage(
            session,
            `💨 ${session.username} 谢谢参与，下次再来！\n🚩 该抽签池 "${pool}" 剩余奖品 ${remainingValidPrizes} 个`
          )
        } else {
          await sendMessage(
            session,
            `🎉 恭喜 ${session.username} 抽取到奖品 "${prize.name}":\n ${prize.description}\n🚩 该抽签池 "${pool}" 剩余奖品 ${remainingValidPrizes} 个`
          )
        }
      } catch (error) {
        logger.error(error.message)
        await sendMessage(session, '❌ 抽签过程中出现问题，请稍后再试。')
      }
    })

  // `lottery.pool.add <data:text>` 命令：添加签品
  ctx.command('lottery.pool.add <data:text>', '管理员向指定抽签池添加签品 (支持批量)')
    .action(async ({ session }, data: string) => {
      const userId = session.userId

      // 验证管理员身份
      if (!checkAdmin(userId, config.adminQQ)) {
        await sendMessage(session, '❌ 你没有权限添加签品，只有管理员可以操作！')
        return
      }

      try {
        const lotteryPool = await handler.loadLotteryPool()

        // 解析输入数据，按行拆分（防止有多行）
        const lines = data
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
        const isBatch = lines.length > 1 // 判断是否是批量操作

        let successCount = 0
        let failureCount = 0
        let resultMessage = isBatch ? '📋 批量添加签品结果：\n' : ''

        for (const line of lines) {
          const parts = line.match(/(.+?)\s+(.+?)\s+(.+)/) // 解析格式："抽签池名称 签品名称 签品描述"
          if (!parts) {
            resultMessage += `❌ 无效格式: "${line}" (格式应为: 抽签池名称 签品名称 签品描述)\n`
            failureCount++
            continue
          }

          const [, pool, name, description] = parts

          // 如果抽签池不存在，则创建新抽签池
          if (!lotteryPool[pool]) {
            lotteryPool[pool] = { prizes: [] }
          }

          // 生成唯一签品 ID 并添加签品
          const prizeId = generatePrizeId()
          lotteryPool[pool].prizes.push({ id: prizeId, name, description })

          await handler.saveLotteryPool(lotteryPool)
          resultMessage += isBatch
            ? `✅ "${name}" (ID: ${prizeId}) 添加到 "${pool}"\n`
            : `✅ 签品 "${name}" (ID: ${prizeId}) 添加成功！`
          successCount++
        }

        if (isBatch) {
          resultMessage += `\n🎯 添加完成: 成功 ${successCount} 条, 失败 ${failureCount} 条`
        }

        // 如果开启调试模式，输出日志
        if (config.debugMode) {
          logger.info(`📥 管理员 ${userId} 添加签品:\n${resultMessage}`)
        }

        await sendMessage(session, resultMessage)
      } catch (error) {
        logger.error(error.message)
        await sendMessage(session, '❌ 服务器内部错误，请稍后再试。')
      }
    })

  // `lottery.pool.remove <抽签池名称> [签品ID]` 命令：删除签品或整个抽签池
  ctx.command('lottery.pool.remove <pool:string> [prizeId:number]', '管理员删除指定抽签池的签品或整个抽签池')
    .action(async ({ session }, pool: string, prizeId?: number) => {
      const userId = session.userId

      // 验证管理员
      if (!checkAdmin(userId, config.adminQQ)) {
        await sendMessage(session, '❌ 你没有权限删除签品，只有管理员可以操作！')
        return
      }

      try {
        const lotteryPool = await handler.loadLotteryPool()

        // 检查指定抽签池是否存在
        if (!lotteryPool[pool]) {
          await sendMessage(session, `❌ 抽签池 "${pool}" 不存在！`)
          return
        }

        if (prizeId) {
          // 查找并删除指定签品
          const prizeIndex = lotteryPool[pool].prizes.findIndex(prize => prize.id === prizeId)
          if (prizeIndex === -1) {
            await sendMessage(session, `❌ 抽签池 "${pool}" 中没有 ID 为 ${prizeId} 的签品！`)
            return
          }

          const removedPrize = lotteryPool[pool].prizes.splice(prizeIndex, 1)[0]

          // 保存更新后的抽签池
          await handler.saveLotteryPool(lotteryPool)

          // 打印调试信息
          if (config.debugMode) {
            logger.info(`📥 管理员 ${userId} 删除了抽签池 "${pool}" 中的签品: ID: ${prizeId}, "${removedPrize.name}"`)
          }

          await sendMessage(session, `✅ 抽签池 "${pool}" 中的签品 "${removedPrize.name}" (ID: ${prizeId}) 已被删除！`)
        } else {
          // 删除整个抽签池
          delete lotteryPool[pool]

          // 保存更新后的抽签池
          await handler.saveLotteryPool(lotteryPool)

          // 打印调试信息
          if (config.debugMode) {
            logger.info(`📥 管理员 ${userId} 删除了整个抽签池 "${pool}"`)
          }

          await sendMessage(session, `✅ 抽签池 "${pool}" 已被删除！`)
        }
      } catch (error) {
        logger.error(error.message)
        await sendMessage(session, '❌ 删除签品/抽签池时出现问题，请稍后再试。')
      }
    })

  // `lottery.pool.show [抽签池名称]` 命令：显示抽签池信息
  ctx.command('lottery.pool.show [pool:string]', '显示指定抽签池或所有抽签池的签品')
    .action(async ({ session }, pool?: string) => {
      const userId = session.userId

      // 验证管理员
      if (!checkAdmin(userId, config.adminQQ)) {
        await sendMessage(session, '❌ 你没有权限查看抽签池信息，只有管理员可以操作！')
        return
      }

      try {
        const lotteryPool = await handler.loadLotteryPool()

        if (pool) {
          // 显示指定抽签池的签品
          if (!lotteryPool[pool] || lotteryPool[pool].prizes.length === 0) {
            await sendMessage(session, `❌ 抽签池 "${pool}" 不存在或已空！`)
            return
          }

          let result = `▶️ 抽签池 "${pool}" 的所有签品：\n`
          lotteryPool[pool].prizes.forEach(prize => {
            result += `  • ID: ${prize.id}. "${prize.name}" - ${prize.description}\n`
          })

          await sendMessage(session, result)
          return
        }

        // 显示所有抽签池的签品
        let result = '▶️ 当前所有抽签池及签品：\n'
        const pools = Object.entries(lotteryPool)
        if (pools.length === 0) {
          await sendMessage(session, '❌ 没有任何抽签池信息。')
          return
        }

        for (const [poolName, poolData] of pools) {
          result += `【${poolName}】（剩余 ${poolData.prizes.length} 个）：\n`
          poolData.prizes.forEach(prize => {
            result += `  • ID: ${prize.id}. "${prize.name}" - ${prize.description}\n`
          })
        }

        await sendMessage(session, result)
      } catch (error) {
        logger.error(error.message)
        await sendMessage(session, '❌ 查看抽签池信息时出错。')
      }
    })
}
