<div align="center">
  <img src="public/images/dcs-game-icon.png" width="88" alt="DCSHUB 图标" />
  <h1>DCSHUB</h1>
  <p>面向 DCS World 玩家的驱动、工具、插件与本地模组统一管理中心</p>
  <p>
    <a href="https://github.com/Jonitane/DCSHUB/releases/latest">下载最新版</a>
    · <a href="https://github.com/Jonitane/DCSHUB/issues">反馈问题</a>
    · <a href="docs/RELEASES.md">发布与更新</a>
  </p>
</div>

## 项目简介

DCSHUB 用来解决每次进入 DCS World 前，需要分别打开 VR 平台、外设驱动、语音工具、翻译工具和各类插件的问题。用户可以建立“软件预设”，一键启动尚未运行的软件，最后按桌面或 VR 模式进入 DCS；也可以在同一界面查看状态、打开原软件窗口或停止由 HUB 管理的软件。

项目同时内置一个面向单个 DCS 游戏的本地模组管理器。它支持多个游戏目录、每个目录独立的本地模组仓库、全局模组预设，以及 `Saved Games\DCS\Config` 的按键备份。

> DCSHUB 是玩家社区独立项目，与 Eagle Dynamics、MOZA Racing、Pimax、VoxBind、DCS-SRS、AimxyZ 等厂商或项目没有隶属、授权或背书关系。

## 主要功能

- 模块化 Driver 接入：每个软件独立实现发现、启动、状态检查、窗口唤起、设置和正常退出逻辑。
- 软件预设：选择一组常用软件，一键补齐尚未运行的项目；重复点击不会重复拉起已经运行的软件。
- DCS 启动：桌面/VR 模式切换、直接启动游戏，以及单独打开 DCS Launcher。
- 静默启动：内置模块使用针对原软件适配的托盘、最小化或隐藏启动方式；用户添加的软件可自行切换普通启动与静默启动。
- 按需监控：DCSHUB 失去焦点或最小化时暂停常规状态轮询，重新获得焦点后再刷新，降低后台开销。
- 软件目录：首次运行选择需要加载的内置模块，支持自动识别、手动指定程序路径、启停模块和添加任意 EXE。
- 深色/亮色主题。
- 中文/英文界面切换，默认中文并记住用户选择。

## 已接入软件

| 模块 | 当前集成功能 |
| --- | --- |
| VoxBind | 主程序启停、打开窗口、实时翻译、语音功能开关 |
| DCS-SRS | 读取 SRS 已保存的服务器预设、连接/断开服务器、预警机浮窗 |
| DCS EyeMouse | “启动按键 + 双眨触发”模式、运行状态与自检日志 |
| MOZA Cockpit | 普通/静默启动、运行状态、打开原软件窗口、正常退出等待 |
| PimaxVR | Pimax Play 托盘启动；QuadViews Companion 的 Horizontal focus size、Vertical focus size、Foveate resolution 双向读取与应用 |
| AimxyZ | 普通/静默启动、状态监控、打开窗口 |
| 用户软件 | 从 EXE 自动读取名称和图标，提供普通/静默启动、状态、打开窗口与兼容性关闭兜底 |

不同软件版本可能改变窗口、进程或配置文件结构。如果某个集成功能失效，请在 Issues 中附上软件版本、安装路径类型和复现步骤，避免上传账号、服务器密码等隐私内容。

## 本地模组管理器

- 配置多个 DCS 目标目录。
- 每个目标目录使用独立的本地模组仓库。
- 导入 ZIP 模组包并查看说明、版本与大小。
- 启用模组前记录被替换文件，停用时恢复原文件。
- 检测文件冲突，并在用户确认后执行覆盖。
- 创建全局模组预设，在仪表板或模组管理器中手动应用。
- 一键停用全部模组。
- 将 `%USERPROFILE%\Saved Games\DCS\Config` 备份到用户指定目录，并显示上次备份时间。

模组操作会改写目标游戏目录。首次使用前建议备份重要文件，并确认模组来源可信。不要在 DCS 或相关更新程序正在写入同一目录时切换模组。

## 下载与使用

前往 [GitHub Releases](https://github.com/Jonitane/DCSHUB/releases/latest)：

- `DCSHUB-<版本>-win-x64.zip`：绿色版，完整解压后运行 `DCSHUB.exe`，不需要安装 Node.js 或其他开发依赖。
- `DCSHUB-<版本>-win-x64.exe`：Windows 安装版，可选择安装目录。

首次运行时：

1. 选择需要接入的内置软件。
2. 在“设置 → 软件路径与管理”中执行自动识别；未识别的软件可以手动选择主程序。
3. 在“设置 → 软件预设”中选择一键启动所包含的软件。
4. 在仪表板选择桌面或 VR 模式，然后点击“一键启动”。

当前构建尚未进行商业代码签名，Windows 可能显示未知发布者或 SmartScreen 提示。请只从本仓库 Releases 下载，并核对 Release 中提供的 SHA-256 文件。

## 用户数据

用户设置不会写入程序目录，也不会进入 GitHub 仓库。Windows 默认保存位置是：

```text
%APPDATA%\dcs-control-hub
```

其中包含软件目录、模组管理状态和 DCS 启动路径等本地数据；界面主题与软件预设还会使用 Electron 页面本地存储。更换电脑或覆盖绿色版程序目录不会自动迁移这些数据，升级前可一并备份上述目录。

## 开发环境

要求：Windows 10/11 x64、Node.js 20 LTS、npm。

```powershell
npm install
npm run dev
```

常用验证命令：

```powershell
npm test
npm run typecheck
npx tsc -p tsconfig.node.json
npm run lint
npm run build
```

`npm run build` 会在 `release` 目录生成 Windows 安装包和 ZIP 绿色版。源码结构：

```text
electron/
  builtins/       DCS 启动、软件目录、本地模组管理器
  integrations/   各软件 Driver
  modules/        模块生命周期、状态、日志与调度
src/
  components/     通用界面组件
  pages/          仪表板、模块页、模组管理器、设置
  shared/         Renderer / Preload / Main 共用契约
tests/            核心服务集成测试
public/           随程序发布的本地图片资源
```

## GitHub 发布与更新

仓库使用 GitHub Actions 自动执行测试。推送形如 `v1.7.2` 的版本标签后，发布工作流会在 Windows 环境构建安装包和绿色版，并上传到 GitHub Releases。

DCSHUB 的“检查更新”按钮会打开本仓库的最新 Release 页面。当前采用“用户确认后下载并替换”的更新方式；真正的应用内静默自动更新还需要代码签名、更新包校验和回滚机制，后续可以在此基础上加入。

完整维护步骤见 [发布与更新说明](docs/RELEASES.md)。

## 参与和反馈

- Bug 与功能建议：[GitHub Issues](https://github.com/Jonitane/DCSHUB/issues)
- 开发约定：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全问题：[SECURITY.md](SECURITY.md)

## 许可证与第三方内容

DCSHUB 自有源代码使用 [MIT License](LICENSE)。软件名称、商标、图标、截图和其他第三方素材仍归各自权利人所有，不因本仓库许可证而改变，详见 [NOTICE.md](NOTICE.md)。
