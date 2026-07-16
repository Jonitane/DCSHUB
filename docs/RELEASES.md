# 发布与更新说明

## 当前更新方式

DCSHUB 使用 GitHub Releases 分发安装包和绿色版。应用内“检查更新”会打开最新 Release 页面，由用户确认后下载并替换。此方式简单、透明，也便于在升级前备份用户数据。

程序设置位于 `%APPDATA%\dcs-control-hub`，不在绿色版目录中。覆盖绿色版通常不会删除设置，但发布前仍建议备份该目录。

## 维护者发布步骤

1. 更新 `package.json` 的语义化版本，例如 `1.7.0`。
2. 更新 `src/shared/app-meta.ts` 中展示给用户的版本。
3. 更新 `CHANGELOG.md`。
4. 执行本地验证：

```powershell
npm ci
npm test
npm run typecheck
npx tsc -p tsconfig.node.json
npm run lint
npm run build
```

5. 合并到 `main` 后创建并推送版本标签：

```powershell
git tag v1.7.0
git push origin v1.7.0
```

GitHub Actions 会在 Windows 环境重新验证并构建，将 `.exe` 安装包、`.zip` 绿色版和 SHA-256 校验文件上传到 Release。

## 后续自动更新

GitHub 仓库可以承载自动更新所需的版本清单和安装包，但“自动下载并替换正在运行的桌面程序”还需要额外实现：

- 代码签名和发布者身份；
- 更新清单签名或强校验；
- 下载失败与回滚处理；
- 首次提示和用户更新策略；
- 安装版与绿色版分别处理。

在这些条件完备前，DCSHUB 保持用户确认下载的更新方式。
