# 火、冰、风、影、土角色与特效

五个 VRM 是 Pocket Football 现有 `player.vrm` 的独立元素修改版，沿用与雷角色相同的人形骨骼、蒙皮、表情、节点约束和弹簧骨骼。

| ID | 文件 | 独立造型 |
|---|---|---|
| blaze | blaze.vrm | 红橙长发、火纹球衣、三簇火焰冠、围巾、余烬护腕 |
| frost | frost.vrm | 冰蓝长发、雪纹球衣、冰冠、雪花发饰、晶体肩饰 |
| gale | gale.vrm | 薄荷绿发、风纹球衣、羽饰、围巾、脚翼 |
| phantom | phantom.vrm | 紫发、星月球衣、尖帽、星饰和短披风 |
| cannon | cannon.vrm | 深色长发、岩纹球衣、耳机、护目镜和肩甲 |

每个发行版约 6 MB，贴图内嵌，透明图保留 PNG，不透明图使用 core glTF 支持的 JPEG；新增刚性配件已焊接重复顶点。可编辑 Blender、GLB 和高精度 VRM 文件保留在用户本地交付目录。

`src/element-vfx.js` 提供火焰粒子、冰晶实例、三维风带、传送门/残影和碎石/地裂；`src/game-elements.js` 将其接到游戏的真实蓄力、位移、球路、技能及碰撞事件。它不会生成第二个游戏足球或修改规则。联机命中事件沿用现有事件通道同步，声音沿用游戏现有元素音效。

基础模型：`VRM1_Constraint_Twist_Sample v1.0.1`，作者 `pixiv Inc.`，版权 `(c) 2022 pixiv Inc.`。文件保留基础 VRM 内嵌许可字段，包括允许修改及再分发、`commercialUsage: corporation`。完整条件以 VRM 元数据及 https://vrm.dev/licenses/1.0/ 为准，不将模型重新标为仓库代码的 MIT 许可。

基础来源：https://github.com/chunhe-zhang/pocket-football/blob/main/assets/models/player.vrm

新增配件为本次制作；新球衣和中性虹膜贴图经 OpenAI imagegen 辅助绘制，颜色由材质区分。没有使用《原神》《鸣潮》的提取模型、贴图或特效素材。角色为可继续精修的游戏初版，极端动作下的长发、围巾与披风仍需持续调校。
