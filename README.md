# DCSHUB

DCSHUB 是面向 DCS World 玩家的 Windows 桌面管理工具，用于统一启动飞行所需的软件、管理本地模组，并通过本地手册索引和 DeepSeek 提供可核对原文的问答能力。

当前源码版本：V2.2.1

下载地址：[GitHub Releases](https://github.com/Jonitane/DCSHUB/releases/latest)

问题反馈：[GitHub Issues](https://github.com/Jonitane/DCSHUB/issues)

## 项目定位

DCS World 玩家通常需要同时运行头显平台、外设驱动、语音通信、辅助输入和其他工具。DCSHUB 将这些软件集中到一个启动预设中，提供状态检查、静默启动、窗口唤起和一键停止能力；游戏模组、手册资料和 DCS 启动模式也可以在同一界面管理。

DCSHUB 是玩家社区独立项目，与 Eagle Dynamics 及所接入软件的厂商、作者或项目没有隶属、授权或背书关系。

## 界面预览

### 仪表板

软件预设、模组预设、桌面/VR 启动模式和 DCS 启动入口集中在同一页面。

![DCSHUB 仪表板](docs/screenshots/dashboard.png)

### 超级手册

根据本地手册生成回答，保留来源编号、原文页码和对应页面图像。

![DCSHUB 超级手册](docs/screenshots/manual.png)

### 本地模组管理器

支持多个 DCS 目录、独立本地仓库、全局模组预设以及文件备份和还原。

![DCSHUB 模组管理器](docs/screenshots/mods.png)

### 游戏内置手册窗口

同一套问答界面可在桌面或 OpenXR VR 环境中呼出。VR 面板固定在 LOCAL 空间，支持回中、拖动和原页查看。

![DCSHUB 游戏内置手册窗口](docs/screenshots/in-game-manual.png)

## 主要功能

### 软件启动与管理

- 使用软件预设一键启动尚未运行的工具，避免重复拉起现有进程。
- 对内置模块提供路径发现、状态监控、窗口唤起和针对性的正常退出逻辑。
- 支持普通启动和静默启动；用户可为每个软件设置启动延迟。
- 支持添加任意本地软件，自动读取程序名称和图标。
- 支持桌面或 VR 模式启动 DCS，也可单独打开 DCS Launcher。
- DCSHUB 不在前台时降低状态检查频率，减少后台占用。

### 超级手册

- 支持 PDF、DOCX、EPUB、HTML、Markdown、TXT 和 RTF。
- 可以复制 DCS 安装目录中的官方英文手册，也可以下载 Chuck's Guides 或导入用户资料。
- 为用户手册、DCS 官方手册和 Chuck 手册维护可长期复用的本地索引；未变化的文件不会重复处理。
- 根据机型和资料来源进行严格路由，避免将其他机型的操作方法混入答案。
- 使用证据约束的 DeepSeek V4 Flash 将专业原文改写为更易学习的步骤，同时保留控制项、数值、术语和来源编号。
- 回答可嵌入对应页的原图，支持放大、翻页和直接打开原手册位置。
- 本地问答与主动联网搜索结果均可持久缓存；相同问题优先读取缓存。
- 主动联网搜索使用 DeepSeek V4 Pro MAX，用于核对版本变化和补充公开资料。
- API Key 使用 Windows 当前用户凭据加密保存。

### 桌面与 VR 内置窗口

- 桌面模式使用独立的可拖动浮窗，不覆盖整个显示器。
- VR 模式通过原生 OpenXR API Layer 将相同界面提交到头显。
- 每次呼出在当前视线方向建立 LOCAL 空间锚点，面板不会持续跟随头部移动。
- 呼出时自动去除头部 Roll 侧倾，使画布保持水平。
- 拖动面板时围绕呼出锚点做球面轨道运动，距离保持不变，面板持续朝向锚点。
- 快捷键采用全局按键边沿监听；关闭后主动把焦点归还 DCS。

### 本地模组管理器

- 支持多个 DCS 游戏目录，每个目录拥有独立的本地模组仓库。
- 支持文件夹模组和 ZIP 导入、单个启停、全部启停及状态统计。
- 启用模组时记录被替换文件，停用时恢复原文件。
- 支持文件冲突检查和全局模组预设。
- 支持备份 `Saved Games\DCS\Config`，并显示上次备份时间。

### 更新策略

- 应用可以在启动时静默读取 GitHub Releases，但不会自动下载或安装。
- 只有发布说明中包含维护者推送标记的版本才会弹出更新通知。
- 日常提交和普通修复可以合并到仓库而不打扰现有用户。
- 用户可以在设置中关闭启动时更新检查。

## 已接入软件

| 软件 | 集成功能 |
| --- | --- |
| VoxBind | 主程序启停、窗口唤起、实时翻译和语音功能控制 |
| DCS-SRS | 读取服务器预设、连接或断开服务器、预警机浮窗 |
| DCS EyeMouse | 启动按键与双眨触发、运行状态和自检日志 |
| MOZA Cockpit | 普通或静默启动、状态监控、窗口唤起和正常退出 |
| PimaxVR | Pimax Play 启动；QuadViews 聚焦参数读写与应用 |
| AimxyZ | 普通或静默启动、状态监控和窗口唤起 |
| 用户软件 | 自动读取名称和图标，提供普通或静默启动及兼容性关闭兜底 |

## 安装与首次使用

系统要求：Windows 10/11 x64。

1. 从 [GitHub Releases](https://github.com/Jonitane/DCSHUB/releases/latest) 下载 Windows 安装程序。
2. 运行安装程序并选择安装目录。DCSHUB 为处理游戏目录、外部软件和 OpenXR 组件申请管理员权限。
3. 首次启动时选择需要接入的内置模块。
4. 在“设置 > 软件设置”中执行自动识别，并为未识别的软件手动选择主程序。
5. 在仪表板创建软件预设和模组预设，然后选择桌面或 VR 模式启动 DCS。
6. 如需使用超级手册，在设置中选择手册库目录并填写自己的 DeepSeek API Key。

公开版本以安装版为准。绿色版仅用于本地开发调试，不作为正式分发方式。

当前版本未进行商业代码签名。Windows 可能显示 SmartScreen 提示，请只从本仓库 Releases 页面下载安装程序。

## 用户数据与隐私

程序设置默认保存在：

```text
%APPDATA%\dcs-control-hub
```

手册库、模组仓库和备份目录由用户自行选择。DeepSeek API Key 使用 Windows 当前用户凭据加密；DCSHUB 不提供公共密钥，也不会将用户手册上传到项目仓库。调用 DeepSeek 时只发送为当前问题检索出的相关文本。

## 开发与验证

开发环境：Windows 10/11 x64、Node.js 20 LTS、npm。

```powershell
npm install
npm run dev
npm run lint
npm test
npm run typecheck
npm run build
```

主要目录：

```text
electron/builtins/       DCS 启动、模组管理、超级手册、更新和 VR 服务
electron/integrations/   外部软件适配器
electron/modules/        模块生命周期、状态、日志和调度
native/vr-overlay/       OpenXR API Layer、共享协议和帧桥接程序
src/components/          通用界面组件
src/pages/               仪表板、超级手册、模组管理器和设置页面
src/shared/              Main、Preload 与 Renderer 的共享类型契约
tests/                   核心服务集成测试
```

详细版本记录见 [CHANGELOG.md](CHANGELOG.md)，V2.2.0 的完整说明见 [docs/releases/V2.2.0.md](docs/releases/V2.2.0.md)。

## 参与项目

- 提交问题或建议：[GitHub Issues](https://github.com/Jonitane/DCSHUB/issues)
- 贡献代码：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全问题：[SECURITY.md](SECURITY.md)

## 许可证

DCSHUB 自有源代码使用 [MIT License](LICENSE)。软件名称、商标、截图和其他第三方素材归各自权利人所有，详见 [NOTICE.md](NOTICE.md)。
