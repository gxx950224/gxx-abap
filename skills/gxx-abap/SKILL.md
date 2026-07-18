---
name: gxx-abap
description: This skill should be used when the user needs to operate a SAP ABAP development system from the terminal via the ABAP Development Tools (ADT) CLI — the `gxx-abap` command. It covers listing/searching objects, reading or writing source code, activating, syntax-checking, managing transports, inspecting table/structure metadata, where-used references, short dumps, message classes, and text elements. Trigger on requests to create, edit, activate, check, or inspect ABAP objects (programs, classes, interfaces, function modules, tables, CDS views) or to query ABAP system/transport/dump information.
category: software-development
agent_created: true
---

# gxx-abap — Agent 操作指南

通过 `gxx-abap` 命令行工具（SAP ABAP Development Tools CLI）从终端操作 SAP ABAP 开发系统。所有命令均支持 `--json` 输出，Agent 使用时应**始终加 `--json`**，解析输出做决策，再将关键信息格式化呈现给用户。

## 何时使用本 skill

- 用户要求创建 / 修改 / 激活 / 检查 / 查看 ABAP 对象（程序、类、接口、函数组与函数模块、表、CDS 视图）
- 用户要求搜索对象（`ls`）、查看源码（`cat`）、查表字段与结构（`meta`）、Where-Used 引用（`refs`）、短转储（`dump`）、消息类（`message`）、文本元素（`texts`）
- 用户要求管理传输请求（`transport`）、查看系统信息（`system`）、排查程序 DUMP

## 核心规则（必须遵守）

1. **始终用 `--json`** — 所有命令都加 `--json`，解析输出做决策，不要把原始 JSON 直接展示给用户。
2. **创建对象先搜索** — 用 `ls` 确认对象不存在再 `create`，不要用 `create` 创建已存在的对象。
3. **写入源码标准流程** — `ls` 检查 → `create` → 写本地文件 → `put` 写入 SAP → `activate` 激活 → `check` 验证 → 看错误修正后重试。
4. **修改已有对象流程** — `cat` 读源码 → 修改 → `put` 写入 → `activate` 激活。
5. **排查故障用 `dump`** — 程序 DUMP 后用 `gxx-abap dump` 查详情，从 `termination.line` 定位出错行。
6. **文本元素格式** — 首行 `@MaxLength:N`（最大文本字节数），后续行 `KEY=VALUE`（单等号）。selections/headings 无 MaxLength 头。symbols 只支持更新已存在条目，不能新建（DS 512）。
7. **传输号是任务号不是请求号** — `transport list` 返回值是请求号；`create --transport` 需要的是其下的**任务号**（在 SE10 展开节点确认）。
8. **查看表字段用 `meta` 不用 `cat`** — `meta` 直接返回结构化字段列表；`cat -t table` 只返回表头定义源码，不直接。
9. **`put` 自动解锁** — 写入后在 finally 块自动调用解锁接口，不用手动调解锁；残留锁可用 `--force-unlock`。
10. **涉及修改写入的命令必须向用户确认** — 特别是 `create`、`put`、`texts --set`、`activate`，执行前展示变更概要并获得明确许可。

## 禁忌清单

- ❌ 不要用 `create` 创建已存在的对象 —— 先 `ls` 检查。
- ❌ 不要在未获用户确认时执行 `put` —— 向用户展示变更概要并等待确认。
- ❌ 不要把请求号当任务号用 —— `transport list` 返回值是请求号，`create --transport` 需要的是其下的任务号。
- ❌ 不要把 `--json` 原始输出直接展示给用户 —— 提取关键信息后格式化呈现。
- ❌ 不要对 `$TMP` 包中的对象分配正式传输号 —— `$TMP` 对象不需要也不会被传输。
- ❌ 不要在一条命令里混用 `--json` 和交互式参数 —— 需要密码时建议用预先配置好的连接。
- ❌ 查看表字段不要用 `cat -t table` —— 用 `meta` 直接获取结构化字段列表。

## 标准工作流

### 新建对象
```
ls <pattern> --json          # 确认不存在
create <name> -t <type> --description <desc> --package <pkg> --transport <task> --json
# 写本地源码文件
put <name> <file> -t <type> --json
activate <name> -t <type> --json
check <name> -t <type> --json   # 若有错误，修正后重试
```

### 修改已有对象
```
cat <name> -t <type> --json   # 读取源码
# 修改本地副本
put <name> <file> -t <type> --json
activate <name> -t <type> --json
```

### 故障排查（程序 DUMP）
```
dump --json                       # 列表，定位目标 dump
dump <14位时间戳ID> --json        # 详情，看 termination.line
```

## 确认要求

涉及修改写入的命令（`create`、`put`、`texts --set`、`activate`）执行前，必须向用户展示变更概要（对象名、类型、包、传输任务号、改动点），并获得明确许可后再执行。对外操作同样遵循此原则。

## 命令参考

完整的 17 条命令清单、参数说明与 JSON 输出结构见 `references/commands.md`。需要具体命令的详细参数、示例或返回字段时，读取该文件。

环境信息：

- CLI 工具：`gxx-abap`（全局安装）
- 类型映射：`PROG/P`=程序，`CLAS/OC`=类，`INTF/OI`=接口，`FUGR/F`=函数组，`FUGR/FF`=函数模块，`TABL/DT`=表，`DDLS/DF`=CDS 视图
- 自动识别规则：`CL_*`/`ZCL_*`→class，`IF_*`/`ZIF_*`→interface，`SAPL*`/短名→function，其他→program
