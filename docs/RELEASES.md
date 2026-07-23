# 发布与更新说明

## 分发方式

DCSHUB 的公开版本只提供 Windows 安装版。绿色目录保留给维护者进行本地调试，不作为正式用户分发方式。

安装程序、校验文件和版本说明通过 GitHub Releases 发布。V2.6.0 起程序设置保存在安装目录的 `data` 文件夹，首次启动会非覆盖迁移旧 `%APPDATA%\dcs-control-hub`；覆盖升级必须保留 `data`，不得删除用户设置、软件预设、模组预设或问答缓存。

## 应用内更新检查

DCSHUB 只读取 `Jonitane/DCSHUB` 的正式 GitHub Releases，不会自动下载或替换程序。

普通 Release 和日常代码合并不会触发弹窗。只有维护者确认需要主动推送的版本，才在 Release 正文中加入以下隐藏标记：

```html
<!-- dcshub-push-update -->
```

客户端发现版本号更高且包含该标记的正式 Release 后，显示更新内容和下载入口。用户可以在设置中关闭启动时检查。

## 维护者发布步骤

1. 更新 `package.json`、`package-lock.json` 和 `src/shared/app-meta.ts` 中的版本号。
2. 更新 `CHANGELOG.md` 和对应的详细版本说明。大版本或大更新还必须同步更新仓库首页 `README.md`，确保正式版本号、重点功能、安装说明、截图说明和支持的服务与当前 Release 一致。
3. 执行完整验证：

```powershell
npm ci
npm run lint
npm test
npm run typecheck
npx tsc -p tsconfig.node.json
npm run build
```

4. 将代码合并到 `main`。
5. 仅在准备正式安装包时创建版本标签：

```powershell
git tag V2.2.0
git push origin V2.2.0
```

标签会触发 GitHub Actions，在 Windows 环境重新验证并构建安装程序，同时生成 SHA-256 校验文件。

6. 如需向现有用户主动推送该版本，在 Release 正文中加入更新标记；普通维护版本不要加入。

## 发布前检查

- 确认安装程序可以全新安装和覆盖升级。
- 确认首次启动、管理员权限、DPI 缩放和中文路径正常。
- 确认安装目录 `data` 在覆盖升级后保持不变，并确认旧 `%APPDATA%\dcs-control-hub` 首次迁移成功。
- OpenXR 原生层变更后必须彻底重启 DCS 再测试。
- 确认 Release 说明清楚列出用户可见变化、兼容性要求和已知限制。
- 大版本或大更新必须确认 GitHub 仓库首页 `README.md` 已同步，不能只更新 Release 正文和 `CHANGELOG.md`。
