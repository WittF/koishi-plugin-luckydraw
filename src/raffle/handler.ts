import * as fs from 'fs/promises'
import { RaffleData } from '../types'

export class RaffleHandler {
  constructor(private raffleDataFilePath: string) {}

  // 初始化文件
  async initializeFile(filePath: string, defaultContent: object): Promise<void> {
    try {
      await fs.access(filePath)
    } catch {
      await fs.writeFile(filePath, JSON.stringify(defaultContent, null, 2), 'utf-8')
    }
  }

  async initializeFiles(): Promise<void> {
    await this.initializeFile(this.raffleDataFilePath, {})
  }

  // 读取抽奖数据
  async loadRaffleData(): Promise<RaffleData> {
    try {
      const data = await fs.readFile(this.raffleDataFilePath, 'utf-8')
      return JSON.parse(data)
    } catch (error) {
      throw new Error('读取抽奖数据失败')
    }
  }

  // 保存抽奖数据
  async saveRaffleData(raffleData: RaffleData): Promise<void> {
    try {
      await fs.writeFile(this.raffleDataFilePath, JSON.stringify(raffleData, null, 2), 'utf-8')
    } catch (error) {
      throw new Error('保存抽奖数据失败')
    }
  }
}
