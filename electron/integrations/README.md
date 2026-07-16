# Integration Drivers

每个外部软件在独立目录中实现 `ModuleDriver`，禁止在 `electron/main.ts`、Renderer 页面或 `ModuleManager` 中添加软件名称特判。

建议目录：

```text
integrations/
  eye-mouse/
    driver.ts
    discovery.ts
    lifecycle.ts
    settings.ts
  moza/
    driver.ts
  pimax/
    driver.ts
    runtime.ts
    quadviews.ts
```

接入完成后，只在 Electron 组合根中实例化并注册：

```ts
moduleManager.register(createExampleDriver())
```

注册前必须验证：安装路径发现、重复启动、外部预先启动、健康检查、超时、中途退出、停止所有权和配置回滚。
