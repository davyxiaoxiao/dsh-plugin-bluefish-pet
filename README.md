# dsh-bluefish-pet

在 DSH 里用斜杠命令启动 / 显示 / 隐藏 / 退出「鲸鱼娘」桌面宠物。

## 安装（朋友用：DSH 插件页从本地文件夹安装）

1. 先把鲸鱼娘 App 安装到 `/Applications/WhaleGirl.app`（插件会在这里找它）。
2. 解压 `dsh-plugin-bluefish-pet` 文件夹，随便放在一个固定位置（例如 `~/Downloads/dsh-plugin-bluefish-pet`）。
3. 打开 DSH 桌面版 → 左侧「插件」页 → 安装插件；
4. 在安装框里粘贴这个文件夹的绝对路径（例如 `/Users/你的用户名/Downloads/dsh-plugin-bluefish-pet`），确认安装；
5. 重启 DSH。侧边栏底部会出现「鲸鱼娘」按钮，DSH 启动时也会自动拉起鲸鱼娘。

如果安装页只接受 npm / GitHub 包名：这个包也可以直接发布（包名 `dsh-bluefish-pet` 在 npm 上目前未被占用）：

```bash
cd dsh-plugin-bluefish-pet
npm login
npm publish --access public
```

之后朋友在插件市场搜索 `dsh-bluefish-pet` 安装即可。

## 自动启动

插件默认在 **DSH 启动后自动拉起鲸鱼娘**：主机半边在启动 1.5 秒后检查一次（没运行就 `open WhaleGirl.app`，失败会重试两次），GUI 半边挂载时也会检查一次并补启动；不需要再单独打开。

自动启动的每一步会写到 `dsh-plugin-bluefish-pet/plugin.log`，如果没启动，先看这个日志里的 `auto start` 行。

想关掉自动启动，在 profile 的 `cordis.patch.yml` 里给这个条目加 config：

```yaml
- insert:
    - id: bluefish-pet
      name: dsh-bluefish-pet
      config:
        autoStart: false
```

## 界面

安装后 DSH 侧边栏底部（和 cost-meter 同一片 footer）会多出一个「鲸鱼娘」小按钮：

- 灰点「鲸鱼娘」：没运行，点一下启动；
- 绿点「鲸鱼娘 开」：在桌面上，点一下隐藏；
- 黄点「鲸鱼娘 隐」：还在运行但已隐藏，点一下叫回来。

按钮每 5 秒从 `/bluefish-pet/status` 同步一次状态，点击时立即刷新；鼠标悬停会显示提示。
斜杠命令仍然保留，两种方式等价。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/pet` | 没启动就启动；已经在跑就切换显示 / 隐藏 |
| `/pet-start` | 启动桌宠 |
| `/pet-show` | 显示桌宠 |
| `/pet-hide` | 隐藏桌宠 |
| `/pet-quit` | 退出桌宠 |
| `/pet-status` | 查看是否在运行 / 是否显示中 |

## 安装

一键脚本（在 dshpeg 仓库根目录）：

```bash
bash scripts/install-plugin.sh
```

它做的就是「软链 + 用户 patch 层 insert 行」两件事，幂等、会先备份 `cordis.patch.yml`；
卸载用 `bash scripts/uninstall-plugin.sh`。

**桌面版（desktop profile）已经挂载好了**：桌面版 profile 由 Electron 应用独占管理，
`dsh plugin --profile desktop add ...` 会直接拒绝（`profile "desktop" is managed
exclusively by the Electron application`），所以这里用「软链 + 用户 patch 层」手动挂载：

- `~/.dsh/profiles/desktop/node_modules/dsh-bluefish-pet` → 本目录（软链）
- `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾加了：

  ```yaml
  - insert:
      - id: bluefish-pet
        name: dsh-bluefish-pet
  ```

**重启 DSH 桌面版**后插件才会挂载（当前会话不受影响，重启后输入 `/pet` 即可）。
原文件备份在 `cordis.patch.yml.bak-bluefish`。

其他 profile（比如 `web`）可以直接用 CLI：

```bash
dsh plugin --profile web add /Users/daiwei/project/myself/dshpeg/dsh-plugin-bluefish-pet
```

手动挂载（其他 profile 或桌面版重装时）：

1. 在 `~/.dsh/profiles/desktop/package.json` 的 dependencies 里加
   `"dsh-bluefish-pet": "file:/Users/daiwei/project/myself/dshpeg/dsh-plugin-bluefish-pet"`；
2. 在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾加：

   ```yaml
   - insert:
       - id: bluefish-pet
         name: dsh-bluefish-pet
   ```

3. 在 profile 目录跑一次 `pnpm install`，然后重启 DSH。

## 原理

- 这是一个 **host-only** 插件：`apply(ctx)` 里用 `ctx.commands.register(...)` 注册命令，处理器跑在 DSH 的 Node 进程里，所以可以直接起进程；
- 启动用 `/usr/bin/open <WhaleGirl.app>`；控制已运行的宠物用 **`bluefish://` URL scheme**（`toggle` / `show` / `hide` / `quit`），桌宠那边由 `AppDelegate.application(_:open:)` 接收；
- 桌宠每次显示 / 隐藏会把状态写到 `~/.dsh/storages/bluefish-pet.json`，插件读它来实现 `/pet-status` 和侧边栏按钮的状态；
- 界面半边（`lib/client.js`）是 DSH 的 client 插件：通过 `ctx.slots.register('sidebar.footer.action', ...)` 放按钮，`fetch('/bluefish-pet/status')` / `POST /bluefish-pet/toggle` 调主机半边注册的 `webServer` 路由；
- 找不到 app 时用 `WHALEGIRL_APP=/path/to/WhaleGirl.app` 指定路径（兼容旧的 `BLUEFISH_APP`；默认会找
  `~/project/myself/dshpeg/build/WhaleGirl.app`、`/Applications/WhaleGirl.app`、`~/Applications/WhaleGirl.app`，以及旧的 BlueFish 路径）。

## 依赖

- 鲸鱼娘桌宠需要已经构建好（`build/WhaleGirl.app`），并且是带 `bluefish://` scheme 的版本；
- DSH `>= 0.1.5-rc.1`（提供 `commands` 服务）。
