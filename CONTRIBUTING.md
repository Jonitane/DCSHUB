# Contributing to DCSHUB

感谢你帮助改进 DCSHUB。提交问题时，请说明 Windows 版本、DCSHUB 版本、相关软件版本、安装类型和可复现步骤。日志中如包含用户名、服务器地址或路径，请先进行脱敏。

## 开发流程

1. 从 `main` 创建功能分支。
2. 只修改与当前问题有关的文件。
3. 保持 Renderer、Preload 与 Electron Main 之间的 IPC 契约类型一致。
4. 新增软件接入时使用独立 Driver，不在界面层直接运行外部程序。
5. 提交前执行：

```powershell
npm ci
npm test
npm run typecheck
npx tsc -p tsconfig.node.json
npm run lint
```

涉及打包行为时还应执行 `npm run build`。

## Driver 原则

- 明确软件发现、正常启动、静默启动、健康检查、打开窗口和退出策略。
- 优先使用软件自身的退出机制；只有用户添加软件且无法正常退出时，才进入兼容性兜底。
- 不拼接不受信任的 Shell 命令；程序路径和参数分别传递。
- 说明哪些进程或服务由 HUB 管理，避免误停用户独立启动的实例。
- 为配置文件写入、模组替换和备份操作增加路径边界检查。

## Pull Request

PR 请说明变更内容、原因、用户影响和验证方法。一个 PR 尽量只处理一个主题。
