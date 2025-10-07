# koishi-plugin-luckydraw

[![npm](https://img.shields.io/npm/v/koishi-plugin-luckydraw?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-luckydraw)

功能完整的 Koishi 抽奖/抽签插件。支持**抽签模式**（抽完即止）和**抽奖模式**（定时开奖）。

## 功能特性

**抽签模式（Lottery）** - 类似盲盒，抽完就没
- 限量奖品发放、先到先得活动

**抽奖模式（Raffle）** - 多人参与，定时开奖
- 群内定时抽奖、节日福利发放

## 命令

### 抽签命令

**用户**
- `lottery.draw <池名>` - 抽签（奖品抽完自动结束）

**管理员**
- `lottery.pool.add <池名> <签品名> <签品描述>` - 添加签品
- `lottery.pool.remove <池名> [签品ID]` - 删除签品/抽签池
- `lottery.pool.show [池名]` - 查看抽签池信息

### 抽奖命令

**管理员**
- `raffle.create` - 交互式创建抽奖（名称→时间→奖品→口令）

**用户**
- `raffle.join <活动ID>` - 参与抽奖
- `发送口令` - 直接发送口令参与（如管理员设置了口令）
- `raffle.list` - 查看进行中的抽奖
- `raffle.info <活动ID>` - 查看抽奖详情

**管理员**
- `raffle.cancel <活动ID>` - 取消抽奖

## 快速开始

### 抽签示例

```bash
# 管理员添加签品
lottery.pool.add 红包 一等奖 188元
lottery.pool.add 红包 None none  # 谢谢参与

# 用户抽签（每人限1次）
lottery.draw 红包
```

### 抽奖示例

```bash
# 管理员创建
raffle.create
# 按提示输入：
# 1. 活动名称：春节抽奖
# 2. 开奖时间：1h（1小时后）
# 3. 奖品：一等奖|iPhone|1
# 4. 口令：新年快乐（或"跳过"）

# 用户参与
新年快乐  # 直接发送口令
# 或
raffle.join 活动ID
```

## 高级特性

- ✅ 交互式创建，支持口令参与
- ✅ 自动定时开奖，状态持久化
- ✅ 支持未中奖逻辑（None签/自动标记）
- ✅ 抽签模式每人限1次，公平抽取
- ✅ 模块化代码结构

### 未中奖逻辑

**抽签**：添加 `None none` 签品表示"谢谢参与"，只剩None签时自动结束
**抽奖**：参与人数>奖品数时，未中奖者自动标记但不显示

## 配置

- `adminQQ` - 管理员QQ号
- `debugMode` - 调试模式

## 数据存储

`data/luckydraw/` 目录：
- `lottery_pools.json` - 抽签池
- `user_draw_entries.json` - 抽签记录
- `raffle_activities.json` - 抽奖活动

## 许可证

MIT License
