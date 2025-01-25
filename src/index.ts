import { Context, Schema, Session, Logger } from 'koishi';
import * as fs from 'fs/promises';
import * as path from 'path';

export const name = 'lucky-draw';

export interface Config {
  adminQQ: string; // 管理员 QQ 号
  debugMode: boolean; // 调试模式
}

export const schema: Schema<Config> = Schema.object({
  adminQQ: Schema.string().description('管理员 QQ 号').default(''),
  debugMode: Schema.boolean().description('启用调试模式').default(false),
});

const prizeFilePath = path.join(__dirname, 'prizes.json');
const userEntriesFilePath = path.join(__dirname, 'user_entries.json');

interface Prize {
  id: number;
  name: string;
  description: string;
}

interface PrizePool {
  [poolName: string]: {
    prizes: Prize[];
    max?: number;
  };
}

interface UserEntries {
  [userId: string]: {
    [poolName: string]: number;
  };
}

// 初始化奖池文件和用户抽奖文件
const initializeFile = async (filePath: string, defaultContent: object) => {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultContent, null, 2), 'utf-8');
  }
};

const initializeFiles = async () => {
  await initializeFile(prizeFilePath, {});
  await initializeFile(userEntriesFilePath, {});
};

// 读取奖池数据
const loadPrizePool = async (): Promise<PrizePool> => {
  try {
    const data = await fs.readFile(prizeFilePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    throw new Error('读取奖池数据失败');
  }
};

// 保存奖池数据
const savePrizePool = async (prizePool: PrizePool) => {
  try {
    await fs.writeFile(prizeFilePath, JSON.stringify(prizePool, null, 2), 'utf-8');
  } catch (error) {
    throw new Error('保存奖池数据失败');
  }
};

// 读取用户抽奖数据
const loadUserEntries = async (): Promise<UserEntries> => {
  try {
    const data = await fs.readFile(userEntriesFilePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    throw new Error('读取用户抽奖数据失败');
  }
};

// 保存用户抽奖数据
const saveUserEntries = async (userEntries: UserEntries) => {
  try {
    await fs.writeFile(userEntriesFilePath, JSON.stringify(userEntries, null, 2), 'utf-8');
  } catch (error) {
    throw new Error('保存用户抽奖数据失败');
  }
};

// 生成一个四位数随机ID
const generatePrizeId = (): number => Math.floor(1000 + Math.random() * 9000);

// 验证是否为管理员
const checkAdmin = (userId: string, adminQQ: string): boolean => userId === adminQQ;

// 封装发送消息的函数
const sendMessage = async (session: Session, content: string | any[]) => {
  try {
    await session.send(content);
  } catch (error) {
    // 处理发送消息失败的情况
  }
};

export function apply(ctx: Context, config: Config) {
  const logger = new Logger('lucky-draw');

  // 初始化文件
  initializeFiles().catch((error) => {
    logger.error(`初始化文件时出错: ${error.message}`);
  });

  // 如果启用了调试模式，则输出调试信息
  if (config.debugMode) {
    logger.info('🚀 LuckyDraw 插件已加载，调试模式已启用');
  }

  // `draw.lucky <奖池名称>` 命令：进行抽奖
  ctx.command('draw.lucky1 <pool:string>', '从指定奖池进行抽奖')
    .action(async ({ session }, pool: string) => {
      const userId = session.userId;
      let prizePool: PrizePool;
      let userEntries: UserEntries;

      try {
        prizePool = await loadPrizePool();
        userEntries = await loadUserEntries();
      } catch (error) {
        logger.error(error.message);
        return '❌ 服务器内部错误，请稍后再试。';
      }

      // 检查奖池名称是否为空
      if (!pool) {
        return '❌ 请提供有效的奖池名称！';
      }

      // 检查指定奖池是否存在
      if (!prizePool[pool] || prizePool[pool].prizes.length === 0) {
        logger.warn(`❌ 奖池 "${pool}" 不存在或已空`);
        return `❌ 奖池 "${pool}" 不存在或已空！`;
      }

      // 检查最大抽奖次数
      const maxEntries = prizePool[pool].max || Infinity;
      const userPoolEntries = userEntries[userId]?.[pool] || 0;
      if (userPoolEntries >= maxEntries) {
        logger.warn(`❌ 用户 ${userId} 已达到奖池 "${pool}" 的最大抽奖次数 (${maxEntries} 次)`);
        return `❌ 你已达到奖池 "${pool}" 的最大抽奖次数限制 (${maxEntries} 次)！`;
      }

      // 随机抽取奖品
      const prizes = prizePool[pool].prizes;
      const prizeIndex = Math.floor(Math.random() * prizes.length);
      const prize = prizes.splice(prizeIndex, 1)[0]; // 从奖池中删除已抽取的奖品

      try {
        // 保存更新后的奖池
        await savePrizePool(prizePool);

        // 更新用户抽奖次数
        if (!userEntries[userId]) {
          userEntries[userId] = {};
        }
        userEntries[userId][pool] = userPoolEntries + 1;

        // 保存更新后的用户抽奖情况
        await saveUserEntries(userEntries);
      } catch (error) {
        logger.error(error.message);
        return '❌ 抽奖过程中出现问题，请稍后再试。';
      }

      // 打印调试信息
      if (config.debugMode) {
        logger.info(`📥 收到抽奖请求: ${session.username} (QQ号: ${userId})`);
        logger.info(`🎉 抽取的奖品: ${pool} - ${prize.name} - ${prize.description}`);
      }

      return `🎉 恭喜 ${session.username} (QQ号: ${userId}) 抽取到奖品: "${prize.name}" - ${prize.description}（奖池 "${pool}" 剩余 ${prizes.length} 个）`;
    });

  // `draw.add <奖池名称> <奖品名称> <奖品说明>` 命令：添加奖品
  ctx.command('draw.add <pool:string> <name:string> <description:string>', '管理员向指定奖池添加奖品')
    .action(async ({ session }, pool: string, name: string, description: string) => {
      const userId = session.userId;

      // 验证管理员
      if (!checkAdmin(userId, config.adminQQ)) {
        return '❌ 你没有权限添加奖品，只有管理员可以操作！';
      }

      let prizePool: PrizePool;

      try {
        prizePool = await loadPrizePool();
      } catch (error) {
        logger.error(error.message);
        return '❌ 服务器内部错误，请稍后再试。';
      }

      // 如果奖池不存在，则创建新奖池
      if (!prizePool[pool]) {
        prizePool[pool] = { prizes: [] };
      }

      // 生成奖品 ID 并添加奖品
      const prizeId = generatePrizeId();
      prizePool[pool].prizes.push({ id: prizeId, name, description });

      try {
        // 保存更新后的奖池
        await savePrizePool(prizePool);
      } catch (error) {
        logger.error(error.message);
        return '❌ 添加奖品时出现问题，请稍后再试。';
      }

      // 打印调试信息
      if (config.debugMode) {
        logger.info(`📥 管理员 ${userId} 向奖池 "${pool}" 添加了奖品: ID: ${prizeId}, "${name}" - ${description}`);
      }

      return `✅ 奖品 "${name}" (ID: ${prizeId}) 已成功添加到奖池 "${pool}"！`;
    });

  // `draw.set <奖池名称> <配置项> <值>` 命令：设置奖池的配置
  ctx.command('draw.set <pool:string> <config:string> <value:number>', '设置奖池的配置项，如最大抽取次数')
    .action(async ({ session }, pool: string, configItem: string, value: number) => {
      const userId = session.userId;

      // 验证管理员
      if (!checkAdmin(userId, config.adminQQ)) {
        return '❌ 你没有权限设置奖池配置，只有管理员可以操作！';
      }

      let prizePool: PrizePool;

      try {
        prizePool = await loadPrizePool();
      } catch (error) {
        logger.error(error.message);
        return '❌ 服务器内部错误，请稍后再试。';
      }

      // 如果奖池不存在，则创建奖池
      if (!prizePool[pool]) {
        prizePool[pool] = { prizes: [] };
      }

      // 设置配置项
      if (configItem === 'max') {
        if (value <= 0) {
          return '❌ 最大抽取次数必须为正整数！';
        }
        prizePool[pool].max = value;
      } else {
        return `❌ 不支持的配置项 "${configItem}"！`;
      }

      try {
        // 保存更新后的奖池
        await savePrizePool(prizePool);
      } catch (error) {
        logger.error(error.message);
        return '❌ 设置配置项时出现问题，请稍后再试。';
      }

      return `✅ 奖池 "${pool}" 的配置项 "${configItem}" 已设置为 ${value}。`;
    });

  // `draw.remove <奖池名称> [奖品ID]` 命令：删除奖品或整个奖池
  ctx.command('draw.remove <pool:string> [prizeId:number]', '管理员删除指定奖池的奖品或整个奖池')
    .action(async ({ session }, pool: string, prizeId?: number) => {
      const userId = session.userId;

      // 验证管理员
      if (!checkAdmin(userId, config.adminQQ)) {
        return '❌ 你没有权限删除奖品，只有管理员可以操作！';
      }

      let prizePool: PrizePool;

      try {
        prizePool = await loadPrizePool();
      } catch (error) {
        logger.error(error.message);
        return '❌ 服务器内部错误，请稍后再试。';
      }

      // 检查指定奖池是否存在
      if (!prizePool[pool]) {
        return `❌ 奖池 "${pool}" 不存在！`;
      }

      if (prizeId) {
        // 查找并删除指定奖品
        const prizeIndex = prizePool[pool].prizes.findIndex(prize => prize.id === prizeId);
        if (prizeIndex === -1) {
          return `❌ 奖池 "${pool}" 中没有 ID 为 ${prizeId} 的奖品！`;
        }

        const removedPrize = prizePool[pool].prizes.splice(prizeIndex, 1)[0];

        try {
          // 保存更新后的奖池
          await savePrizePool(prizePool);
        } catch (error) {
          logger.error(error.message);
          return '❌ 删除奖品时出现问题，请稍后再试。';
        }

        // 打印调试信息
        if (config.debugMode) {
          logger.info(`📥 管理员 ${userId} 删除了奖池 "${pool}" 中的奖品: ID: ${prizeId}, "${removedPrize.name}"`);
        }

        return `✅ 奖池 "${pool}" 中的奖品 "${removedPrize.name}" (ID: ${prizeId}) 已被删除！`;
      } else {
        // 删除整个奖池
        delete prizePool[pool];

        try {
          // 保存更新后的奖池
          await savePrizePool(prizePool);
        } catch (error) {
          logger.error(error.message);
          return '❌ 删除奖池时出现问题，请稍后再试。';
        }

        // 打印调试信息
        if (config.debugMode) {
          logger.info(`📥 管理员 ${userId} 删除了整个奖池 "${pool}"`);
        }

        return `✅ 奖池 "${pool}" 已被删除！`;
      }
    });

  // `draw.show [奖池名称]` 命令：显示奖池信息
  ctx.command('draw.show [pool:string]', '显示指定奖池或所有奖池的奖品')
    .action(async ({ session }, pool?: string) => {
      const userId = session.userId;

      // 验证管理员
      if (!checkAdmin(userId, config.adminQQ)) {
        return '❌ 你没有权限查看奖池信息，只有管理员可以操作！';
      }

      let prizePool: PrizePool;

      try {
        prizePool = await loadPrizePool();
      } catch (error) {
        logger.error(error.message);
        return '❌ 服务器内部错误，请稍后再试。';
      }

      if (pool) {
        // 显示指定奖池的奖品
        if (!prizePool[pool] || prizePool[pool].prizes.length === 0) {
          return `❌ 奖池 "${pool}" 不存在或已空！`;
        }

        let result = `▶️ 奖池 "${pool}" 的所有奖品：\n`;
        prizePool[pool].prizes.forEach(prize => {
          result += `  • ID: ${prize.id}. "${prize.name}" - ${prize.description}\n`;
        });

        if (prizePool[pool].max) {
          const userEntries = await loadUserEntries();
          const remainingEntries = prizePool[pool].max - (userEntries[userId]?.[pool] || 0); // 修正这里的括号
          result += `🔢 最大抽取次数: ${prizePool[pool].max}\n`;
          result += `📈 当前用户剩余抽取次数: ${remainingEntries}\n`;
        }

        return result;
      }

      // 显示所有奖池的奖品
      let result = '▶️ 当前所有奖池及奖品：\n';
      const pools = Object.entries(prizePool);
      if (pools.length === 0) {
        return '❌ 没有任何奖池信息。';
      }

      for (const [poolName, poolData] of pools) {
        result += `【${poolName}】（剩余 ${poolData.prizes.length} 个）${poolData.max ? ` | 最大抽取次数: ${poolData.max}` : ''}：\n`;
        poolData.prizes.forEach(prize => {
          result += `  • ID: ${prize.id}. "${prize.name}" - ${prize.description}\n`;
        });
      }

      return result;
    });
}
