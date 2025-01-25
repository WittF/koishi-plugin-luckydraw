import { Context, Schema, Session, Logger, h } from 'koishi'
import * as fs from 'fs/promises'
import * as path from 'path'

export const name = 'lucky-draw'

export interface Config {
  adminQQ: string;   // 管理员 QQ 号
  debugMode: boolean; // 调试模式
}

export const schema: Schema<Config> = Schema.object({
  adminQQ: Schema.string().description('管理员 QQ 号').default(''),
  debugMode: Schema.boolean().description('启用调试模式').default(false),
})

interface Prize {
  id: number
  name: string
  description: string
}

interface PrizePool {
  [poolName: string]: {
    prizes: Prize[]
    max?: number
  }
}

interface UserEntries {
  [userId: string]: {
    [poolName: string]: number
  }
}

export function apply(ctx: Context, config: Config) {
  const logger = new Logger('lucky-draw')

  // 1. 构建保存文件的目录：ctx.baseDir/data/luckydraw
  const root = path.join(ctx.baseDir, 'data', 'luckydraw')

  // 2. 如果目录不存在则递归创建
  fs.mkdir(root, { recursive: true }).catch((error) => {
    logger.error(`创建 luckydraw 数据目录失败: ${error.message}`)
  })

  // 3. 定义 prizes.json 和 user_entries.json 的完整路径
  const prizeFilePath = path.join(root, 'prizes.json')
  const userEntriesFilePath = path.join(root, 'user_entries.json')

  // 初始化奖池文件和用户抽奖文件
  const initializeFile = async (filePath: string, defaultContent: object) => {
    try {
      await fs.access(filePath)
    } catch {
      await fs.writeFile(filePath, JSON.stringify(defaultContent, null, 2), 'utf-8')
    }
  }

  const initializeFiles = async () => {
    await initializeFile(prizeFilePath, {})
    await initializeFile(userEntriesFilePath, {})
  }

  // 读取奖池数据
  const loadPrizePool = async (): Promise<PrizePool> => {
    try {
      const data = await fs.readFile(prizeFilePath, 'utf-8')
      return JSON.parse(data)
    } catch (error) {
      throw new Error('读取奖池数据失败')
    }
  }

  // 保存奖池数据
  const savePrizePool = async (prizePool: PrizePool) => {
    try {
      await fs.writeFile(prizeFilePath, JSON.stringify(prizePool, null, 2), 'utf-8')
    } catch (error) {
      throw new Error('保存奖池数据失败')
    }
  }

  // 读取用户抽奖数据
  const loadUserEntries = async (): Promise<UserEntries> => {
    try {
      const data = await fs.readFile(userEntriesFilePath, 'utf-8')
      return JSON.parse(data)
    } catch (error) {
      throw new Error('读取用户抽奖数据失败')
    }
  }

  // 保存用户抽奖数据
  const saveUserEntries = async (userEntries: UserEntries) => {
    try {
      await fs.writeFile(userEntriesFilePath, JSON.stringify(userEntries, null, 2), 'utf-8')
    } catch (error) {
      throw new Error('保存用户抽奖数据失败')
    }
  }

  // 生成一个四位数随机ID
  const generatePrizeId = (): number => Math.floor(1000 + Math.random() * 9000)

  // 验证是否为管理员
  const checkAdmin = (userId: string, adminQQ: string): boolean => userId === adminQQ

  // 封装发送消息的函数
  const sendMessage = async (session: Session, content: string | any[]) => {
    try {
      const formattedContent = Array.isArray(content) ? content.join(' ') : content

      // 处理私聊和群聊的消息格式
      const promptMessage = session.channelId.startsWith('private:')
        ? [h.quote(session.messageId), formattedContent]
        : [h.quote(session.messageId), h.at(session.userId), '\n', formattedContent]

      await session.send(promptMessage.flat())
    } catch (error) {
      console.error('发送消息失败:', error)
    }
  }

  // 初始化文件
  initializeFiles().catch((error) => {
    logger.error(`初始化文件时出错: ${error.message}`)
  })

  // 如果启用了调试模式，则输出调试信息
  if (config.debugMode) {
    logger.info('🚀 LuckyDraw 插件已加载，调试模式已启用')
  }

  // =============== 命令部分开始 ===============

  // `draw.lucky <奖池名称>` 命令：进行抽奖
  ctx.command('draw.lucky <pool:string>', '从指定奖池进行抽奖')
    .action(async ({ session }, pool: string) => {
      const userId = session.userId
      let prizePool: PrizePool
      let userEntries: UserEntries

      try {
        prizePool = await loadPrizePool()
        userEntries = await loadUserEntries()
      } catch (error) {
        logger.error(error.message)
        await sendMessage(session, '❌ 服务器内部错误，请稍后再试。')
        return
      }

      // 检查奖池名称是否为空
      if (!pool) {
        await sendMessage(session, '❌ 请提供有效的奖池名称！')
        return
      }

      // 检查指定奖池是否存在
      if (!prizePool[pool] || prizePool[pool].prizes.length === 0) {
        logger.warn(`❌ 奖池 "${pool}" 不存在或已空`)
        await sendMessage(session, `❌ 奖池 "${pool}" 不存在或已空！`)
        return
      }

      // 检查最大抽奖次数
      const maxEntries = prizePool[pool].max || Infinity
      const userPoolEntries = userEntries[userId]?.[pool] || 0
      if (userPoolEntries >= maxEntries) {
        logger.warn(`❌ 用户 ${userId} 已达到奖池 "${pool}" 的最大抽奖次数 (${maxEntries} 次)`)
        await sendMessage(session, `❌ 你已达到奖池 "${pool}" 的最大抽奖次数限制 (${maxEntries} 次)！`)
        return
      }

      // 随机抽取奖品
      const prizes = prizePool[pool].prizes
      const prizeIndex = Math.floor(Math.random() * prizes.length)
      const prize = prizes.splice(prizeIndex, 1)[0] // 从奖池中删除已抽取的奖品

      try {
        // 保存更新后的奖池
        await savePrizePool(prizePool)

        // 更新用户抽奖次数
        if (!userEntries[userId]) {
          userEntries[userId] = {}
        }
        userEntries[userId][pool] = userPoolEntries + 1

        // 保存更新后的用户抽奖情况
        await saveUserEntries(userEntries)
      } catch (error) {
        logger.error(error.message)
        await sendMessage(session, '❌ 抽奖过程中出现问题，请稍后再试。')
        return
      }

      // 打印调试信息
      if (config.debugMode) {
        logger.info(`📥 收到抽奖请求: ${session.username} (QQ号: ${userId})`)
        logger.info(`🎉 抽取的奖品: ${pool} - ${prize.name} - ${prize.description}`)
      }

      await sendMessage(
        session,
        `🎉 恭喜 ${session.username} (QQ号: ${userId})\n` +
        `抽取到奖品: "${prize.name}"\n` +
        `- ${prize.description}\n` +
        `（奖池 "${pool}" 剩余 ${prizes.length} 个）`
      );
      

  // `draw.add <data:text>` 命令：添加奖品
  ctx.command('draw.add <data:text>', '管理员向指定奖池添加奖品 (支持批量)')
    .action(async ({ session }, data: string) => {
      const userId = session.userId

      // 验证管理员身份
      if (!checkAdmin(userId, config.adminQQ)) {
        await sendMessage(session, '❌ 你没有权限添加奖品，只有管理员可以操作！')
        return
      }

      let prizePool: PrizePool
      try {
        prizePool = await loadPrizePool()
      } catch (error) {
        logger.error(error.message)
        await sendMessage(session, '❌ 服务器内部错误，请稍后再试。')
        return
      }

      // 解析输入数据，按行拆分（防止有多行）
      const lines = data
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
      const isBatch = lines.length > 1 // 判断是否是批量操作

      let successCount = 0
      let failureCount = 0
      let resultMessage = isBatch ? '📋 批量添加奖品结果：\n' : ''

      for (const line of lines) {
        const parts = line.match(/(.+?)\s+(.+?)\s+(.+)/) // 解析格式："奖池名称 奖品名称 奖品描述"
        if (!parts) {
          resultMessage += `❌ 无效格式: "${line}" (格式应为: 奖池名称 奖品名称 奖品描述)\n`
          failureCount++
          continue
        }

        const [, pool, name, description] = parts

        // 如果奖池不存在，则创建新奖池
        if (!prizePool[pool]) {
          prizePool[pool] = { prizes: [] }
        }

        // 生成唯一奖品 ID 并添加奖品
        const prizeId = generatePrizeId()
        prizePool[pool].prizes.push({ id: prizeId, name, description })

        try {
          await savePrizePool(prizePool)
          resultMessage += isBatch
            ? `✅ "${name}" (ID: ${prizeId}) 添加到 "${pool}"\n`
            : `✅ 奖品 "${name}" (ID: ${prizeId}) 添加成功！`
          successCount++
        } catch (error) {
          logger.error(error.message)
          resultMessage += `❌ 添加失败: "${name}" 到 "${pool}" (服务器错误)\n`
          failureCount++
        }
      }

      if (isBatch) {
        resultMessage += `\n🎯 添加完成: 成功 ${successCount} 条, 失败 ${failureCount} 条`
      }

      // 如果开启调试模式，输出日志
      if (config.debugMode) {
        logger.info(`📥 管理员 ${userId} 添加奖品:\n${resultMessage}`)
      }

      await sendMessage(session, resultMessage)
    })

  // `draw.set <奖池名称> <配置项> <值>` 命令：设置奖池的配置
  ctx.command('draw.set <pool:string> <config:string> <value:number>', '设置奖池的配置项，如最大抽取次数')
    .action(async ({ session }, pool: string, configItem: string, value: number) => {
      const userId = session.userId

      // 验证管理员
      if (!checkAdmin(userId, config.adminQQ)) {
        await sendMessage(session, '❌ 你没有权限设置奖池配置，只有管理员可以操作！')
        return
      }

      let prizePool: PrizePool

      try {
        prizePool = await loadPrizePool()
      } catch (error) {
        logger.error(error.message)
        await sendMessage(session, '❌ 服务器内部错误，请稍后再试。')
        return
      }

      // 如果奖池不存在，则创建奖池
      if (!prizePool[pool]) {
        prizePool[pool] = { prizes: [] }
      }

      // 设置配置项
      if (configItem === 'max') {
        if (value <= 0) {
          await sendMessage(session, '❌ 最大抽取次数必须为正整数！')
          return
        }
        prizePool[pool].max = value
      } else {
        await sendMessage(session, `❌ 不支持的配置项 "${configItem}"！`)
        return
      }

      try {
        // 保存更新后的奖池
        await savePrizePool(prizePool)
      } catch (error) {
        logger.error(error.message)
        await sendMessage(session, '❌ 设置配置项时出现问题，请稍后再试。')
        return
      }

      await sendMessage(session, `✅ 奖池 "${pool}" 的配置项 "${configItem}" 已设置为 ${value}。`)
    })

  // `draw.remove <奖池名称> [奖品ID]` 命令：删除奖品或整个奖池
  ctx.command('draw.remove <pool:string> [prizeId:number]', '管理员删除指定奖池的奖品或整个奖池')
    .action(async ({ session }, pool: string, prizeId?: number) => {
      const userId = session.userId

      // 验证管理员
      if (!checkAdmin(userId, config.adminQQ)) {
        await sendMessage(session, '❌ 你没有权限删除奖品，只有管理员可以操作！')
        return
      }

      let prizePool: PrizePool

      try {
        prizePool = await loadPrizePool()
      } catch (error) {
        logger.error(error.message)
        await sendMessage(session, '❌ 服务器内部错误，请稍后再试。')
        return
      }

      // 检查指定奖池是否存在
      if (!prizePool[pool]) {
        await sendMessage(session, `❌ 奖池 "${pool}" 不存在！`)
        return
      }

      if (prizeId) {
        // 查找并删除指定奖品
        const prizeIndex = prizePool[pool].prizes.findIndex(prize => prize.id === prizeId)
        if (prizeIndex === -1) {
          await sendMessage(session, `❌ 奖池 "${pool}" 中没有 ID 为 ${prizeId} 的奖品！`)
          return
        }

        const removedPrize = prizePool[pool].prizes.splice(prizeIndex, 1)[0]

        try {
          // 保存更新后的奖池
          await savePrizePool(prizePool)
        } catch (error) {
          logger.error(error.message)
          await sendMessage(session, '❌ 删除奖品时出现问题，请稍后再试。')
          return
        }

        // 打印调试信息
        if (config.debugMode) {
          logger.info(`📥 管理员 ${userId} 删除了奖池 "${pool}" 中的奖品: ID: ${prizeId}, "${removedPrize.name}"`)
        }

        await sendMessage(session, `✅ 奖池 "${pool}" 中的奖品 "${removedPrize.name}" (ID: ${prizeId}) 已被删除！`)
      } else {
        // 删除整个奖池
        delete prizePool[pool]

        try {
          // 保存更新后的奖池
          await savePrizePool(prizePool)
        } catch (error) {
          logger.error(error.message)
          await sendMessage(session, '❌ 删除奖池时出现问题，请稍后再试。')
          return
        }

        // 打印调试信息
        if (config.debugMode) {
          logger.info(`📥 管理员 ${userId} 删除了整个奖池 "${pool}"`)
        }

        await sendMessage(session, `✅ 奖池 "${pool}" 已被删除！`)
      }
    })

  // `draw.show [奖池名称]` 命令：显示奖池信息
  ctx.command('draw.show [pool:string]', '显示指定奖池或所有奖池的奖品')
    .action(async ({ session }, pool?: string) => {
      const userId = session.userId

      // 验证管理员
      if (!checkAdmin(userId, config.adminQQ)) {
        await sendMessage(session, '❌ 你没有权限查看奖池信息，只有管理员可以操作！')
        return
      }

      let prizePool: PrizePool

      try {
        prizePool = await loadPrizePool()
      } catch (error) {
        logger.error(error.message)
        await sendMessage(session, '❌ 服务器内部错误，请稍后再试。')
        return
      }

      if (pool) {
        // 显示指定奖池的奖品
        if (!prizePool[pool] || prizePool[pool].prizes.length === 0) {
          await sendMessage(session, `❌ 奖池 "${pool}" 不存在或已空！`)
          return
        }

        let result = `▶️ 奖池 "${pool}" 的所有奖品：\n`
        prizePool[pool].prizes.forEach(prize => {
          result += `  • ID: ${prize.id}. "${prize.name}" - ${prize.description}\n`
        })

        if (prizePool[pool].max) {
          const userEntries = await loadUserEntries()
          const remainingEntries = prizePool[pool].max - (userEntries[userId]?.[pool] || 0)
          result += `🔢 最大抽取次数: ${prizePool[pool].max}\n`
          result += `📈 当前用户剩余抽取次数: ${remainingEntries}\n`
        }

        await sendMessage(session, result)
        return
      }

      // 显示所有奖池的奖品
      let result = '▶️ 当前所有奖池及奖品：\n'
      const pools = Object.entries(prizePool)
      if (pools.length === 0) {
        await sendMessage(session, '❌ 没有任何奖池信息。')
        return
      }

      for (const [poolName, poolData] of pools) {
        result += `【${poolName}】（剩余 ${poolData.prizes.length} 个）`
        result += poolData.max ? ` | 最大抽取次数: ${poolData.max}：\n` : '：\n'
        poolData.prizes.forEach(prize => {
          result += `  • ID: ${prize.id}. "${prize.name}" - ${prize.description}\n`
        })
      }

      await sendMessage(session, result)
    })
}
