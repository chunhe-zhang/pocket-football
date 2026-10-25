# Pocket Football

小场地 1v1 足球网页游戏。两名球员在一块 22 × 14 米的小球场里对抗：带球、蓄力射门、挑射、弧线球。

- **角色**：两位动漫风格的 VRM 球员（VRoid 制作），卡通渲染加描边，球衣按队伍上色并印号码；头发、衣袖有弹簧骨骼物理，会眨眼，进球会笑、失球会难过。
- **动作**：跑步、走路、站立使用 Mixamo 的真人动作捕捉动画，在载入时重定向到 VRM 骨骼，步频按实际移动速度同步，脚不打滑；射门、挑射、带球触球、停球、庆祝是叠加在动捕之上的程序化动画。
- **脚与球**：腿部两骨 IK 让鞋真正伸到球上；射门在脚背碰到球的那一刻才出球，带球每一下都由脚把球拨出去，停球时会用鞋底踩住球。
- **足球物理**：重力、空气阻力、旋转产生的弧线（马格努斯效应）、草地滚动阻力、反弹、门柱/横梁碰撞、球网吸收。
- **手感**：自动近身控球、首次触球停球、大力射门的顿帧和镜头震动、球的拖尾、程序化音效（踢球声、门柱声、球网声、观众欢呼、哨声）。
- **模式**：单人对电脑（简单 / 普通 / 困难），或双人同屏；支持手机触屏。

## 操作

| | 单人 | 双人 P1（蓝） | 双人 P2（橙） |
| --- | --- | --- | --- |
| 移动 | WASD / 方向键 | WASD | 方向键 |
| 射门（按住蓄力） | Space / J | F | Enter |
| 挑射 | K | G | / |
| 冲刺 | Shift | 左 Shift | 右 Shift |

出脚瞬间按住与射门方向垂直的方向键，可以踢出弧线球。`C` 切换视角，`M` 静音，`P` / `Esc` 暂停。

## 本地运行

游戏是纯静态网页，没有构建步骤，但浏览器不允许直接双击 `index.html` 加载模型，需要起一个本地服务器：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 部署到 GitHub Pages

仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支选 `main`、目录 `/ (root)`，保存后几分钟即可通过 `https://<用户名>.github.io/<仓库名>/` 访问。

## 目录结构

```
index.html          页面与 UI
style.css
src/
  main.js           渲染器、灯光、主循环
  game.js           比赛流程、镜头、进球判定
  athlete.js        球员移动、体力、控球、射门
  character.js      动捕动画混合 + 程序化动作层 + 腿部 IK
  avatar.js         VRM 载入：动画重定向、弹簧骨骼、节点约束、表情、卡通材质
  chargefx.js       蓄力圆环与瞄准箭头
  ball.js           足球物理
  ai.js             电脑对手
  pitch.js          球场、球门、看台、观众
  audio.js          程序化音效（Web Audio）
  input.js          键盘与触屏
  ui.js             菜单、记分牌、结算
vendor/three/       three.js r187 及所需扩展（本地化，不依赖 CDN）
assets/models/      player.vrm（球员模型）、Xbot.glb（Mixamo 动画来源）
tools/              开发用的本地服务器和无头浏览器截图脚本
```

## 换成你自己的角色

把任何 VRM 1.0 模型（例如用 VRoid Studio 捏的原创角色，导出时选 VRM 1.0）放到 `assets/models/player.vrm` 即可，动画会自动重定向，踢球的接触点也会按新模型的腿长自动校准。可以先用 `tools/prepare_vrm.py` 去掉法线贴图和缩略图来减小体积。

## 素材与许可

- 代码：MIT
- [three.js](https://github.com/mrdoob/three.js)：MIT（见 `vendor/three/LICENSE`）
- 球员模型 `player.vrm`：pixiv Inc. 的 VRM 示例模型（VRM1_Constraint_Twist_Sample，来自 [pixiv/three-vrm](https://github.com/pixiv/three-vrm)），采用 [VRM Public License 1.0](https://vrm.dev/licenses/1.0/)，允许再分发和修改、允许商用、无需署名。本项目去掉了它的法线贴图和缩略图。
- idle / walk / run 动画（`Xbot.glb`）：来自 [Mixamo](https://www.mixamo.com)（Adobe），经 three.js 示例分发。Mixamo 允许在游戏等项目中免版税使用，但不允许把模型文件单独作为素材再分发。
