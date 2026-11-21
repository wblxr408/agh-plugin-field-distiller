# 排障记录转 Skill · Troubleshooting Skill Distiller

从排障轨迹提取成功路径、失败原因和证据，生成待审核的 SKILL.md。

市场版本提供配置和启动入口，运行权限通过独立组件或 MCP 单独授权。

## 运行

在 AGH 中另行安装运行组件，审核权限后启用。

```sh
agh plugins add git:https://github.com/wblxr408/agh-plugin-field-distiller#3c06ede1aa67b3707e87f32869f1f4286afba86d
```

从「智能体」启动运行组件自己的入口 `@wblxr408/field-distiller-runtime#distiller`。从排障轨迹提取成功路径、失败原因和证据，生成待审核的 SKILL.md。
使用 JSONL 或事件数组作为输入。生成后先审核 Markdown，再发布 Skill。

[运行组件源代码](https://github.com/wblxr408/agh-plugin-field-distiller/tree/runtime-v1.0.0)
