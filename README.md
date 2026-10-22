# dsh-bluefish-pet

[![npm version](https://img.shields.io/npm/v/dsh-bluefish-pet?color=2f81f7&label=npm)](https://www.npmjs.com/package/dsh-bluefish-pet)
[![npm downloads](https://img.shields.io/npm/dm/dsh-bluefish-pet?color=2f81f7)](https://www.npmjs.com/package/dsh-bluefish-pet)
[![license](https://img.shields.io/npm/l/dsh-bluefish-pet?color=54e39a)](./LICENSE)
[![platform](https://img.shields.io/badge/platform-macOS%2013%2B-000?logo=apple&logoColor=white)](https://github.com/davyxiaoxiao/dsh-plugin-bluefish-pet)

> 在 DSH 侧边栏启动 / 隐藏 / 显示 / 退出「鲸鱼娘」桌面宠物，并随 DSH 启动自动拉起。

一个 **host + client** 的 DSH 插件，配合独立的 macOS 桌宠 App「鲸鱼娘」使用。
*Control the BlueFish desktop pet from DSH's sidebar — start, hide, show, quit, and auto-launch with DSH.*

---

## 功能

- **侧边栏「鲸鱼娘」按钮**：实时显示桌宠状态，点一下切换显示 / 隐藏
  - 灰点「鲸鱼娘」：桌宠没在运行
  - 绿点「鲸鱼娘 开」：正在桌面上
  - 黄点「鲸鱼娘 隐」：还在运行但已隐藏
- **斜杠命令**：`/pet`、`/pet-start`、`/pet-show`、`/pet-hide`、`/pet-quit`、`/pet-status`
- **随 DSH 启动自动拉起**：DSH 启动后 1.5 秒检查一次，没运行就打开 App，失败自动重试两次
- **不依赖 DSH 的 webServer 路由**：按钮直接访问桌宠 App 内置的本地控制端口 `127.0.0.1:47113`，所以桌面版 DSH 也能用
- 状态每 5 秒同步一次；点击立即刷新

## 前置条件

- macOS 13 或更高
- DSH 桌面版 `>= 0.1.5-rc.1`
- 先安装 [鲸鱼娘 App](https://github.com/davyxiaoxiao/dsh-whalegirl)，默认放在 `/Applications/WhaleGirl.app`
  （也支持 `WHALEGIRL_APP=/path/to/WhaleGirl.app`，以及 `~/Applications`、旧 BlueFish 路径）

## 安装

插件只有几十 KB，安装动作就是在 DSH 的插件页填一个来源。先确认上面「前置条件」里的鲸鱼娘 App 已经装好。

### 方式 A：npm（推荐）

在 DSH 左侧「插件」页 → 安装 → 输入包名：

```
dsh-bluefish-pet
```

npm 页面：https://www.npmjs.com/package/dsh-bluefish-pet

即从 npm 官方源拉取最新版本：<https://www.npmjs.com/package/dsh-bluefish-pet>

### 方式 B：GitHub 仓库

在同一个安装框输入：

```
github:davyxiaoxiao/dsh-plugin-bluefish-pet
```

### 方式 C：本地文件夹（开发 / 离线）

解压本仓库到固定位置，在安装框输入文件夹绝对路径，例如：

```
/Users/<you>/Downloads/dsh-plugin-bluefish-pet
```

安装完成后**重启 DSH**。侧边栏底部会出现「鲸鱼娘」按钮。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/pet` | 没启动就启动；已在运行就切换显示 / 隐藏 |
| `/pet-start` | 启动桌宠 |
| `/pet-show` | 显示桌宠 |
| `/pet-hide` | 隐藏桌宠 |
| `/pet-quit` | 退出桌宠 |
| `/pet-status` | 查看是否在运行 / 是否显示中 |

## 更新

DSH 桌面版的内置插件页对「按名字安装」的组合包，更新路径是**先卸载再重新安装**（这是插件管理器的行为，不是插件自身）：

1. 插件页里把 `dsh-bluefish-pet` 卸载 / 关闭；
2. 重新输入 `dsh-bluefish-pet` 安装（会拉取 npm 最新版）；
3. 重启 DSH。

更省事的方式是用 **DSH 插件市场**（dshmarket）的「更新」功能，它会检查已安装插件的 npm 新版本并原地更新。
重新安装后 `autoStart` 等配置可能会丢，需要的话重新加一次。

App 的更新则是下载新的 pkg **覆盖安装**，不需要先卸载。

## 配置

默认随 DSH 自动启动。要关掉，在 DSH profile 的插件条目上加：

```yaml
- insert:
    - id: bluefish-pet
      name: dsh-bluefish-pet
      config:
        autoStart: false
```

## 工作原理

```
DSH 主机（Node）                          DSH 客户端（浏览器）
┌──────────────────────────┐              ┌──────────────────────────┐
│ lib/index.js             │              │ lib/client.js            │
│  · /pet 等 commands      │              │  · sidebar.footer.action │
│  · 启动时 open App       │              │  · 每 5s 查状态          │
│  · 通过 bluefish:// 控制 │              │  · 点击 POST /toggle    │
└────────────┬─────────────┘              └────────────┬─────────────┘
             │ open / bluefish://                       │ HTTP
             ▼                                          ▼
        鲸鱼娘.app  ──────────  127.0.0.1:47113  ─────────┘
                              /status /toggle /show /hide
```

- **宿主半边**（`lib/index.js`）注册斜杠命令，并用 `open` 启动 App、`bluefish://` URL scheme 控制已运行的 App；
- **客户端半边**（`lib/client.js`）通过 `ctx.slots.register('sidebar.footer.action', …)` 放按钮，直接 `fetch('http://127.0.0.1:47113/status')`；
- 桌宠 App 内置一个只监听本机的 HTTP 控制服务（Network.framework，带 CORS），所以不需要 DSH 的 `webServer` 服务；
- 自动启动日志写在**插件安装目录下的 `plugin.log`**，排查时先看 `auto start` 行。

## 常见问题

**按钮一直是灰色，点了没反应？**
先确认 App 在运行：

```bash
curl -s http://127.0.0.1:47113/status
# {"ok":true,"running":true,"visible":true}
```

- 连不上 → App 没启动，或被移动了；用 `/pet` 或双击 App 启动；
- 能连上但按钮灰 → DSH 客户端还是旧代码，重启一次 DSH。

**自动启动没生效？**
- 看插件安装目录下的 `plugin.log`；
- 确认 App 在 `/Applications/WhaleGirl.app`，或设置 `WHALEGIRL_APP`；
- 插件页显示「启动失败」时，多半是宿主没加载，升级 DSH 后重启。

**按钮能切换但 App 不出现？**
这是 App 自身窗口位置问题，不是插件：用菜单栏小鱼 →「回到右下角」，或：

```bash
curl -X POST http://127.0.0.1:47113/recenter
```

## 开发

```
lib/index.js       宿主：commands、自动启动、bluefish:// 控制
lib/client.js      客户端：sidebar.footer.action 按钮（DSH module-loader 格式）
cordis.patch.yml   组合包 patch，安装后自动挂载
```

纯 JavaScript，无构建步骤。本地调试时把文件夹路径填进 DSH 插件页安装即可；改完代码重启 DSH 生效。
`npm pack` 可打出发布用的 tarball。

## 链接

- npm 包：<https://www.npmjs.com/package/dsh-bluefish-pet>
- GitHub 仓库：<https://github.com/davyxiaoxiao/dsh-plugin-bluefish-pet>
- 问题反馈：<https://github.com/davyxiaoxiao/dsh-plugin-bluefish-pet/issues>

## License

MIT
