# 全局工具箱

一款面向 Windows 的桌面效率工具。应用常驻系统托盘，通过全局快捷键快速呼出话术面板、AI 助手、剪贴板历史与桌面宠物。

当前版本：`0.2.0`

## 功能

- **话术面板**：分组管理常用文字和图片，支持搜索、长按拖动排序、右键重命名、复制并自动粘贴。
- **AI 助手**：兼容 OpenAI Chat Completions 接口，支持真实模型发现、服务连通性测试、文字/截图提问、流式回答、自定义人设与提示词。
- **剪贴板记录**：在后台记录复制的文字与图片，支持搜索、预览、复制、粘贴和清理。
- **桌宠**：内置三套开源素材，支持试听、拖动、缩放、DIY 形象与原声导入，以及多角色接话小剧场。
- **本地优先**：业务数据、图片、桌宠素材和 AI 凭据均保存在当前用户的 AppData 目录，不写入安装目录。

## 评委一键启动

运行环境：Windows 10 / 11，64 位。

双击交付包根目录的 `一键启动-全局工具箱.exe`。程序无需安装，首次启动会解压 Electron 运行环境，通常需要几秒。

程序未购买商业代码签名证书。Windows SmartScreen 首次可能提示“未知发布者”；确认文件来自本次交付后，点击“更多信息”再选择“运行”。

## 从源码启动

需要 Node.js 22 或更高版本。

```powershell
npm install
npm start
```

重新构建 Windows 便携版：

```powershell
npm run dist
```

构建脚本会先用 .NET Framework 编译 `native/ToolboxHelper.exe`，再由 electron-builder 生成单文件便携版到 `dist/`。

## 测试

```powershell
$files = Get-ChildItem tests -Filter *.test.cjs | ForEach-Object { $_.FullName }
node --test @files
node tests\window-interactions.cjs
```

单元测试覆盖 AI 请求协议、剪贴板监听、状态迁移和桌宠窗口状态；窗口回归使用真实 Electron DOM/IPC 验证窗口拖动、缩放、页面导航、预设编辑、剪贴板预览、桌宠与分组交互。

## 目录结构

```text
electron/       Electron 主进程、预加载、AI、状态与系统辅助
src/            渲染层 HTML / CSS / JavaScript 与内置素材
native/         Windows 原生辅助程序源码与构建脚本
build/          应用图标等构建资源
tests/          单元测试与 Electron 窗口回归
scripts/        打包产物检查脚本
package.json    依赖、启动与打包配置
```

## 数据与隐私

- 默认数据目录：`%APPDATA%\全局工具箱`
- AI 连接配置单独保存在同目录的 `ai-connection.local.json`。
- 仓库与交付包不包含个人话术、剪贴板记录、DIY 桌宠、AI 密钥或用户数据。
- 首次启动时会在本机创建空数据；可在应用设置中配置自己的 OpenAI 兼容服务。

## 主要快捷键

| 功能 | 默认快捷键 |
| --- | --- |
| 打开话术面板 | `Ctrl+Shift+Space` |
| 选中文字后打开 AI | `Alt+Q` |
| 截图提问 | `Alt+S` |
| 打开剪贴板记录 | `Alt+V` |
| 关闭当前窗口 | `Esc` |

快捷键可在应用设置中修改。

## 第三方素材

界面图标来自 Lucide，遵循 ISC 许可，来源与许可文本见 `src/assets/ui/`。内置桌宠素材的来源与权利说明见 `src/assets/pets/CREDITS.md`。
