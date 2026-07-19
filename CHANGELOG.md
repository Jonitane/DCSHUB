# Changelog

本项目从 V1.6 开始通过 GitHub Releases 记录公开版本。

## V1.8.0 - 2026-07-19

- 新增“DCS 智能手册”内置程序和独立侧边栏入口。
- 支持 PDF、DOCX、EPUB、HTML、Markdown、TXT 与 RTF 手册的本地永久索引。
- 使用文件大小、修改时间和 SHA-256 内容指纹进行增量更新；未变化时直接使用压缩缓存，不在后台重复解析。
- 支持一键复制 DCS 客户端各模块 Doc 目录中的手册并入库。
- 支持用户选择机型后从 Chuck's Guides 官方页面下载 PDF 并自动入库，不随 DCSHUB 重新分发第三方手册。
- 接入用户自备的 DeepSeek API Key，默认使用 `deepseek-v4-flash`，可选 `deepseek-v4-pro`。
- DeepSeek Key 使用 Windows Safe Storage 加密保存；问答只发送命中的少量文字片段，并返回本地手册来源。
- 预留截图提问接口；当前版本仅开放文字检索和文字问答。

## V1.7.2 - 2026-07-17

- 修复模块路由首次加载时短暂显示 404 页的问题。
- 修复对话框被侧边栏遮挡的问题，并补充 Escape、焦点恢复和模态语义。
- 补全英文模式下的界面、提示消息和目录选择窗口文案。
- 修复弹窗内下拉菜单按 Escape 时同时关闭整个弹窗的问题。

## V1.7.1 - 2026-07-16

- 修复 GitHub 标签构建时 `electron-builder` 提前尝试发布并因缺少令牌失败的问题。
- 构建阶段只生成安装包和绿色版，由后续受控步骤统一上传到 GitHub Releases。

## V1.7.0 - 2026-07-16

- 在左上角 DCSHUB 标题区域加入本地国旗语言切换。
- 默认使用中文，可切换英文，并在重启后保留选择。
- 覆盖主要界面、按钮、状态、提示和模块快捷操作；保留第三方原始日志与模组说明内容。

## V1.6.0 - 2026-07-16

- 首次发布 GitHub 公开仓库与可下载 Release。
- 集成 VoxBind、DCS-SRS、DCS EyeMouse、MOZA Cockpit、PimaxVR 与 AimxyZ。
- 支持用户自行添加软件、自动读取名称和图标、普通/静默启动。
- 支持软件预设、一键补齐启动、桌面/VR DCS 启动和 Launcher。
- 加入多目录本地模组管理器、全局模组预设及 Saved Games Config 按键备份。
- 软件失去焦点时暂停常规进程轮询，降低后台资源占用。
- “检查更新”入口迁移到 GitHub Releases。
