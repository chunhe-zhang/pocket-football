# RAI 雷元素角色

`rai-lightning.vrm` 是 Pocket Football 现有 `player.vrm` 的雷元素修改版。
采用银紫发色、紫色虹膜、定制 07 号球衣、35 个骨骼附着配件；原人形骨骼、蒙皮、表情、节点约束及弹簧骨骼保持不变。

游戏发行版对新增刚性配件焊接重复顶点，对不透明贴图使用 core glTF 支持的高质量 JPEG，对透明贴图保留 PNG，并清除已替换的旧二进制块。可编辑高精度源文件仍保留在本地交付文件夹。

基础模型元数据：`VRM1_Constraint_Twist_Sample v1.0.1`，作者 `pixiv Inc.`，版权 `(c) 2022 pixiv Inc.`。原始与修改版 VRM 保留内嵌使用条件：允许修改和再分发，`commercialUsage: corporation`。完整条款以文件元数据与 https://vrm.dev/licenses/1.0/ 为准；本模型不归本仓库代码的 MIT 许可重新授权。

基础来源：https://github.com/chunhe-zhang/pocket-football/blob/main/assets/models/player.vrm

新增配件为本项目制作，新增球衣、脸部、虹膜与头发贴图由 OpenAI imagegen 辅助制作。没有使用《原神》《鸣潮》的提取模型或贴图。

运行时：仅 `thunder` 使用此模型，选人卡片与比赛共用同一个角色变体映射。保留作者球衣和发色，不再叠加旧版雷头环、发饰、护腕和脚环；队伍归属继续由球员标记及记分牌显示。其他五种元素沿用原模型。

`src/lightning-vfx.js` 为程序化雷电视觉组件，`src/game-lightning.js` 将其接到真实球路、冲刺、蓄力和命中事件；沿用现有游戏音效，无新增联网素材依赖。
