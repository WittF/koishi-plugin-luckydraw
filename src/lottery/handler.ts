import * as fs from 'fs/promises'
import { LotteryPool, UserDrawEntries } from '../types'

export class LotteryHandler {
  constructor(
    private lotteryPoolFilePath: string,
    private userDrawEntriesFilePath: string
  ) {}

  // 初始化文件
  async initializeFile(filePath: string, defaultContent: object): Promise<void> {
    try {
      await fs.access(filePath)
    } catch {
      await fs.writeFile(filePath, JSON.stringify(defaultContent, null, 2), 'utf-8')
    }
  }

  async initializeFiles(): Promise<void> {
    await this.initializeFile(this.lotteryPoolFilePath, {})
    await this.initializeFile(this.userDrawEntriesFilePath, {})
  }

  // 读取抽签池数据
  async loadLotteryPool(): Promise<LotteryPool> {
    try {
      const data = await fs.readFile(this.lotteryPoolFilePath, 'utf-8')
      return JSON.parse(data)
    } catch (error) {
      throw new Error('读取抽签池数据失败')
    }
  }

  // 保存抽签池数据
  async saveLotteryPool(lotteryPool: LotteryPool): Promise<void> {
    try {
      await fs.writeFile(this.lotteryPoolFilePath, JSON.stringify(lotteryPool, null, 2), 'utf-8')
    } catch (error) {
      throw new Error('保存抽签池数据失败')
    }
  }

  // 读取用户抽签数据
  async loadUserDrawEntries(): Promise<UserDrawEntries> {
    try {
      const data = await fs.readFile(this.userDrawEntriesFilePath, 'utf-8')
      return JSON.parse(data)
    } catch (error) {
      throw new Error('读取用户抽签数据失败')
    }
  }

  // 保存用户抽签数据
  async saveUserDrawEntries(userEntries: UserDrawEntries): Promise<void> {
    try {
      await fs.writeFile(this.userDrawEntriesFilePath, JSON.stringify(userEntries, null, 2), 'utf-8')
    } catch (error) {
      throw new Error('保存用户抽签数据失败')
    }
  }
}
